package dev.prevail.job;

import org.apache.flink.api.common.externalresource.ExternalResourceInfo;

import java.util.Collection;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/** Scheduling-only external resource used to pin a job to a labeled TaskManager. */
public final class EdgePinInfo implements ExternalResourceInfo {
    private final String name;

    public EdgePinInfo(String name) {
        this.name = name;
    }

    @Override
    public Optional<String> getProperty(String key) {
        if ("name".equals(key)) {
            return Optional.of(name);
        }
        return Optional.empty();
    }

    @Override
    public Collection<String> getKeys() {
        return Set.of("name");
    }
}
