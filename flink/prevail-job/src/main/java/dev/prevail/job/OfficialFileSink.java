package dev.prevail.job;

import org.apache.flink.configuration.Configuration;
import org.apache.flink.streaming.api.functions.sink.RichSinkFunction;

import java.io.BufferedWriter;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;

/**
 * Production official-path sink. Replaces .print(). Only gated records reach here.
 */
public class OfficialFileSink extends RichSinkFunction<String> {
    private final String sinkPath;
    private transient BufferedWriter writer;

    public OfficialFileSink(String sinkPath) {
        this.sinkPath = sinkPath;
    }

    @Override
    public void open(Configuration parameters) throws Exception {
        Path path = Path.of(sinkPath);
        if (path.getParent() != null) {
            Files.createDirectories(path.getParent());
        }
        writer = Files.newBufferedWriter(
                path,
                StandardCharsets.UTF_8,
                StandardOpenOption.CREATE,
                StandardOpenOption.WRITE,
                StandardOpenOption.APPEND);
    }

    @Override
    public void invoke(String value, Context context) throws Exception {
        writer.write(value);
        writer.newLine();
        writer.flush();
    }

    @Override
    public void close() throws Exception {
        if (writer != null) {
            writer.close();
        }
    }
}
