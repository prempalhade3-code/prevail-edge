package dev.prevail.job;

import dev.prevail.coordinator.SidecarClient;
import org.apache.flink.api.common.accumulators.LongCounter;
import org.apache.flink.api.common.state.ValueState;
import org.apache.flink.api.common.state.ValueStateDescriptor;
import org.apache.flink.configuration.Configuration;
import org.apache.flink.streaming.api.functions.KeyedProcessFunction;
import org.apache.flink.util.Collector;

/**
 * Keyed vehicle state: speed aggregates, edge tracking, handoff detection.
 * Applies sidecar output gating via Prem's SidecarClient contract.
 */
public class VehicleAggregateFunction
        extends KeyedProcessFunction<String, TrajectorySample, String> {

    public static final String ACC_SAMPLES = "samplesProcessed";
    public static final String ACC_HANDOFFS = "handoffCount";
    public static final String ACC_GATED = "gatedOutputCount";
    public static final String ACC_MIGRATION_MS = "migrationLatencyMs";

    private transient ValueState<String> currentEdge;
    private transient ValueState<Long> sampleCount;
    private transient ValueState<Double> speedSum;
    private transient SidecarClient sidecar;
    private transient LongCounter samplesCounter;
    private transient LongCounter handoffCounter;
    private transient LongCounter gatedCounter;
    private transient LongCounter migrationCounter;
    private final String mode;

    public VehicleAggregateFunction(String mode) {
        this.mode = mode;
    }

    @Override
    public void open(Configuration parameters) {
        currentEdge = getRuntimeContext().getState(new ValueStateDescriptor<>("currentEdge", String.class));
        sampleCount = getRuntimeContext().getState(new ValueStateDescriptor<>("sampleCount", Long.class));
        speedSum = getRuntimeContext().getState(new ValueStateDescriptor<>("speedSum", Double.class));

        samplesCounter = new LongCounter();
        handoffCounter = new LongCounter();
        gatedCounter = new LongCounter();
        migrationCounter = new LongCounter();
        getRuntimeContext().addAccumulator(ACC_SAMPLES, samplesCounter);
        getRuntimeContext().addAccumulator(ACC_HANDOFFS, handoffCounter);
        getRuntimeContext().addAccumulator(ACC_GATED, gatedCounter);
        getRuntimeContext().addAccumulator(ACC_MIGRATION_MS, migrationCounter);

        String sidecarUrl = System.getenv().getOrDefault("PREVAIL_SIDECAR_URL", "http://127.0.0.1:8090");
        sidecar = new SidecarClient(sidecarUrl);
    }

    @Override
    public void processElement(TrajectorySample sample, Context ctx, Collector<String> out) throws Exception {
        String prevEdge = currentEdge.value();
        if (prevEdge != null && !prevEdge.equals(sample.edgeId)) {
            handoffCounter.add(1);
            // Latency is measured by the Rust runtime (AuthorityTransferred.latency_ms).
        }
        currentEdge.update(sample.edgeId);

        long count = sampleCount.value() == null ? 0L : sampleCount.value();
        double sum = speedSum.value() == null ? 0.0 : speedSum.value();
        count += 1;
        sum += sample.speedMps;
        sampleCount.update(count);
        speedSum.update(sum);
        samplesCounter.add(1);

        boolean outputEnabled = true;
        try {
            SidecarClient.AuthorityState auth = sidecar.getAuthorityForEdge(sample.sessionId, sample.edgeId);
            outputEnabled = auth.outputEnabled();
        } catch (Exception ex) {
            outputEnabled = false;
        }

        if (outputEnabled) {
            gatedCounter.add(1);
            double avgSpeed = sum / count;
            out.collect(String.format(
                    "session=%s edge=%s avg_speed=%.2f samples=%d",
                    sample.sessionId, sample.edgeId, avgSpeed, count));
        }
    }

}
