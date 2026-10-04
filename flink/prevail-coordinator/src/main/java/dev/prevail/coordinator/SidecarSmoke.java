package dev.prevail.coordinator;

/**
 * Live gRPC request/response check against a running Rust sidecar.
 */
public final class SidecarSmoke {
    public static void main(String[] args) {
        String target = args.length > 0 ? args[0] : "127.0.0.1:50051";
        try (SidecarClient client = new SidecarClient(target)) {
            SidecarClient.AuthorityState auth = client.getAuthority("sim-vehicle-01");
            System.out.printf(
                    "GRPC_OK target=%s authoritative=%s holder=%s epoch=%d output=%s%n",
                    target,
                    auth.authoritative(),
                    auth.holderEdgeId(),
                    auth.epoch(),
                    auth.outputEnabled());
            if (auth.holderEdgeId() == null || auth.holderEdgeId().isBlank()) {
                throw new IllegalStateException("empty holder from generated protobuf response");
            }
        }
    }
}
