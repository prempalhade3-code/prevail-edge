import L from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, Marker, Polygon, Polyline, TileLayer, useMap } from "react-leaflet";
import { CITIES, cityFor, edgeSequenceForCities } from "../data/cities";
import { corridorSlice } from "../data/corridor";
import { DEFAULT_CENTER, EDGE_REGIONS } from "../data/regions";
import type { VehiclePose } from "../hooks/useSmoothedVehicle";
import { edgeLabel, roleFromTopology, roleLabel, topPredicted } from "../lib/format";
import type { DriveStatus, SystemSnapshot } from "../types";

const EDGE_INK = "#334155";
const EDGE_ACCENT = "#2563eb";
const PREDICT_ACCENT = "#6d28d9";
const SHADOW_ACCENT = "#0891b2";

function roleStroke(role?: string, predicted?: boolean): string {
  if (role === "FAILED") return "#dc2626";
  if (role === "AUTHORITATIVE") return EDGE_ACCENT;
  if (role === "WARM_SHADOW") return SHADOW_ACCENT;
  if (predicted) return PREDICT_ACCENT;
  return EDGE_INK;
}

function roleBadge(role?: string, predicted?: boolean): string {
  if (role === "AUTHORITATIVE") return "authority";
  if (role === "WARM_SHADOW") return "shadow";
  if (predicted) return "predicted";
  return roleLabel(role);
}

function vehicleIcon(heading: number): L.DivIcon {
  return L.divIcon({
    className: "vehicle-marker-wrap",
    iconSize: [48, 48],
    iconAnchor: [24, 24],
    html: `<div class="vehicle-marker" style="transform: rotate(${heading}deg)">
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
        <circle cx="24" cy="24" r="20" fill="rgba(37,99,235,0.16)"/>
        <path d="M24 6 L35 38 L24 31 L13 38 Z" fill="#0b1220"/>
        <circle cx="24" cy="24" r="5" fill="#60a5fa"/>
      </svg>
    </div>`,
  });
}

function edgeIcon(id: string, role: string, predicted: boolean): L.DivIcon {
  const badge = roleBadge(role, predicted);
  const color = roleStroke(role, predicted);
  const pulse =
    role === "AUTHORITATIVE" || role === "WARM_SHADOW"
      ? `<span class="edge-pulse" style="background:${role === "AUTHORITATIVE" ? "rgba(37,99,235,0.24)" : "rgba(8,145,178,0.24)"}"></span>`
      : "";
  return L.divIcon({
    className: "edge-node",
    iconSize: [168, 36],
    iconAnchor: [18, 18],
    html: `<div class="edge-server">
      ${pulse}
      <span class="edge-diamond" style="border-color:${color};box-shadow:0 0 0 4px ${color}22"></span>
      <span class="edge-caption">${edgeLabel(id)} · ${badge}</span>
    </div>`,
  });
}

function cityIcon(name: string, kind: "from" | "to" | "city"): L.DivIcon {
  const color = kind === "from" ? EDGE_ACCENT : kind === "to" ? PREDICT_ACCENT : "#0b1220";
  const tag = kind === "from" ? " · from" : kind === "to" ? " · to" : "";
  return L.divIcon({
    className: "edge-node",
    iconSize: [180, 28],
    iconAnchor: [8, 14],
    html: `<div class="city-label">
      <span class="city-dot" style="background:${color}"></span>
      <span>${name}${tag}</span>
    </div>`,
  });
}

function MapDirector({
  source,
  destination,
  pose,
  follow,
  running,
  route,
  extra,
}: {
  source?: string;
  destination?: string;
  pose: VehiclePose;
  follow: boolean;
  running: boolean;
  route: [number, number][];
  extra: [number, number][];
}) {
  const map = useMap();
  const fitted = useRef("");

  useEffect(() => {
    const invalidate = () => map.invalidateSize();
    invalidate();
    const observer = new ResizeObserver(invalidate);
    observer.observe(map.getContainer());
    window.addEventListener("resize", invalidate);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", invalidate);
    };
  }, [map]);

  useEffect(() => {
    const key = `${source}-${destination}-${running ? "run" : "idle"}`;
    const points = [...route, ...extra];
    if (points.length < 2) return;
    if (running && follow && fitted.current === key) return;
    const bounds = L.latLngBounds(points);
    map.flyToBounds(bounds, { padding: [72, 72], maxZoom: 13, duration: 0.85 });
    fitted.current = key;
  }, [destination, extra, follow, map, route, running, source]);

  useEffect(() => {
    if (!follow || !running || !pose.ready) return;
    map.panTo([pose.lat, pose.lon], { animate: true, duration: 0.4 });
  }, [follow, map, pose.lat, pose.lon, pose.ready, running]);

  return null;
}

function useDrawnRoute(route: [number, number][], key: string) {
  const [count, setCount] = useState(route.length);
  useEffect(() => {
    if (route.length < 2) {
      setCount(route.length);
      return;
    }
    setCount(1);
    const id = window.setInterval(() => {
      setCount((n) => {
        if (n >= route.length) {
          window.clearInterval(id);
          return route.length;
        }
        return n + 1;
      });
    }, 40);
    return () => window.clearInterval(id);
  }, [key, route.length]);
  return route.slice(0, Math.max(count, 0));
}

export function LiveMap({
  snapshot,
  drive,
  follow,
  pose,
  source,
  destination,
}: {
  snapshot: SystemSnapshot | null;
  drive: DriveStatus | null;
  follow: boolean;
  pose: VehiclePose;
  source: string;
  destination: string;
}) {
  const live = Boolean(drive?.running);
  const holder = snapshot?.authority.holder_edge_id;
  const predicted = live ? topPredicted(snapshot?.prediction?.probabilities).edge : null;
  const shadows = new Set((snapshot?.shadows ?? []).filter((s) => s.role === "WARM_SHADOW").map((s) => s.edge_id));
  const trail = live ? (snapshot?.vehicle_trail ?? []).map((p) => [p.latitude, p.longitude] as [number, number]) : [];
  const fromId = live && drive?.source ? drive.source : source;
  const toId = live && drive?.destination ? drive.destination : destination;
  const planned = useMemo(() => corridorSlice(fromId, toId), [fromId, toId]);
  const drawn = useDrawnRoute(planned, `${fromId}-${toId}`);
  const roleByEdge = new Map((snapshot?.topology ?? []).map((n) => [n.edge_id, n.role]));
  const extra = useMemo(() => {
    const relevant = new Set(edgeSequenceForCities(fromId, toId));
    const pts: [number, number][] = [];
    for (const id of [fromId, toId]) {
      const city = cityFor(id);
      if (city) pts.push([city.latitude, city.longitude]);
    }
    for (const region of EDGE_REGIONS) {
      if (relevant.has(region.edge_id) || region.edge_id === holder || (predicted && region.edge_id === predicted)) {
        pts.push([region.latitude, region.longitude]);
      }
    }
    return pts;
  }, [fromId, holder, predicted, toId]);
  const traffic = live ? (snapshot?.traffic_vehicles ?? []).slice(0, 18) : [];

  return (
    <MapContainer
      center={DEFAULT_CENTER}
      zoom={12}
      className="h-full w-full"
      zoomControl
      attributionControl={false}
    >
      <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
      <MapDirector
        source={fromId}
        destination={toId}
        pose={pose}
        follow={follow}
        running={live}
        route={planned}
        extra={extra}
      />

      {EDGE_REGIONS.map((region) => {
        const role = roleFromTopology(region.edge_id, holder, snapshot?.shadows, roleByEdge.get(region.edge_id));
        const isPredicted = predicted === region.edge_id;
        const color = roleStroke(role, isPredicted);
        return (
          <Polygon
            key={region.edge_id}
            positions={region.polygon}
            pathOptions={{
              color,
              weight: role === "AUTHORITATIVE" ? 2.4 : isPredicted ? 2 : 1,
              dashArray: isPredicted && role !== "AUTHORITATIVE" ? "7 6" : undefined,
              fillColor: color,
              fillOpacity: role === "AUTHORITATIVE" ? 0.1 : shadows.has(region.edge_id) ? 0.07 : 0.03,
            }}
          />
        );
      })}

      {drawn.length > 1 && (
        <Polyline positions={drawn} pathOptions={{ color: "#2563eb", weight: 6, opacity: 0.22, lineCap: "round" }} />
      )}
      {planned.length > 1 && (
        <Polyline positions={planned} pathOptions={{ color: "#0b1220", weight: 2.5, opacity: 0.35, lineCap: "round" }} />
      )}
      {trail.length > 1 && (
        <Polyline positions={trail} pathOptions={{ color: "#2563eb", weight: 5, opacity: 0.9, lineCap: "round" }} />
      )}
      {trail.length > 0 && pose.ready && live && (
        <Polyline
          positions={[trail[trail.length - 1], [pose.lat, pose.lon]]}
          pathOptions={{ color: "#2563eb", weight: 5, opacity: 0.95 }}
        />
      )}

      {CITIES.map((city) => {
        const kind = city.id === fromId ? "from" : city.id === toId ? "to" : "city";
        return (
          <Marker
            key={city.id}
            position={[city.latitude, city.longitude]}
            icon={cityIcon(city.name, kind)}
            zIndexOffset={kind === "city" ? 180 : 460}
            interactive={false}
          />
        );
      })}

      {EDGE_REGIONS.map((region) => {
        const role = roleFromTopology(region.edge_id, holder, snapshot?.shadows, roleByEdge.get(region.edge_id));
        const isPredicted = predicted === region.edge_id;
        return (
          <Marker
            key={`${region.edge_id}-chip`}
            position={[region.latitude, region.longitude]}
            icon={edgeIcon(region.edge_id, role, isPredicted)}
            zIndexOffset={520}
            interactive={false}
          />
        );
      })}

      {traffic.map((car) => (
        <Marker
          key={car.vehicle_id}
          position={[car.latitude, car.longitude]}
          icon={L.divIcon({
            className: "vehicle-marker-wrap",
            iconSize: [6, 6],
            iconAnchor: [3, 3],
            html: `<div style="width:6px;height:6px;border-radius:99px;background:#94a3b8;opacity:0.35"></div>`,
          })}
          zIndexOffset={40}
          interactive={false}
        />
      ))}

      {live && pose.ready && (
        <Marker position={[pose.lat, pose.lon]} icon={vehicleIcon(pose.heading)} zIndexOffset={900} />
      )}
    </MapContainer>
  );
}
