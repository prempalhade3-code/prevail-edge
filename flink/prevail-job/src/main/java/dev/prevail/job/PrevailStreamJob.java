package dev.prevail.job;

import org.apache.flink.api.common.JobExecutionResult;
import org.apache.flink.api.common.functions.MapFunction;
import org.apache.flink.streaming.api.datastream.DataStream;
import org.apache.flink.streaming.api.environment.StreamExecutionEnvironment;

/**
 * PREVAIL stream job — reads JSONL trajectory file, keyed aggregation, sidecar gating.
 */
public class PrevailStreamJob {

    public static void main(String[] args) throws Exception {
        String streamPath = arg(args, "--stream", "sim/fixtures/sample-trajectory.jsonl");
        String mode = arg(args, "--mode", "prevail");

        StreamExecutionEnvironment env = StreamExecutionEnvironment.getExecutionEnvironment();
        env.setParallelism(1);

        DataStream<String> lines = env.readTextFile(streamPath);

        DataStream<TrajectorySample> samples = lines
                .filter(line -> line != null && !line.trim().isEmpty())
                .map(new MapFunction<String, TrajectorySample>() {
                    @Override
                    public TrajectorySample map(String line) throws Exception {
                        return TrajectoryParser.parseLine(line);
                    }
                });

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
