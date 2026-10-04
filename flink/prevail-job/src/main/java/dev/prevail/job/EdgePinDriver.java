package dev.prevail.job;

import org.apache.flink.api.common.externalresource.ExternalResourceDriver;
import org.apache.flink.api.common.externalresource.ExternalResourceInfo;

import java.util.HashSet;
import java.util.Set;

/**
 * No-op driver: the resource exists only so Fine-Grained Resource Management
 * can match a job's SlotSharingGroup to the TaskManager that advertised it.
 */
public final class EdgePinDriver implements ExternalResourceDriver {
    private final String name;

    public EdgePinDriver(String name) {
        this.name = name;
    }

    @Override
    public Set<? extends ExternalResourceInfo> retrieveResourceInfo(long amount) {
        Set<ExternalResourceInfo> info = new HashSet<>();
        long n = Math.max(1, amount);
        for (int i = 0; i < n; i++) {
            info.add(new EdgePinInfo(name + "-" + i));
        }
        return info;
    }
}
