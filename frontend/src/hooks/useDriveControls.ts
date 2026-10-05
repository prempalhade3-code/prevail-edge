import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost } from "../lib/api";
import type { DriveStatus } from "../types";

function assertAccepted(next: DriveStatus, action: string): DriveStatus {
  if (next.accepted === false) {
    throw new Error(next.error || `${action} was rejected`);
  }
  return next;
}

export function useDriveControls() {
  const [status, setStatus] = useState<DriveStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await apiGet<DriveStatus>("/v1/sim/drive/status", 4000));
    } catch {
      // Poll failures stay silent; action errors surface from start/pause/stop.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 1000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const recover = useCallback(async (ok: (current: DriveStatus) => boolean) => {
    const current = await apiGet<DriveStatus>("/v1/sim/drive/status", 4000);
    if (ok(current)) {
      setStatus(current);
      setError(null);
      return current;
    }
    return null;
  }, []);

  const run = useCallback(
    async (fn: () => Promise<DriveStatus>, action: string, ok: (current: DriveStatus) => boolean) => {
      setPending(true);
      setError(null);
      try {
        let next: DriveStatus;
        try {
          next = await fn();
        } catch (err) {
          const recovered = await recover(ok);
          if (recovered) return recovered;
          throw err;
        }
        const accepted = assertAccepted(next, action);
        setStatus(accepted);
        return accepted;
      } catch (err) {
        setError((err as Error).message);
        await refresh();
        throw err;
      } finally {
        setPending(false);
      }
    },
    [recover, refresh],
  );

  const start = useCallback(
    async (source: string, destination: string, scenario = "warm") => {
      setPending(true);
      setError(null);
      const body = { source, destination, scenario };
      const matches = (current: DriveStatus) =>
        Boolean(current.running && current.source === source && current.destination === destination);
      try {
        let next: DriveStatus;
        try {
          next = await apiPost<DriveStatus>("/v1/sim/start", body, 6000);
        } catch (err) {
          const recovered = await recover(matches);
          if (recovered) return recovered;
          throw err;
        }
        if (next.accepted === false && next.running) {
          await apiPost<DriveStatus>("/v1/sim/stop", {}, 12000);
          next = await apiPost<DriveStatus>("/v1/sim/start", body, 6000);
        }
        const accepted = assertAccepted(next, "Start");
        setStatus(accepted);
        return accepted;
      } catch (err) {
        const recovered = await recover(matches);
        if (recovered) return recovered;
        setError((err as Error).message);
        await refresh();
        throw err;
      } finally {
        setPending(false);
      }
    },
    [recover, refresh],
  );

  return {
    status,
    error,
    pending,
    refresh,
    start,
    pause: () => run(() => apiPost<DriveStatus>("/v1/sim/pause", {}, 5000), "Pause", (s) => Boolean(s.paused)),
    resume: () =>
      run(() => apiPost<DriveStatus>("/v1/sim/resume", {}, 5000), "Resume", (s) => Boolean(s.running && !s.paused)),
    stop: () => run(() => apiPost<DriveStatus>("/v1/sim/stop", {}, 12000), "Stop", (s) => !s.running),
    reset: () =>
      run(
        () => apiPost<DriveStatus>("/v1/sim/reset", {}, 15000),
        "Reset",
        (s) => !s.running && (s.control === "reset" || s.stopped),
      ),
  };
}
