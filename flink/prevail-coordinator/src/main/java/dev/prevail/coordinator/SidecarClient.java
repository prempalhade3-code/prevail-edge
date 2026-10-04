package dev.prevail.coordinator;

import dev.prevail.v0.PrevailControlProto;
import dev.prevail.v0.PrevailSidecarGrpc;
import dev.prevail.v0.PrevailSidecarProto;
import io.grpc.ManagedChannel;
import io.grpc.ManagedChannelBuilder;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * gRPC client for the Rust PrevailSidecar (ADR-004).
 *
 * Generated Java protobuf classes from proto/v0 are the only wire types.
 */
public final class SidecarClient implements AutoCloseable {
    private final Map<String, String> edgeTargets = new HashMap<>();
    private final String defaultTarget;
    private final Map<String, ManagedChannel> channels = new HashMap<>();

    public SidecarClient() {
        this(System.getenv().getOrDefault("PREVAIL_SIDECAR_GRPC", "127.0.0.1:50051"));
    }

    public SidecarClient(String defaultTarget) {
        this.defaultTarget = sanitizeTarget(defaultTarget);
        parseEdgeTargets(System.getenv().getOrDefault("PREVAIL_SIDECAR_GRPC_URLS", ""));
    }

    private String sanitizeTarget(String target) {
        if (target == null || target.isBlank()) {
            return "127.0.0.1:50051";
        }
        String trimmed = target.trim();
        if (trimmed.startsWith("http://")) {
            trimmed = trimmed.substring("http://".length());
        }
        if (trimmed.startsWith("grpc://")) {
            trimmed = trimmed.substring("grpc://".length());
        }
        if (trimmed.endsWith("/")) {
            trimmed = trimmed.substring(0, trimmed.length() - 1);
        }
        return trimmed;
    }

    private void parseEdgeTargets(String spec) {
        if (spec == null || spec.isBlank()) {
            return;
        }
        for (String entry : spec.split(",")) {
            String[] parts = entry.trim().split("=");
            if (parts.length == 2) {
                edgeTargets.put(parts[0].trim(), sanitizeTarget(parts[1].trim()));
            }
        }
    }

    private PrevailSidecarGrpc.PrevailSidecarBlockingStub stubFor(String edgeId) {
        String target = (edgeId != null && edgeTargets.containsKey(edgeId))
                ? edgeTargets.get(edgeId)
                : defaultTarget;
        ManagedChannel channel = channels.computeIfAbsent(target, t ->
                ManagedChannelBuilder.forTarget(t).usePlaintext().build());
        return PrevailSidecarGrpc.newBlockingStub(channel);
    }

    public AuthorityState getAuthority(String sessionId) {
        return getAuthorityForEdge(sessionId, null);
    }

    public AuthorityState getAuthorityForEdge(String sessionId, String edgeId) {
        PrevailSidecarProto.AuthorityQuery query = PrevailSidecarProto.AuthorityQuery.newBuilder()
                .setSessionId(sessionId == null ? "" : sessionId)
                .build();
        PrevailSidecarProto.AuthorityState state = stubFor(edgeId).getAuthority(query);
        return new AuthorityState(
                state.getIsAuthoritative(),
                state.getHolderEdgeId(),
                state.getEpoch(),
                state.getOutputEnabled());
    }

    public void reportLocation(String sessionId, long timestampMs, double lat, double lon,
                               double speed, String edgeId, Double heading) {
        PrevailControlProto.TrajectorySample.Builder b = PrevailControlProto.TrajectorySample.newBuilder()
                .setSessionId(sessionId)
                .setTimestampMs(timestampMs)
                .setLatitude(lat)
                .setLongitude(lon)
                .setSpeedMps(speed)
                .setEdgeId(edgeId == null ? "" : edgeId);
        if (heading != null) {
            b.setHeadingDeg(heading);
        }
        stubFor(edgeId).reportLocation(b.build());
    }

    public void reportState(String sessionId, long sampleCount, double speedSum, String currentEdge) {
        PrevailControlProto.FlinkKeyedState state = PrevailControlProto.FlinkKeyedState.newBuilder()
                .setSessionId(sessionId)
                .setSampleCount(sampleCount)
                .setSpeedSum(speedSum)
                .setCurrentEdge(currentEdge == null ? "" : currentEdge)
                .build();
        stubFor(null).reportState(state);
    }

    public void onPromotion(String sessionId, String holder, long epoch) {
        PrevailSidecarProto.PromotionNotice notice = PrevailSidecarProto.PromotionNotice.newBuilder()
                .setSessionId(sessionId)
                .setNewHolderEdgeId(holder)
                .setEpoch(epoch)
                .build();
        stubFor(holder).onPromotion(notice);
    }

    public List<PrevailControlProto.TrajectorySample> pullIngress(int limit) {
        PrevailSidecarProto.IngressQuery query = PrevailSidecarProto.IngressQuery.newBuilder()
                .setLimit(Math.max(1, limit))
                .build();
        PrevailSidecarProto.IngressBatch batch = stubFor(null).pullIngress(query);
        return new ArrayList<>(batch.getSamplesList());
    }

    public PrevailControlProto.FlinkKeyedState restoreState(String sessionId) {
        PrevailSidecarProto.RestoreQuery query = PrevailSidecarProto.RestoreQuery.newBuilder()
                .setSessionId(sessionId == null ? "" : sessionId)
                .build();
        return stubFor(null).restoreState(query);
    }

    @Override
    public void close() {
        for (ManagedChannel channel : channels.values()) {
            channel.shutdownNow();
        }
        channels.clear();
    }

    public record AuthorityState(
            boolean authoritative,
            String holderEdgeId,
            long epoch,
            boolean outputEnabled) {}
}
