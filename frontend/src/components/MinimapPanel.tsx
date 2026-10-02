import { useEffect, useMemo, useState } from "react";
import { Circle, MapContainer, Marker, Polyline, TileLayer } from "react-leaflet";
import L from "leaflet";
import type { SystemSnapshot } from "../types";

function roleColor(role: string): string {
  if (role === "AUTHORITATIVE") return "#10b981";
  if (role === "WARM_SHADOW") return "#f59e0b";
  return "#64748b";
}

const heroIcon = L.divIcon({
  className: "",
  html: `<div style="width:10px;height:10px;background:#22d3ee;border-radius:50%;box-shadow:0 0 8px #22d3ee;border:2px solid white;"></div>`,
  iconSize: [10, 10],
  iconAnchor: [5, 5],
});

export function MinimapPanel({ snapshot }: { snapshot: SystemSnapshot | null }) {
  const [roads, setRoads] = useState<[number, number][][]>([]);

  useEffect(() => {
    fetch("/sim/network/bangalore-corridor.geojson")
      .then((r) => r.json())
      .then((geo) => {
        const lines: [number, number][][] = [];
        for (const f of geo.features ?? []) {
          const g = f.geometry;
          if (g?.type === "LineString") {
            lines.push(g.coordinates.map((c: number[]) => [c[1], c[0]] as [number, number]));
          }
        }
        setRoads(lines);
      })
      .catch(() => setRoads([]));
  }, []);

  const center: [number, number] =
    snapshot?.vehicle_latitude != null && snapshot?.vehicle_longitude != null
      ? [snapshot.vehicle_latitude, snapshot.vehicle_longitude]
      : [12.9716, 77.5946];

  const trail = useMemo(
    () => snapshot?.vehicle_trail?.map((p) => [p.latitude, p.longitude] as [number, number]) ?? [],
    [snapshot?.vehicle_trail],
  );

  return (
    <div className="rounded-lg overflow-hidden border border-slate-700/80 bg-slate-950">
      <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 border-b border-slate-800">
        Tactical Map
      </div>
      <div className="h-44 w-full">
        <MapContainer center={center} zoom={14} className="h-full w-full" zoomControl={false} attributionControl={false}>
          <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}" />
          {roads.map((line, i) => (
            <Polyline key={i} positions={line} pathOptions={{ color: "#64748b", weight: 3 }} />
          ))}
          {trail.length > 1 && (
            <Polyline positions={trail} pathOptions={{ color: "#22d3ee", weight: 2 }} />
          )}
          {snapshot?.topology.map((n) => (
            <Circle
              key={n.edge_id}
              center={[n.latitude, n.longitude]}
              radius={200}
              pathOptions={{ color: roleColor(n.role), fillColor: roleColor(n.role), fillOpacity: 0.15, weight: 1 }}
            />
          ))}
          {snapshot?.traffic_vehicles?.map((v) => (
            <Circle
              key={v.vehicle_id}
              center={[v.latitude, v.longitude]}
              radius={15}
              pathOptions={{ color: "#fbbf24", fillColor: "#fbbf24", fillOpacity: 0.9 }}
            />
          ))}
          {snapshot?.vehicle_latitude != null && snapshot?.vehicle_longitude != null && (
            <Marker position={[snapshot.vehicle_latitude, snapshot.vehicle_longitude]} icon={heroIcon} />
          )}
        </MapContainer>
      </div>
    </div>
  );
}
