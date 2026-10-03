package dev.prevail.coordinator;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.Serializable;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

/**
 * Canonical PREVAIL session identity, shared with the Rust runtime and the Python
 * simulators via {@code deploy/config/session.json}.
 *
 * <p>The sidecar must query authority for the same session the simulators emit.
 * A mismatch makes every gating decision apply to a session that does not exist.
 */
public final class SessionConfig implements Serializable {
    private static final long serialVersionUID = 1L;

    private static final String DEFAULT_PATH = "deploy/config/session.json";
    private static final String FALLBACK_SESSION_ID = "sim-vehicle-01";
    private static final String FALLBACK_RUN_ID = "run-demo-1";

    private final String sessionId;
    private final String runId;

    private SessionConfig(String sessionId, String runId) {
        this.sessionId = sessionId;
        this.runId = runId;
    }

    public String sessionId() {
        return sessionId;
    }

    public String runId() {
        return runId;
    }

    /** Resolves from env overrides, then the shared JSON file, then hardcoded fallbacks. */
    public static SessionConfig load() {
        String sessionId = System.getenv("PREVAIL_SESSION_ID");
        String runId = System.getenv("PREVAIL_RUN_ID");

        if (sessionId == null || runId == null) {
            String configPath = System.getenv()
                    .getOrDefault("PREVAIL_SESSION_CONFIG_PATH", DEFAULT_PATH);
            try {
                Path path = Paths.get(configPath);
                if (Files.exists(path)) {
                    JsonNode node = new ObjectMapper().readTree(Files.readAllBytes(path));
                    if (sessionId == null && node.hasNonNull("session_id")) {
                        sessionId = node.get("session_id").asText();
                    }
                    if (runId == null && node.hasNonNull("run_id")) {
                        runId = node.get("run_id").asText();
                    }
                }
            } catch (Exception e) {
                // Fall through to defaults: gating must never fail on config IO.
            }
        }

        return new SessionConfig(
                sessionId != null ? sessionId : FALLBACK_SESSION_ID,
                runId != null ? runId : FALLBACK_RUN_ID);
    }
}
