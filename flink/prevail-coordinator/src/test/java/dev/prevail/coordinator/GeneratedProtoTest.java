package dev.prevail.coordinator;

import dev.prevail.v0.PrevailControlProto;
import dev.prevail.v0.PrevailSidecarProto;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

public class GeneratedProtoTest {
    @Test
    void generatedMessagesRoundTrip() {
        PrevailControlProto.TrajectorySample sample = PrevailControlProto.TrajectorySample.newBuilder()
                .setSessionId("sess")
                .setLatitude(12.92)
                .setLongitude(77.66)
                .setSpeedMps(10.0)
                .setEdgeId("edge-a")
                .build();
        PrevailSidecarProto.IngressBatch batch = PrevailSidecarProto.IngressBatch.newBuilder()
                .addSamples(sample)
                .build();
        assertEquals(1, batch.getSamplesCount());
        assertEquals("edge-a", batch.getSamples(0).getEdgeId());

        PrevailSidecarProto.AuthorityState state = PrevailSidecarProto.AuthorityState.newBuilder()
                .setIsAuthoritative(true)
                .setHolderEdgeId("edge-a")
                .setEpoch(3)
                .setOutputEnabled(true)
                .build();
        assertTrue(state.getOutputEnabled());
        assertEquals(3, state.getEpoch());
    }
}
