import L from "leaflet";
import { useEffect, useMemo, useRef } from "react";
import { Circle, MapContainer, Marker, Polygon, Polyline, TileLayer, useMap } from "react-leaflet";
import { cityFor, cityPath } from "../data/cities";
import { edgeSequenceForRoadPath } from "../lib/roadGraphRoute";
import { corridorSlice } from "../data/corridor";
import { DEFAULT_CENTER, EDGE_REGIONS } from "../data/regions";
import type { VehiclePose } from "../hooks/useSmoothedVehicle";
import { edgeLabel, roleFromTopology, roleLabel, topPredicted } from "../lib/format";
import type { SimVehicle } from "../data/vehicles";
import { VehicleMarker } from "./vehicle/VehicleMarker";
import { edgeTowerUnit, endpointUnit } from "../lib/mapIcons";
import type { DriveStatus, SystemSnapshot } from "../types";
import { MapMarkerScale } from "./MapMarkerScale";
import { MapVisualLayer, type MapVisualItem } from "./MapVisualLayer";

const PREVAIL_ACCENT = "#2563eb";
const INK = "#334155";
const SHADOW_ACCENT = "#0891b2";

function roleStroke(role?: string): string {
  if (role === "FAILED") return "#dc2626";
  if (role === "AUTHORITATIVE") return PREVAIL_ACCENT;
  if (role === "WARM_SHADOW") return SHADOW_ACCENT;
  return INK;
}

function roleBadge(role?: string, predicted?: boolean): string {
  if (role === "AUTHORITATIVE") return "authority";
  if (role === "WARM_SHADOW") return "shadow";
  if (predicted) return "predicted";
  return roleLabel(role);
}

function cityCaption(name: string): string {
  return name.toLowerCase();
}

function divIcon(html: string, size: [number, number], anchor: [number, number], className = ""): L.DivIcon {
  return L.divIcon({
    className: className || "map-icon-wrap",
    iconSize: size,
    iconAnchor: anchor,
    html,
  });
}

function MapPanes() {
  const map = useMap();
  useEffect(() => {
    const panes: [string, string][] = [
      ["zones", "330"],
      ["routes", "400"],
      ["vehicle", "680"],
      ["vehicle-fx", "670"],
    ];
    for (const [name, z] of panes) {
      if (!map.getPane(name)) {
        map.createPane(name);
        map.getPane(name)!.style.zIndex = z;
      }
    }
  }, [map]);
  return null;
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
  const fittedRoute = useRef("");

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
    const routeKey = `${source}-${destination}`;
    if (routeKey === fittedRoute.current) return;
    const points = [...route, ...extra];
    if (points.length < 2) return;
    map.flyToBounds(L.latLngBounds(points), {
      padding: [88, 88],
      maxZoom: 13,
      duration: 1,
      easeLinearity: 0.22,
    });
    fittedRoute.current = routeKey;
  }, [destination, extra, map, route, source]);

  useEffect(() => {
    if (!follow || !running || !pose.ready) return;
    map.panTo([pose.lat, pose.lon], { animate: true, duration: 0.45, easeLinearity: 0.25 });
  }, [follow, map, pose.lat, pose.lon, pose.ready, running]);

  return null;
}

export function LiveMap({
  snapshot,
  drive,
  follow,
  pose,
  source,
  destination,
  vehicle,
  moving,
}: {
  snapshot: SystemSnapshot | null;
  drive: DriveStatus | null;
  follow: boolean;
  pose: VehiclePose;
  source: string;
  destination: string;
  vehicle: SimVehicle;
  moving: boolean;
}) {
  const live = Boolean(drive?.running);
  const holder = snapshot?.authority.holder_edge_id;
  const predicted = live ? topPredicted(snapshot?.prediction?.probabilities).edge : null;
  const shadows = new Set((snapshot?.shadows ?? []).filter((s) => s.role === "WARM_SHADOW").map((s) => s.edge_id));
  const trail = live ? (snapshot?.vehicle_trail ?? []).map((p) => [p.latitude, p.longitude] as [number, number]) : [];
  const routeSource = source;
  const routeDestination = destination;
  const planned = useMemo(
    () => corridorSlice(routeSource, routeDestination),
    [routeSource, routeDestination],
  );
  const roleByEdge = new Map((snapshot?.topology ?? []).map((n) => [n.edge_id, n.role]));
  const relevantEdges = useMemo(() => {
    const set = new Set(edgeSequenceForRoadPath(routeSource, routeDestination));
    if (holder) set.add(holder);
    if (predicted) set.add(predicted);
    return set;
  }, [holder, predicted, routeDestination, routeSource]);

  const extra = useMemo(() => {
    const pts: [number, number][] = [];
    for (const id of cityPath(routeSource, routeDestination)) {
      const city = cityFor(id);
      if (city) pts.push([city.latitude, city.longitude]);
    }
    for (const region of EDGE_REGIONS) {
      if (relevantEdges.has(region.edge_id)) {
        pts.push([region.latitude, region.longitude]);
      }
    }
    return pts;
  }, [relevantEdges, routeDestination, routeSource]);

  const visualItems = useMemo((): MapVisualItem[] => {
    const items: MapVisualItem[] = [];
    const src = cityFor(routeSource);
    const dst = cityFor(routeDestination);

    if (src) {
      items.push({
        id: "source",
        lat: src.latitude,
        lng: src.longitude,
        kind: "source",
        priority: 100,
        html: endpointUnit("source", `source · ${cityCaption(src.name)}`),
      });
    }
    if (dst) {
      items.push({
        id: "destination",
        lat: dst.latitude,
        lng: dst.longitude,
        kind: "destination",
        priority: 99,
        html: endpointUnit("destination", `destination · ${cityCaption(dst.name)}`),
      });
    }

    for (const region of EDGE_REGIONS) {
      const role = roleFromTopology(region.edge_id, holder, snapshot?.shadows, roleByEdge.get(region.edge_id));
      const isPredicted = predicted === region.edge_id;
      items.push({
        id: `tower-${region.edge_id}`,
        lat: region.latitude,
        lng: region.longitude,
        kind: "tower",
        priority: role === "AUTHORITATIVE" ? 92 : role === "WARM_SHADOW" ? 88 : 75,
        role,
        html: edgeTowerUnit(role, `${edgeLabel(region.edge_id)} · ${roleBadge(role, isPredicted)}`),
      });
    }

    return items;
  }, [holder, predicted, roleByEdge, routeDestination, routeSource, snapshot?.shadows]);

  const traffic = live ? (snapshot?.traffic_vehicles ?? []).slice(0, 18) : [];
  const srcCity = cityFor(routeSource);
  const vehicleLat = pose.ready ? pose.lat : srcCity?.latitude;
  const vehicleLon = pose.ready ? pose.lon : srcCity?.longitude;
  const vehicleHeading = pose.ready ? pose.heading : 90;

  return (
    <MapContainer
      center={DEFAULT_CENTER}
      zoom={12}
      className={`h-full w-full prevail-map${live ? " prevail-map-live" : ""}`}
      zoomControl
      attributionControl={false}
      scrollWheelZoom
      doubleClickZoom
      zoomSnap={0.25}
      wheelDebounceTime={40}
      wheelPxPerZoomLevel={120}
      inertia
      inertiaDeceleration={3000}
      easeLinearity={0.22}
    >
      <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
      <MapPanes />
      <MapMarkerScale live={live} />
      <MapDirector
        source={routeSource}
        destination={routeDestination}
        pose={pose}
        follow={follow}
        running={live}
        route={planned}
        extra={extra}
      />
      <MapVisualLayer items={visualItems} />

      {EDGE_REGIONS.filter((region) => {
        const role = roleFromTopology(region.edge_id, holder, snapshot?.shadows, roleByEdge.get(region.edge_id));
        return role === "AUTHORITATIVE";
      }).map((region) => (
        <Circle
          key={`authority-glow-${region.edge_id}`}
          pane="zones"
          center={[region.latitude, region.longitude]}
          radius={480}
          pathOptions={{
            className: "authority-map-glow",
            stroke: false,
            fillColor: "#3b82f6",
            fillOpacity: 0.14,
          }}
        />
      ))}

      {EDGE_REGIONS.map((region) => {
        const role = roleFromTopology(region.edge_id, holder, snapshot?.shadows, roleByEdge.get(region.edge_id));
        const onRoute = relevantEdges.has(region.edge_id);
        const active = role === "AUTHORITATIVE" || shadows.has(region.edge_id);
        return (
          <Polygon
            key={region.edge_id}
            pane="zones"
            positions={region.polygon}
            pathOptions={{
              color: active ? roleStroke(role) : "#94a3b866",
              weight: active ? 0.8 : 0.5,
              dashArray: active ? undefined : "4 6",
              fillColor: "#64748b",
              fillOpacity: active ? 0.018 : onRoute ? 0.012 : 0.007,
            }}
          />
        );
      })}

      {planned.length > 1 && (
        <>
          <Polyline
            pane="routes"
            positions={planned}
            pathOptions={{
              color: "#0b0f14",
              weight: 5.5,
              opacity: 0.22,
              lineCap: "round",
              lineJoin: "round",
            }}
          />
          <Polyline
            pane="routes"
            positions={planned}
            pathOptions={{
              color: "#1a222d",
              weight: 3.4,
              opacity: 0.9,
              lineCap: "round",
              lineJoin: "round",
            }}
          />
          <Polyline
            pane="routes"
            positions={planned}
            pathOptions={{
              color: "#2a3442",
              weight: 2.2,
              opacity: 0.55,
              lineCap: "round",
              lineJoin: "round",
            }}
          />
          <Polyline
            pane="routes"
            positions={planned}
            pathOptions={{
              color: "#f1f5f9",
              weight: 0.9,
              opacity: 0.72,
              lineCap: "butt",
              lineJoin: "round",
              dashArray: "3 9",
            }}
          />
        </>
      )}

      {trail.length > 1 && (
        <Polyline
          pane="routes"
          positions={trail}
          pathOptions={{ color: "#334155", weight: 2.2, opacity: 0.55, lineCap: "round", lineJoin: "round" }}
        />
      )}

      {traffic.map((car) => (
        <Marker
          key={car.vehicle_id}
          position={[car.latitude, car.longitude]}
          icon={divIcon(`<div class="traffic-dot"></div>`, [5, 5], [2.5, 2.5])}
          zIndexOffset={40}
          interactive={false}
        />
      ))}

      {live && vehicleLat != null && vehicleLon != null && (
        <VehicleMarker
          lat={vehicleLat}
          lon={vehicleLon}
          vehicle={vehicle}
          heading={vehicleHeading}
          moving={moving}
        />
      )}
    </MapContainer>
  );
}
