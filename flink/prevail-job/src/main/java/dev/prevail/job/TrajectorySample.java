package dev.prevail.job;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Trajectory sample matching docs/contracts/trajectory-sample.schema.json
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class TrajectorySample {
    @JsonProperty("session_id")
    public String sessionId;

    @JsonProperty("timestamp_ms")
    public long timestampMs;

    public double latitude;
    public double longitude;

    @JsonProperty("speed_mps")
    public double speedMps;

    @JsonProperty("edge_id")
    public String edgeId;

    @JsonProperty("heading_deg")
    public Double headingDeg;

    @JsonProperty("sensor_tuple")
    public String sensorTuple;

    @JsonProperty("image_event_id")
    public String imageEventId;

    @JsonProperty("workload_class")
    public String workloadClass;

    @JsonProperty("image_jpeg_b64")
    public String imageJpegB64;
}
