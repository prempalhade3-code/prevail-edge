import { useCallback, useEffect, useState } from "react";
import type { SystemSnapshot } from "../types";

const WS_URL =
  import.meta.env.VITE_WS_URL ??
  `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws/live`;

export function useLiveSnapshot() {
  const [snapshot, setSnapshot] = useState<SystemSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await fetch("/v1/snapshot");
    if (!r.ok) throw new Error("snapshot fetch failed");
    setSnapshot(await r.json());
  }, []);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let cancelled = false;

    const connect = () => {
      ws = new WebSocket(WS_URL);
      ws.onopen = () => {
        if (!cancelled) setConnected(true);
      };
      ws.onmessage = (ev) => {
        try {
          setSnapshot(JSON.parse(ev.data) as SystemSnapshot);
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
  }, [refresh]);

  const advanceDemo = async () => {
    const r = await fetch("/v1/demo/advance", { method: "POST" });
    if (!r.ok) throw new Error("advance failed");
    setSnapshot(await r.json());
  };

  return { snapshot, connected, error, refresh, advanceDemo };
}
