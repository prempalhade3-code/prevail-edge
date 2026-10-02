package dev.prevail.job;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class TrajectoryParserTest {

    @Test
    void parsesValidTrajectoryLine() throws Exception {
        String line = "{\"session_id\":\"sim-vehicle-01\",\"timestamp_ms\":1,"
                + "\"latitude\":12.97,\"longitude\":77.59,\"speed_mps\":10.0,"
                + "\"edge_id\":\"edge-a\",\"heading_deg\":45.0}";
        TrajectorySample sample = TrajectoryParser.parseLine(line);
        assertEquals("sim-vehicle-01", sample.sessionId);
        assertEquals("edge-a", sample.edgeId);
        assertEquals(10.0, sample.speedMps, 0.001);
    }

    @Test
    void rejectsEmptyLine() {
        assertThrows(IllegalArgumentException.class, () -> TrajectoryParser.parseLine("  "));
    }
}
