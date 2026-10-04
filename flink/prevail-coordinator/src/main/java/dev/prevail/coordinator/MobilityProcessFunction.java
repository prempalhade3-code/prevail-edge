package dev.prevail.coordinator;

import org.apache.flink.streaming.api.functions.ProcessFunction;
import org.apache.flink.util.Collector;

/**
 * PREVAIL mobility hook — gates official output on sidecar authority (ADR-004).
 * Uses generated Java protobuf / gRPC types exclusively.
 */
public class MobilityProcessFunction extends ProcessFunction<String, String> {
    private transient SidecarClient sidecar;
    private transient String sessionId;
    private final String sidecarTarget;

    public MobilityProcessFunction() {
        this(System.getenv().getOrDefault("PREVAIL_SIDECAR_GRPC", "127.0.0.1:50051"));
    }

    public MobilityProcessFunction(String sidecarTarget) {
        this.sidecarTarget = sidecarTarget == null || sidecarTarget.isBlank()
                ? System.getenv().getOrDefault("PREVAIL_SIDECAR_GRPC", "127.0.0.1:50051")
                : sidecarTarget;
    }

    @Override
    public void open(org.apache.flink.configuration.Configuration parameters) {
        sidecar = new SidecarClient(sidecarTarget);
        sessionId = SessionConfig.load().sessionId();
    }

    @Override
    public void close() {
        if (sidecar != null) {
            sidecar.close();
        }
    }

    @Override
    public void processElement(String value, Context ctx, Collector<String> out) throws Exception {
        SidecarClient.AuthorityState auth = sidecar.getAuthority(sessionId);
        if (auth.outputEnabled()) {
            out.collect(value);
        }
    }
}
