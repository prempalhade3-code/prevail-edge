package dev.prevail.v0;

/**
 * Java view of proto/v0/prevail_control.proto field names.
 * Rust generates the wire types via tonic-build; Flink uses JSON + these names.
 */
public final class PrevailControlMessages {
    public static final String PROMOTION_REQUEST = "PromotionRequest";
    public static final String PROMOTION_ACK = "PromotionAck";
    public static final String DEMOTION_NOTICE = "DemotionNotice";
    public static final String MIGRATION_FALLBACK_START = "MigrationFallbackStart";
    public static final String MIGRATION_FALLBACK_COMPLETE = "MigrationFallbackComplete";
    public static final String SPECULATION_DECISION = "SpeculationDecision";
    public static final String TIMELINE_EVENT = "TimelineEvent";
    public static final String CAPABILITY_ADVERTISEMENT = "EdgeCapabilityAdvertisement";
    public static final String STATE_ALIGN = "StateAlign";
    public static final String CHECKPOINT_TRANSFER = "CheckpointTransfer";

    private PrevailControlMessages() {}
}
