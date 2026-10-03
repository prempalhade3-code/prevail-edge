package dev.prevail.job;

import org.apache.flink.api.common.JobExecutionResult;
import org.apache.flink.api.common.eventtime.SerializableTimestampAssigner;
import org.apache.flink.api.common.eventtime.WatermarkStrategy;
import org.apache.flink.api.common.functions.MapFunction;
import org.apache.flink.streaming.api.datastream.DataStream;
import org.apache.flink.streaming.api.environment.CheckpointConfig;
import org.apache.flink.streaming.api.environment.StreamExecutionEnvironment;

import java.time.Duration;

/**
 * PREVAIL stream job — reads JSONL file or live socket, keyed aggregation, sidecar gating.
 */
public class PrevailStreamJob {

    public static void main(String[] args) throws Exception {
        String streamPath = arg(args, "--stream", "sim/fixtures/sample-trajectory.jsonl");
        String mode = arg(args, "--mode", "prevail");

        StreamExecutionEnvironment env = StreamExecutionEnvironment.getExecutionEnvironment();
        env.setParallelism(1);
        env.enableCheckpointing(5000);
        env.getCheckpointConfig().setExternalizedCheckpointCleanup(
                CheckpointConfig.ExternalizedCheckpointCleanup.RETAIN_ON_CANCELLATION);

        DataStream<String> lines;
        if (streamPath.startsWith("socket://")) {
            String hostPort = streamPath.substring("socket://".length());
            int colon = hostPort.lastIndexOf(':');
            String host = hostPort.substring(0, colon);
            int port = Integer.parseInt(hostPort.substring(colon + 1));
            lines = env.socketTextStream(host, port, "\n", 0);
        } else {
            lines = env.readTextFile(streamPath);
        }

        WatermarkStrategy<TrajectorySample> watermarks = WatermarkStrategy
                .<TrajectorySample>forBoundedOutOfOrderness(Duration.ofSeconds(2))
                .withTimestampAssigner((SerializableTimestampAssigner<TrajectorySample>) (sample, ts) ->
                        sample.timestampMs);

        DataStream<TrajectorySample> samples = lines
                .filter(line -> line != null && !line.trim().isEmpty())
                .map(new MapFunction<String, TrajectorySample>() {
                    @Override
                    public TrajectorySample map(String line) throws Exception {
                        return TrajectoryParser.parseLine(line);
                    }
                })
                .assignTimestampsAndWatermarks(watermarks);

        samples
                .keyBy(s -> s.sessionId)
                .process(new VehicleAggregateFunction(mode))
                .print();

        JobExecutionResult result = env.execute("PREVAIL Stream Job (" + mode + ")");

        long samplesProcessed = result.getAccumulatorResult(VehicleAggregateFunction.ACC_SAMPLES);
        long handoffCount = result.getAccumulatorResult(VehicleAggregateFunction.ACC_HANDOFFS);
        long gatedOutput = result.getAccumulatorResult(VehicleAggregateFunction.ACC_GATED);
        long migrationMs = result.getAccumulatorResult(VehicleAggregateFunction.ACC_MIGRATION_MS);

        System.out.printf(
                "METRICS_JSON:{\"migration_latency_ms\":%.1f,\"samples_processed\":%.1f,"
                        + "\"handoff_count\":%.1f,\"gated_output_count\":%.1f}%n",
                (double) migrationMs,
                (double) samplesProcessed,
                (double) handoffCount,
                (double) gatedOutput);
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
