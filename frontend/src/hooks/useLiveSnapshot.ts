import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, liveSocketUrl } from "../lib/api";
import type { SystemSnapshot } from "../types";

/** Throttle React HUD updates; the map still uses the latest snapshot. */
const HUD_MS = 180;

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
    applySnapshot(await apiGet<SystemSnapshot>("/v1/snapshot", 8000));
    setConnected(true);
    setError(null);
  }, [applySnapshot]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let cancelled = false;

    const connect = () => {
      ws = new WebSocket(liveSocketUrl());
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
      ws.onerror = () => setError(null);
    };

    connect();
    refresh().catch(() => setError("Backend disconnected. Start the Docker mesh, then reload."));
    const poll = window.setInterval(() => {
      refresh().catch(() => undefined);
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      ws?.close();
    };
  }, [refresh, applySnapshot]);

  return { snapshot, snapshotRef, connected, error };
}
