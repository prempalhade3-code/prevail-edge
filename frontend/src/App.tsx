import { useMemo, useState } from "react";
import { AppHeader } from "./components/AppHeader";
import { useDriveControls } from "./hooks/useDriveControls";
import { useHistoryData } from "./hooks/useHistoryData";
import { useLiveSnapshot } from "./hooks/useLiveSnapshot";
import { useSmoothedVehicle } from "./hooks/useSmoothedVehicle";
import { mergeEvents, visibleEvents } from "./lib/events";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { EdgesPage } from "./pages/EdgesPage";
import { HealthPage } from "./pages/HealthPage";
import { PredictionPage } from "./pages/PredictionPage";
import { ResiliencePage } from "./pages/ResiliencePage";
import { ShadowsPage } from "./pages/ShadowsPage";
import { SimulationPage } from "./pages/SimulationPage";
import { TimelinePage } from "./pages/TimelinePage";
import { DEFAULT_FROM, DEFAULT_TO, isCityId } from "./data/cities";
import { useGeoCities } from "./hooks/useGeoCities";
import type { NavId } from "./types";

function storedCity(key: string, fallback: string): string {
  const value = sessionStorage.getItem(key);
  return value && isCityId(value) ? value : fallback;
}

export default function App() {
  const { snapshot, connected, error } = useLiveSnapshot();
  const drive = useDriveControls();
  const history = useHistoryData(true);
  const [nav, setNav] = useState<NavId>("live");
  const [source, setSource] = useState(() => storedCity("prevail.from", DEFAULT_FROM));
  const [destination, setDestination] = useState(() => storedCity("prevail.to", DEFAULT_TO));
  const [runStartedAt, setRunStartedAt] = useState(0);
  const pose = useSmoothedVehicle(snapshot?.vehicle_latitude, snapshot?.vehicle_longitude, snapshot?.vehicle_heading);
  const cities = useGeoCities();

  const events = useMemo(
    () => mergeEvents(snapshot?.timeline ?? [], history.events),
    [history.events, snapshot?.timeline],
  );
  const visible = visibleEvents(events, 240);
  const liveEvents = useMemo(() => {
    const rows = visibleEvents(snapshot?.timeline ?? [], 160);
    const runId = snapshot?.run_id;
    const scoped = runId ? rows.filter((event) => event.run_id === runId) : rows;
    if (!runStartedAt) return scoped;
    return scoped.filter((event) => event.timestamp_ms >= runStartedAt - 1500);
  }, [runStartedAt, snapshot?.run_id, snapshot?.timeline]);

  return (
    <div className="flex h-full min-h-0 flex-col text-ink">
      <AppHeader
        nav={nav}
        setNav={setNav}
        connected={connected}
        drive={drive.status}
        health={history.health}
        liveMetrics={history.liveMetrics}
      />
      {error && !connected && !snapshot && (
        <p className="mx-6 mt-3 rounded-2xl bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</p>
      )}

      <main className={`flex min-h-0 flex-1 flex-col ${nav === "live" ? "overflow-hidden" : "overflow-auto"}`}>
        {nav === "live" && (
          <SimulationPage
            snapshot={snapshot}
            drive={drive.status}
            pose={pose}
            events={visible}
            liveEvents={liveEvents}
            cities={cities}
            source={source}
            destination={destination}
            setSource={(id) => {
              sessionStorage.setItem("prevail.from", id);
              setSource(id);
            }}
            setDestination={(id) => {
              sessionStorage.setItem("prevail.to", id);
              setDestination(id);
            }}
            pending={drive.pending}
            error={drive.error}
            onStart={() => {
              void drive.start(source, destination).then((next) => {
                if (next?.running) setRunStartedAt(Date.now());
              });
            }}
            onPause={() => void drive.pause()}
            onResume={() => void drive.resume()}
            onStop={() => void drive.stop()}
            onReset={() => void drive.reset()}
          />
        )}
        {nav === "edges" && <EdgesPage snapshot={snapshot} events={visible} />}
        {nav === "prediction" && (
          <PredictionPage snapshot={snapshot} events={visible} drive={drive.status} accuracy={history.accuracy} />
        )}
        {nav === "shadows" && <ShadowsPage snapshot={snapshot} events={visible} />}
        {nav === "analytics" && (
          <AnalyticsPage
            snapshot={snapshot}
            accuracy={history.accuracy}
            metrics={history.metrics}
            liveMetrics={history.liveMetrics}
            events={visible}
          />
        )}
        {nav === "timeline" && <TimelinePage events={visible} />}
        {nav === "health" && (
          <HealthPage
            snapshot={snapshot}
            health={history.health}
            liveMetrics={history.liveMetrics}
            connected={connected}
          />
        )}
        {nav === "resilience" && (
          <ResiliencePage snapshot={snapshot} events={visible} liveMetrics={history.liveMetrics} />
        )}
      </main>
    </div>
  );
}
