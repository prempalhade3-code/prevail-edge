import { useCallback, useEffect, useRef, useState } from "react";
import type { SystemSnapshot } from "../types";

const WS_URL =
  import.meta.env.VITE_WS_URL ??
  `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws/live`;

const MIN_UPDATE_MS = 150;

function snapshotSignature(s: SystemSnapshot): string {
  const pred = s.prediction?.probabilities
    ? Object.entries(s.prediction.probabilities)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}:${v.toFixed(3)}`)
        .join("|")
    : "";
  const shadows = (s.shadows ?? [])
    .map((sh) => `${sh.edge_id}:${sh.sync_ratio.toFixed(2)}:${sh.role}`)
    .join(",");
  return [
    s.current_edge_id,
    s.authority?.holder_edge_id,
    s.authority?.epoch,
    s.vehicle_latitude?.toFixed(6),
    s.vehicle_longitude?.toFixed(6),
    s.vehicle_heading?.toFixed(1),
    s.vehicle_speed_mps?.toFixed(2),
    pred,
    shadows,
    s.timeline?.length ?? 0,
    s.timeline?.[s.timeline.length - 1]?.event_type ?? "",
  ].join(";");
}

export function useLiveSnapshot() {
  const [snapshot, setSnapshot] = useState<SystemSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastSig = useRef("");
  const lastUpdate = useRef(0);

  const applySnapshot = useCallback((next: SystemSnapshot) => {
    const now = performance.now();
    const sig = snapshotSignature(next);
    if (sig === lastSig.current && now - lastUpdate.current < MIN_UPDATE_MS) {
      return;
    }
    lastSig.current = sig;
    lastUpdate.current = now;
    setSnapshot(next);
  }, []);

  const refresh = useCallback(async () => {
    const r = await fetch("/v1/snapshot");
    if (!r.ok) throw new Error("snapshot fetch failed");
    applySnapshot(await r.json());
  }, [applySnapshot]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let cancelled = false;

    const connect = () => {
      ws = new WebSocket(WS_URL);
      ws.onopen = () => {
        if (!cancelled) {
          setConnected(true);
          setError(null);
        }
      };
      ws.onmessage = (ev) => {
        try {
          applySnapshot(JSON.parse(ev.data) as SystemSnapshot);
          setError(null);
        } catch {
          setError("Invalid snapshot JSON");
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (!cancelled) setTimeout(connect, 2000);
      };
      ws.onerror = () => setError("WebSocket error");
    };

    connect();
    refresh().catch(() => setError("Backend unreachable — start runtime + backend"));

    return () => {
      cancelled = true;
      ws?.close();
    };
  }, [refresh, applySnapshot]);

  const advanceDemo = async () => {
    const r = await fetch("/v1/demo/advance", { method: "POST" });
    if (!r.ok) throw new Error("advance failed");
    applySnapshot(await r.json());
  };

  return { snapshot, connected, error, refresh, advanceDemo };
}
