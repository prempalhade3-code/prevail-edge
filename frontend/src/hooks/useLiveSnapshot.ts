import { useCallback, useEffect, useRef, useState } from "react";
import type { SystemSnapshot } from "../types";

const WS_URL =
  import.meta.env.VITE_WS_URL ??
  `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws/live`;

/** HUD React state only. The 3D world reads snapshotRef every frame. */
const HUD_MS = 220;

export function useLiveSnapshot() {
  const snapshotRef = useRef<SystemSnapshot | null>(null);
  const [snapshot, setSnapshot] = useState<SystemSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastHud = useRef(0);

  const applySnapshot = useCallback((next: SystemSnapshot) => {
    snapshotRef.current = next;
    const now = performance.now();
    if (lastHud.current !== 0 && now - lastHud.current < HUD_MS) {
      return;
    }
    lastHud.current = now;
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

  return { snapshot, snapshotRef, connected, error };
}
