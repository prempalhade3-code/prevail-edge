package dev.prevail.coordinator;

import org.apache.flink.streaming.api.functions.ProcessFunction;
import org.apache.flink.util.Collector;

/**
 * PREVAIL mobility hook — gates official output on sidecar authority (ADR-004).
 * Stream parsing and keyed state live in Ram's {@code flink/prevail-job/}.
 */
public class MobilityProcessFunction extends ProcessFunction<String, String> {
    private transient SidecarClient sidecar;

    @Override
    public void open(org.apache.flink.configuration.Configuration parameters) {
        String sidecarUrl = System.getenv().getOrDefault("PREVAIL_SIDECAR_URL", "http://127.0.0.1:8090");
        sidecar = new SidecarClient(sidecarUrl);
    }

    @Override
    public void processElement(String value, Context ctx, Collector<String> out) throws Exception {
        SidecarClient.AuthorityState auth = sidecar.getAuthority("session-vehicle-1");
        if (auth.outputEnabled()) {
            out.collect(value);
        }
        // Shadow path: suppressed when output_enabled is false
    }
}
