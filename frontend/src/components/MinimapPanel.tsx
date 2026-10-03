import { useEffect, useRef } from "react";
import type { SystemSnapshot } from "../types";
import { ORIGIN_LAT, ORIGIN_LON } from "../lib/geo";

const W = 280;
const H = 200;

function roleColor(role: string): string {
  if (role === "AUTHORITATIVE") return "#34d399";
  if (role === "WARM_SHADOW") return "#fbbf24";
  return "#64748b";
}

export function MinimapPanel({ snapshot }: { snapshot: SystemSnapshot | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const roadsRef = useRef<[number, number][][]>([]);

  useEffect(() => {
    fetch("/city/roads.geojson")
      .then((r) => r.json())
      .then((geo) => {
        const lines: [number, number][][] = [];
        for (const f of geo.features ?? []) {
          const g = f.geometry;
          if (g?.type === "LineString") {
            lines.push(g.coordinates.map((c: number[]) => [c[1], c[0]] as [number, number]));
          }
        }
        roadsRef.current = lines;
      })
      .catch(() => {
        roadsRef.current = [];
      });
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const lat = snapshot?.vehicle_latitude ?? ORIGIN_LAT;
    const lon = snapshot?.vehicle_longitude ?? ORIGIN_LON;
    const span = 0.012;
    const toX = (lng: number) => ((lng - (lon - span)) / (span * 2)) * W;
    const toY = (la: number) => (1 - (la - (lat - span)) / (span * 2)) * H;

    ctx.fillStyle = "#070b12";
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (const line of roadsRef.current) {
      line.forEach(([la, lng], i) => {
        const x = toX(lng);
        const y = toY(la);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
    }
    ctx.stroke();

    const trail = snapshot?.vehicle_trail ?? [];
    if (trail.length > 1) {
      ctx.strokeStyle = "#22d3ee";
      ctx.lineWidth = 2;
      ctx.beginPath();
      trail.forEach((p, i) => {
        const x = toX(p.longitude);
        const y = toY(p.latitude);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    for (const n of snapshot?.topology ?? []) {
      ctx.beginPath();
      ctx.fillStyle = roleColor(n.role);
      ctx.globalAlpha = 0.85;
      ctx.arc(toX(n.longitude), toY(n.latitude), n.role === "AUTHORITATIVE" ? 5 : 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.beginPath();
    ctx.fillStyle = "#f8fafc";
    ctx.shadowColor = "#22d3ee";
    ctx.shadowBlur = 12;
    ctx.arc(toX(lon), toY(lat), 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }, [snapshot]);

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/75 shadow-2xl backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/50">Corridor</span>
        <span className="font-mono text-[10px] text-cyan-300">{snapshot?.current_edge_id ?? "—"}</span>
      </div>
      <canvas ref={canvasRef} width={W} height={H} className="block h-[200px] w-full" />
    </div>
  );
}
