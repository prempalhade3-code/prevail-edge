package dev.prevail.job;

import org.apache.flink.api.common.JobExecutionResult;
import org.apache.flink.api.common.eventtime.SerializableTimestampAssigner;
import org.apache.flink.api.common.eventtime.WatermarkStrategy;
import org.apache.flink.api.common.functions.MapFunction;
import org.apache.flink.api.common.operators.SlotSharingGroup;
import org.apache.flink.configuration.Configuration;
import org.apache.flink.runtime.state.hashmap.HashMapStateBackend;
import org.apache.flink.streaming.api.datastream.DataStream;
import org.apache.flink.streaming.api.datastream.SingleOutputStreamOperator;
import org.apache.flink.streaming.api.environment.CheckpointConfig;
import org.apache.flink.streaming.api.environment.StreamExecutionEnvironment;

import java.time.Duration;

/**
 * Per-edge Flink job: sidecar ingress → keyed state → authority-gated official sink.
 *
 * Submitted against the labeled TaskManager for this edge. Shadow instances are
 * created on ShadowCreate (restored from the authority savepoint) and cancelled
 * on ShadowRelease — they are not always-on.
 */
public class PrevailStreamJob {

    public static void main(String[] args) throws Exception {
        String edgeId = arg(args, "--edge-id", System.getenv().getOrDefault("PREVAIL_EDGE_ID", "edge-a"));
        String ingress = arg(args, "--ingress", "sidecar");
        String streamPath = arg(args, "--stream", "sim/fixtures/sample-trajectory.jsonl");
        String sidecar = arg(args, "--sidecar", sidecarTarget(edgeId));
        String sinkPath = arg(args, "--sink", "/var/prevail/sink/" + edgeId + ".jsonl");
        String checkpointDir = arg(args, "--checkpoint-dir", "/var/prevail/checkpoints/" + edgeId);
        String mode = arg(args, "--mode", "prevail");
        String pinResource = arg(args, "--pin-resource", System.getenv().getOrDefault("PREVAIL_PIN_RESOURCE", ""));
        String savepoint = arg(args, "--from-savepoint", System.getenv().getOrDefault("PREVAIL_SAVEPOINT", ""));

        Configuration conf = new Configuration();
        if (savepoint != null && !savepoint.isBlank()) {
            conf.setString("execution.savepoint.path", savepoint);
            conf.setBoolean("execution.savepoint.ignore-unclaimed-state", true);
        }

        conf.setString("state.checkpoints.num-retained", "5");
        StreamExecutionEnvironment env = StreamExecutionEnvironment.getExecutionEnvironment(conf);
        env.setParallelism(1);
        env.setStateBackend(new HashMapStateBackend());
        env.enableCheckpointing(5000);
        env.getCheckpointConfig().setMinPauseBetweenCheckpoints(2000);
        env.getCheckpointConfig().setExternalizedCheckpointCleanup(
                CheckpointConfig.ExternalizedCheckpointCleanup.RETAIN_ON_CANCELLATION);
        try {
            env.getCheckpointConfig().setCheckpointStorage("file://" + checkpointDir);
        } catch (Exception ignored) {
            // Local tests without a writable checkpoint dir still process the stream.
        }

        DataStream<TrajectorySample> samples;
        if ("sidecar".equals(ingress) || streamPath.startsWith("sidecar://")) {
            samples = env.addSource(new SidecarIngressSource(sidecar))
                    .name("sidecar-ingress")
                    .uid("sidecar-ingress");
        } else if (streamPath.startsWith("socket://")) {
            String hostPort = streamPath.substring("socket://".length());
            int colon = hostPort.lastIndexOf(':');
            DataStream<String> lines = env.socketTextStream(
                    hostPort.substring(0, colon),
                    Integer.parseInt(hostPort.substring(colon + 1)),
                    "\n",
                    0);
            samples = parseLines(lines);
        } else {
            samples = parseLines(env.readTextFile(streamPath));
        }

        WatermarkStrategy<TrajectorySample> watermarks = WatermarkStrategy
                .<TrajectorySample>forBoundedOutOfOrderness(Duration.ofSeconds(2))
                .withTimestampAssigner((SerializableTimestampAssigner<TrajectorySample>) (sample, ts) ->
                        sample.timestampMs);

        SingleOutputStreamOperator<String> keyed = samples
                .assignTimestampsAndWatermarks(watermarks)
                .keyBy(s -> s.sessionId)
                .process(new VehicleAggregateFunction(mode, sidecar))
                .name("keyed-vehicle")
                .uid("keyed-vehicle");

        SingleOutputStreamOperator<String> gated = keyed
                .process(new dev.prevail.coordinator.MobilityProcessFunction(sidecar))
                .name("authority-gate")
                .uid("authority-gate");

        applyPin(samples, pinResource);
        applyPin(keyed, pinResource);
        applyPin(gated, pinResource);

        var sink = gated.addSink(new OfficialFileSink(sinkPath))
                .name("official-sink")
                .uid("official-sink");
        if (pinResource != null && !pinResource.isBlank()) {
            sink.slotSharingGroup(pinSharingGroup(pinResource));
        }

        JobExecutionResult result = env.execute("PREVAIL " + edgeId + " (" + mode + ")");
        try {
            long samplesProcessed = result.getAccumulatorResult(VehicleAggregateFunction.ACC_SAMPLES);
            long handoffCount = result.getAccumulatorResult(VehicleAggregateFunction.ACC_HANDOFFS);
            long gatedOutput = result.getAccumulatorResult(VehicleAggregateFunction.ACC_GATED);
            long migrationMs = result.getAccumulatorResult(VehicleAggregateFunction.ACC_MIGRATION_MS);
            System.out.printf(
                    "METRICS_JSON:{\"migration_latency_ms\":%.1f,\"samples_processed\":%.1f,"
                            + "\"handoff_count\":%.1f,\"gated_output_count\":%.1f,\"edge_id\":\"%s\"}%n",
                    (double) migrationMs,
                    (double) samplesProcessed,
                    (double) handoffCount,
                    (double) gatedOutput,
                    edgeId);
        } catch (UnsupportedOperationException | IllegalStateException ignored) {
            // Detached cluster submit has no local accumulators.
        }
    }

    private static DataStream<TrajectorySample> parseLines(DataStream<String> lines) {
        return lines
                .filter(line -> line != null && !line.trim().isEmpty())
                .map(new MapFunction<String, TrajectorySample>() {
                    @Override
                    public TrajectorySample map(String line) throws Exception {
                        return TrajectoryParser.parseLine(line);
                    }
                })
                .name("parse-lines")
                .uid("parse-lines");
    }

    private static void applyPin(DataStream<?> stream, String pinResource) {
        if (stream instanceof SingleOutputStreamOperator<?> op) {
            if (pinResource != null && !pinResource.isBlank()) {
                op.slotSharingGroup(pinSharingGroup(pinResource));
            }
        }
    }

    private static String pinGroup(String pinResource) {
        if (pinResource == null || pinResource.isBlank()) {
            return "default";
        }
        return pinResource;
    }

    private static SlotSharingGroup pinSharingGroup(String pinResource) {
        return SlotSharingGroup.newBuilder(pinResource)
                .setCpuCores(0.15)
                .setTaskHeapMemoryMB(48)
                .setManagedMemoryMB(16)
                .setTaskOffHeapMemoryMB(8)
                .setExternalResource(pinResource, 1.0)
                .build();
    }

    private static String sidecarTarget(String edgeId) {
        String mapped = System.getenv("PREVAIL_SIDECAR_GRPC_URLS");
        if (mapped != null && !mapped.isBlank()) {
            for (String entry : mapped.split(",")) {
                String[] parts = entry.trim().split("=");
                if (parts.length == 2 && edgeId.equals(parts[0].trim())) {
                    return parts[1].trim();
                }
            }
        }
        String local = System.getenv("PREVAIL_SIDECAR_GRPC");
        if (local != null && !local.isBlank()) {
            return local;
        }
        return "127.0.0.1:50051";
    }

    private static String arg(String[] args, String flag, String defaultValue) {
        for (int i = 0; i < args.length - 1; i++) {
            if (flag.equals(args[i])) {
                return args[i + 1];
            }
        }
        return defaultValue;
    }
}
