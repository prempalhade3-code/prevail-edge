import { useEffect, useMemo, useState } from "react";
import { Circle, MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import type { SystemSnapshot } from "../types";

function roleColor(role: string): string {
  if (role === "AUTHORITATIVE") return "#10b981";
  if (role === "WARM_SHADOW") return "#f59e0b";
  return "#64748b";
}

function FollowVehicle({ lat, lon, heading }: { lat: number; lon: number; heading?: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lon], Math.max(map.getZoom(), 15), { animate: true, duration: 0.5 });
  }, [lat, lon, map]);
  return null;
}

function vehicleIcon(heading = 0) {
  return L.divIcon({
    className: "",
    html: `<div style="transform:rotate(${heading}deg);width:24px;height:24px;display:flex;align-items:center;justify-content:center;">
      <div style="width:0;height:0;border-left:10px solid transparent;border-right:10px solid transparent;border-bottom:22px solid #22d3ee;filter:drop-shadow(0 0 8px #22d3ee);"></div>
    </div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

function parseRoads(geo: GeoJSON.FeatureCollection): [number, number][][] {
  const lines: [number, number][][] = [];
  for (const f of geo.features ?? []) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === "LineString") {
      lines.push(g.coordinates.map((c) => [c[1], c[0]] as [number, number]));
    } else if (g.type === "MultiLineString") {
      for (const line of g.coordinates) {
        lines.push(line.map((c) => [c[1], c[0]] as [number, number]));
      }
    }
  }
  return lines;
}

export function EdgeMap({ snapshot }: { snapshot: SystemSnapshot | null }) {
  const [roads, setRoads] = useState<[number, number][][]>([]);

  useEffect(() => {
    fetch("/sim/network/bangalore-corridor.geojson")
      .then((r) => r.json())
      .then((geo) => setRoads(parseRoads(geo)))
      .catch(() => setRoads([]));
  }, []);

  const center: [number, number] =
    snapshot?.vehicle_latitude != null && snapshot?.vehicle_longitude != null
      ? [snapshot.vehicle_latitude, snapshot.vehicle_longitude]
      : snapshot?.topology[0]
        ? [snapshot.topology[0].latitude, snapshot.topology[0].longitude]
        : [12.9716, 77.5946];

  const trail = useMemo(
    () =>
      snapshot?.vehicle_trail?.map((p) => [p.latitude, p.longitude] as [number, number]) ?? [],
    [snapshot?.vehicle_trail],
  );

  const heading = snapshot?.vehicle_heading ?? 0;

  return (
    <div className="h-[32rem] w-full rounded-lg overflow-hidden border border-cyan-900/50 relative shadow-[0_0_24px_rgba(34,211,238,0.15)]">
      <div className="absolute top-2 left-2 z-[1000] text-xs bg-black/70 px-2 py-1 rounded text-cyan-300 border border-cyan-800">
        Live sim · cyan car · amber traffic · road network
      </div>
      {snapshot?.vehicle_latitude != null && (
        <div className="absolute top-2 right-2 z-[1000] text-xs bg-black/70 px-2 py-1 rounded text-emerald-300">
          Car: {snapshot.vehicle_latitude.toFixed(4)}, {snapshot.vehicle_longitude?.toFixed(4)}
        </div>
      )}
      <MapContainer center={center} zoom={15} className="h-full w-full bg-slate-900" scrollWheelZoom>
        <TileLayer
          attribution='&copy; Esri'
          url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
        />
        {roads.map((line, i) => (
          <Polyline
            key={`road-${i}`}
            positions={line}
            pathOptions={{ color: "#64748b", weight: 5, opacity: 0.9 }}
          />
        ))}
        {trail.length > 1 && (
          <Polyline positions={trail} pathOptions={{ color: "#22d3ee", weight: 4, opacity: 1 }} />
        )}
        {snapshot?.topology.map((node) => (
          <Circle
            key={node.edge_id}
            center={[node.latitude, node.longitude]}
            radius={320}
            pathOptions={{
              color: roleColor(node.role),
              fillColor: roleColor(node.role),
              fillOpacity: 0.2,
              weight: 2,
            }}
          >
            <Popup>
              <strong>{node.edge_id}</strong>
              <br />
              Role: {node.role}
            </Popup>
          </Circle>
        ))}
        {snapshot?.traffic_vehicles?.map((v) => (
          <Circle
            key={v.vehicle_id}
            center={[v.latitude, v.longitude]}
            radius={18}
            pathOptions={{
              color: "#fbbf24",
              fillColor: "#fbbf24",
              fillOpacity: 0.95,
              weight: 2,
            }}
          />
        ))}
        {snapshot?.vehicle_latitude != null && snapshot?.vehicle_longitude != null && (
          <>
            <FollowVehicle
              lat={snapshot.vehicle_latitude}
              lon={snapshot.vehicle_longitude}
              heading={heading}
            />
            <Marker
              position={[snapshot.vehicle_latitude, snapshot.vehicle_longitude]}
              icon={vehicleIcon(heading)}
            />
          </>
        )}
      </MapContainer>
    </div>
  );
}
