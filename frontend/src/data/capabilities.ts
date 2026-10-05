/** Static deploy/config/edge-capabilities.json — not live telemetry. */
export interface ConfiguredCapability {
  edge_id: string;
  supports_stream: boolean;
  supports_image: boolean;
  supports_video: boolean;
  supports_gpu: boolean;
}

export const CONFIGURED_CAPABILITIES: Record<string, ConfiguredCapability> = {
  "edge-a": {
    edge_id: "edge-a",
    supports_stream: true,
    supports_image: true,
    supports_video: false,
    supports_gpu: false,
  },
  "edge-b": {
    edge_id: "edge-b",
    supports_stream: true,
    supports_image: true,
    supports_video: true,
    supports_gpu: true,
  },
  "edge-c": {
    edge_id: "edge-c",
    supports_stream: true,
    supports_image: true,
    supports_video: false,
    supports_gpu: false,
  },
  "edge-d": {
    edge_id: "edge-d",
    supports_stream: true,
    supports_image: false,
    supports_video: false,
    supports_gpu: false,
  },
};
