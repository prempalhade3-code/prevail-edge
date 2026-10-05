import { useEffect, useState } from "react";
import { apiGet } from "../lib/api";
import type { HealthStatus, HistoryMetric, LiveAccuracy, LiveMetrics, TimelineEvent } from "../types";

export function useHistoryData(active: boolean) {
  const [accuracy, setAccuracy] = useState<LiveAccuracy | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [metrics, setMetrics] = useState<HistoryMetric[]>([]);
  const [liveMetrics, setLiveMetrics] = useState<LiveMetrics | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    const pullHealth = async () => {
      try {
        const hp = await apiGet<HealthStatus>("/health", 4000);
        if (!cancelled) {
          setHealth(hp);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    };

    const pullHistory = async () => {
      try {
        const [acc, ev, met, live] = await Promise.all([
          apiGet<LiveAccuracy>("/v1/history/accuracy", 6000),
          apiGet<TimelineEvent[]>("/v1/history/events?limit=80", 8000),
          apiGet<HistoryMetric[]>("/v1/history/metrics?limit=80", 8000),
          apiGet<LiveMetrics>("/v1/metrics", 6000),
        ]);
        if (cancelled) return;
        setAccuracy(acc);
        setEvents(Array.isArray(ev) ? ev : []);
        setMetrics(Array.isArray(met) ? met : []);
        setLiveMetrics(live);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    };

    void pullHealth();
    void pullHistory();
    const healthId = window.setInterval(() => void pullHealth(), 2500);
    const historyId = window.setInterval(() => void pullHistory(), 8000);
    return () => {
      cancelled = true;
      window.clearInterval(healthId);
      window.clearInterval(historyId);
    };
  }, [active]);

  return { accuracy, events, metrics, liveMetrics, health, error };
}
