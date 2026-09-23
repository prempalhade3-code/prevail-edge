package dev.prevail.coordinator;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

/**
 * HTTP client for Rust sidecar authority API (ADR-004).
 * Ram's operators use the same contract via gRPC when wired in Compose.
 */
public final class SidecarClient {
    private final HttpClient http = HttpClient.newHttpClient();
    private final ObjectMapper mapper = new ObjectMapper();
    private final String baseUrl;

    public SidecarClient(String baseUrl) {
        this.baseUrl = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
    }

    public AuthorityState getAuthority(String sessionId) throws Exception {
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
