import { useEffect, useRef, useState } from "react";

type EngineStatus = {
  engine?: string;
  connected?: boolean;
  message?: string;
  map_name?: string;
  fps?: number;
  hero_vehicle?: string;
  setup?: Record<string, string>;
};

export function EngineViewport() {
  const [status, setStatus] = useState<EngineStatus>({
    engine: "CARLA / Unreal Engine",
    connected: false,
    message: "Connecting to simulation engine…",
  });
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const blobRef = useRef<string | null>(null);

  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${window.location.host}/ws/sim`);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.status) setStatus(msg.status);
        } catch {
          /* ignore */
        }
        return;
      }
      const blob = new Blob([ev.data], { type: "image/jpeg" });
      const url = URL.createObjectURL(blob);
      if (blobRef.current) URL.revokeObjectURL(blobRef.current);
      blobRef.current = url;
      setFrameUrl(url);
    };

    ws.onerror = () => {
      setStatus((s) => ({
        ...s,
        connected: false,
        message: "Simulation engine stream unavailable — start CARLA + bridge",
      }));
    };

    return () => {
      ws.close();
      if (blobRef.current) URL.revokeObjectURL(blobRef.current);
    };
  }, []);

  useEffect(() => {
    fetch("/v1/sim/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => {});
    const id = setInterval(() => {
      fetch("/v1/sim/status")
        .then((r) => r.json())
        .then(setStatus)
        .catch(() => {});
    }, 5000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="relative w-full h-full min-h-[520px] rounded-lg overflow-hidden border border-slate-700/60 bg-black shadow-2xl">
      {/* CARLA / Unreal video stream */}
      {frameUrl ? (
        <img
          src={frameUrl}
          alt="CARLA simulation engine view"
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-b from-slate-950 to-black p-8 text-center">
          <div className="text-4xl mb-4 opacity-30">🎮</div>
          <h2 className="text-lg font-bold text-cyan-400 mb-2">CARLA / Unreal Engine Simulation</h2>
          <p className="text-sm text-slate-400 max-w-md mb-6">{status.message}</p>
          <div className="text-left text-xs text-slate-500 bg-slate-900/80 border border-slate-800 rounded-lg p-4 max-w-lg space-y-2">
            <p className="text-slate-300 font-semibold mb-2">Start the game-engine stack:</p>
            {status.setup &&
              Object.entries(status.setup).map(([k, v]) => (
                <div key={k}>
                  <span className="text-cyan-600">{k}:</span>{" "}
                  <code className="text-slate-300">{v}</code>
                </div>
              ))}
            {!status.setup && (
              <>
                <p>1. CARLA server: <code>./CarlaUE4.sh -prefernvidia -quality-level=Epic</code></p>
                <p>2. Bridge: <code>python sim/carla/prevail_bridge.py</code></p>
                <p>3. See <code>sim/carla/ARCHITECTURE.md</code></p>
              </>
            )}
          </div>
        </div>
      )}

      {/* HUD overlay */}
      <div className="absolute top-3 left-3 flex gap-2 z-10">
        <span className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider bg-black/70 border border-cyan-500/40 text-cyan-300 rounded">
          {status.engine ?? "Simulation Engine"}
        </span>
        <span
          className={`px-2 py-1 text-[10px] font-bold uppercase rounded ${
            status.connected
              ? "bg-emerald-950 text-emerald-400 border border-emerald-700"
              : "bg-amber-950 text-amber-400 border border-amber-700"
          }`}
        >
          {status.connected ? "● Engine Live" : "○ Engine Offline"}
        </span>
        {status.fps != null && status.fps > 0 && (
          <span className="px-2 py-1 text-[10px] bg-black/70 text-slate-400 rounded">
            {status.fps.toFixed(0)} FPS
          </span>
        )}
      </div>
      {status.map_name && (
        <div className="absolute bottom-3 left-3 text-[10px] text-slate-500 bg-black/60 px-2 py-1 rounded z-10">
          {status.map_name} · {status.hero_vehicle ?? "hero vehicle"}
        </div>
      )}
    </div>
  );
}
