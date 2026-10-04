package dev.prevail.job;

import org.apache.flink.api.common.externalresource.ExternalResourceDriver;
import org.apache.flink.api.common.externalresource.ExternalResourceDriverFactory;
import org.apache.flink.configuration.Configuration;

/** Factory loaded by each labeled TaskManager for {@code pin-edge-*} resources. */
public final class EdgePinDriverFactory implements ExternalResourceDriverFactory {
    @Override
    public ExternalResourceDriver createExternalResourceDriver(Configuration config) {
        String name = config.getString("external-resource.name", "pin");
        return new EdgePinDriver(name);
    }
}
