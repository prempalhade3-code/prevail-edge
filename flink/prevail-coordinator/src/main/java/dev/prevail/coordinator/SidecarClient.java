package dev.prevail.coordinator;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.HashMap;
import java.util.Map;

/**
 * HTTP client for Rust sidecar authority API (ADR-004).
 * Supports single base URL or multi-edge mapping (PREVAIL_EDGE_URLS).
 */
public final class SidecarClient {
    private final HttpClient http = HttpClient.newHttpClient();
    private final ObjectMapper mapper = new ObjectMapper();
    private final String defaultBaseUrl;
    private final Map<String, String> edgeUrlMap = new HashMap<>();

    public SidecarClient(String defaultBaseUrl) {
        this.defaultBaseUrl = sanitize(defaultBaseUrl);
        parseEdgeUrls(System.getenv().getOrDefault("PREVAIL_EDGE_URLS", ""));
    }

    private String sanitize(String url) {
        return url.endsWith("/") ? url.substring(0, url.length() - 1) : url;
    }

    private void parseEdgeUrls(String spec) {
        if (spec == null || spec.isBlank()) return;
        for (String entry : spec.split(",")) {
            String[] parts = entry.trim().split("=");
            if (parts.length == 2) {
                edgeUrlMap.put(parts[0].trim(), sanitize(parts[1].trim()));
            }
        }
    }

    public AuthorityState getAuthority(String sessionId) throws Exception {
        return getAuthorityForEdge(sessionId, null);
    }

    public AuthorityState getAuthorityForEdge(String sessionId, String edgeId) throws Exception {
        String baseUrl = (edgeId != null && edgeUrlMap.containsKey(edgeId))
                ? edgeUrlMap.get(edgeId)
                : defaultBaseUrl;
        String uri = baseUrl + "/v1/sidecar/authority?session_id=" + sessionId;
        HttpRequest req = HttpRequest.newBuilder(URI.create(uri)).GET().build();
        HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString());
        JsonNode node = mapper.readTree(resp.body());
        return new AuthorityState(
                node.get("is_authoritative").asBoolean(),
                node.get("holder_edge_id").asText(),
                node.get("epoch").asLong(),
                node.get("output_enabled").asBoolean());
    }

    public record AuthorityState(
            boolean authoritative,
            String holderEdgeId,
            long epoch,
            boolean outputEnabled) {}
}
