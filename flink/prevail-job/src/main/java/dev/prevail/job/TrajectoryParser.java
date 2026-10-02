package dev.prevail.job;

import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * Parses JSONL trajectory lines into {@link TrajectorySample}.
 */
public final class TrajectoryParser {
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private TrajectoryParser() {}

    public static TrajectorySample parseLine(String line) throws Exception {
        String trimmed = line == null ? "" : line.trim();
        if (trimmed.isEmpty()) {
            throw new IllegalArgumentException("Empty trajectory line");
        }
        return MAPPER.readValue(trimmed, TrajectorySample.class);
    }
}
