import { useEffect, useMemo, useState } from "react";
import { Circle, MapContainer, Marker, Polyline, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import type { SystemSnapshot } from "../types";

function roleColor(role: string): string {
  if (role === "AUTHORITATIVE") return "#10b981";
  if (role === "WARM_SHADOW") return "#f59e0b";
  return "#64748b";
}

const heroIcon = L.divIcon({
  className: "",
  html: `<div style="width:14px;height:14px;background:#22d3ee;border-radius:50%;box-shadow:0 0 12px #22d3ee;border:2px solid white;"></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

function MapFollower({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, map.getZoom(), { animate: true, duration: 0.4 });
  }, [center, map]);
  return null;
}

export function MinimapPanel({ snapshot }: { snapshot: SystemSnapshot | null }) {
  const [roads, setRoads] = useState<[number, number][][]>([]);

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
        setRoads(lines);
      })
      .catch(() => setRoads([]));
  }, []);

  const center: [number, number] =
    snapshot?.vehicle_latitude != null && snapshot?.vehicle_longitude != null
      ? [snapshot.vehicle_latitude, snapshot.vehicle_longitude]
      : [12.94, 77.686];

  const trail = useMemo(
    () => snapshot?.vehicle_trail?.map((p) => [p.latitude, p.longitude] as [number, number]) ?? [],
    [snapshot?.vehicle_trail],
  );

  const predictedEdge = useMemo(() => {
    if (!snapshot?.prediction?.probabilities) return null;
    const current = snapshot.current_edge_id;
    const ranked = Object.entries(snapshot.prediction.probabilities)
      .filter(([id]) => id !== current)
      .sort(([, a], [, b]) => b - a);
    if (!ranked.length) return null;
    const [edgeId] = ranked[0];
    return snapshot.topology?.find((n) => n.edge_id === edgeId) ?? null;
  }, [snapshot?.prediction, snapshot?.current_edge_id, snapshot?.topology]);

  return (
    <div className="rounded-xl overflow-hidden border border-white/10 bg-black/55 backdrop-blur-xl shadow-2xl">
      <div className="px-3 py-2 border-b border-white/10 flex justify-between items-center">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-white/60">Tactical Map</span>
        <span className="text-[10px] font-mono text-cyan-300/90">{snapshot?.current_edge_id ?? "—"}</span>
      </div>
      <div className="h-64 w-full">
        <MapContainer center={center} zoom={15} className="h-full w-full" zoomControl={false} attributionControl={false}>
          <MapFollower center={center} />
          <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}" />
          {roads.map((line, i) => (
            <Polyline key={i} positions={line} pathOptions={{ color: "#475569", weight: 4, opacity: 0.9 }} />
          ))}
          {trail.length > 1 && (
            <Polyline positions={trail} pathOptions={{ color: "#22d3ee", weight: 3, opacity: 0.85 }} />
          )}
          {snapshot?.topology.map((n) => (
            <Circle
              key={n.edge_id}
              center={[n.latitude, n.longitude]}
              radius={n.role === "AUTHORITATIVE" ? 120 : 90}
              pathOptions={{
                color: roleColor(n.role),
                fillColor: roleColor(n.role),
                fillOpacity: n.role === "WARM_SHADOW" ? 0.2 : 0.1,
                weight: n.role === "AUTHORITATIVE" ? 2 : 1,
              }}
            />
          ))}
          {predictedEdge && (
            <Circle
              center={[predictedEdge.latitude, predictedEdge.longitude]}
              radius={100}
              pathOptions={{ color: "#8b5cf6", fillColor: "#7c3aed", fillOpacity: 0.12, weight: 2, dashArray: "6 4" }}
            />
          )}
          {snapshot?.traffic_vehicles?.map((v) => (
            <Circle
              key={v.vehicle_id}
              center={[v.latitude, v.longitude]}
              radius={10}
              pathOptions={{ color: "#fbbf24", fillColor: "#fbbf24", fillOpacity: 0.8, weight: 0 }}
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
