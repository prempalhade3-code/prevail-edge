package dev.prevail.job;

import dev.prevail.coordinator.SidecarClient;
import dev.prevail.v0.PrevailControlProto;
import org.apache.flink.configuration.Configuration;
import org.apache.flink.streaming.api.functions.source.RichSourceFunction;

/**
 * Polls the local Rust sidecar over gRPC for teed trajectory samples.
 * Authoritative and shadow Flink instances share this ingress.
 */
public class SidecarIngressSource extends RichSourceFunction<TrajectorySample> {
    private final String sidecarTarget;
    private transient volatile boolean running;
    private transient SidecarClient sidecar;

    public SidecarIngressSource(String sidecarTarget) {
        this.sidecarTarget = sidecarTarget;
    }

    @Override
    public void open(Configuration parameters) {
        sidecar = new SidecarClient(sidecarTarget);
        running = true;
    }

    @Override
    public void run(SourceContext<TrajectorySample> ctx) throws Exception {
        while (running) {
            try {
                for (PrevailControlProto.TrajectorySample proto : sidecar.pullIngress(64)) {
                    TrajectorySample sample = fromProto(proto);
                    synchronized (ctx.getCheckpointLock()) {
                        ctx.collect(sample);
                    }
                }
            } catch (Exception ignored) {
                // Sidecar may be restarting; keep the shadow job warm.
            }
            Thread.sleep(200);
        }
    }

    @Override
    public void cancel() {
        running = false;
    }

    @Override
    public void close() {
        running = false;
        if (sidecar != null) {
            sidecar.close();
        }
    }

    static TrajectorySample fromProto(PrevailControlProto.TrajectorySample proto) {
        TrajectorySample sample = new TrajectorySample();
        sample.sessionId = proto.getSessionId();
        sample.timestampMs = proto.getTimestampMs();
        sample.latitude = proto.getLatitude();
        sample.longitude = proto.getLongitude();
        sample.speedMps = proto.getSpeedMps();
        sample.edgeId = proto.getEdgeId();
        if (proto.hasHeadingDeg()) {
            sample.headingDeg = proto.getHeadingDeg();
        }
        if (proto.hasSensorTupleJson()) {
            sample.sensorTuple = proto.getSensorTupleJson();
        }
        if (proto.hasImageEventId()) {
            sample.imageEventId = proto.getImageEventId();
        }
        if (proto.hasWorkloadClass()) {
            sample.workloadClass = proto.getWorkloadClass();
        }
        return sample;
    }
}
