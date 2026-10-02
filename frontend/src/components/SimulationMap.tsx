import { useEffect, useMemo, useRef, useState } from "react";
import Map, { Layer, Marker, Source, type MapRef } from "react-map-gl/maplibre";
import type { SystemSnapshot } from "../types";
import "maplibre-gl/dist/maplibre-gl.css";

const MAP_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

function roleColor(role: string): string {
  if (role === "AUTHORITATIVE") return "#10b981";
  if (role === "WARM_SHADOW") return "#f59e0b";
  return "#64748b";
}

export function SimulationMap({ snapshot }: { snapshot: SystemSnapshot | null }) {
  const mapRef = useRef<MapRef>(null);
  const [roads, setRoads] = useState<GeoJSON.FeatureCollection | null>(null);

  useEffect(() => {
    fetch("/sim/network/bangalore-corridor.geojson")
      .then((r) => r.json())
      .then(setRoads)
      .catch(() => setRoads(null));
  }, []);

  const center = useMemo(() => {
    if (snapshot?.vehicle_longitude != null && snapshot?.vehicle_latitude != null) {
      return { longitude: snapshot.vehicle_longitude, latitude: snapshot.vehicle_latitude };
    }
    if (snapshot?.topology[0]) {
      return { longitude: snapshot.topology[0].longitude, latitude: snapshot.topology[0].latitude };
    }
    return { longitude: 77.5946, latitude: 12.9716 };
  }, [snapshot]);

  useEffect(() => {
    const h = snapshot?.vehicle_heading ?? -20;
    mapRef.current?.easeTo({
      center: [center.longitude, center.latitude],
      bearing: -h,
      pitch: 62,
      zoom: 15.2,
      duration: 700,
    });
  }, [center.longitude, center.latitude, snapshot?.vehicle_heading]);

  const trailGeoJson = useMemo((): GeoJSON.FeatureCollection => {
    const coords =
      snapshot?.vehicle_trail?.map((p) => [p.longitude, p.latitude] as [number, number]) ?? [];
    if (coords.length < 2) {
      return { type: "FeatureCollection", features: [] };
    }
    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: coords },
        },
      ],
    };
  }, [snapshot?.vehicle_trail]);

  const edgeGeoJson = useMemo((): GeoJSON.FeatureCollection => {
    const features =
      snapshot?.topology.map((node) => ({
        type: "Feature" as const,
        properties: {
          edge_id: node.edge_id,
          role: node.role,
          color: roleColor(node.role),
        },
        geometry: {
          type: "Point" as const,
          coordinates: [node.longitude, node.latitude],
        },
      })) ?? [];
    return { type: "FeatureCollection", features };
  }, [snapshot?.topology]);

  const heading = snapshot?.vehicle_heading ?? 0;

  return (
    <div className="h-[520px] w-full rounded-xl overflow-hidden border border-slate-700 shadow-2xl shadow-black/40 relative">
      <Map
        ref={mapRef}
        initialViewState={{
          longitude: center.longitude,
          latitude: center.latitude,
          zoom: 13.8,
          pitch: 55,
          bearing: -20,
        }}
        style={{ width: "100%", height: "100%" }}
        mapStyle={MAP_STYLE}
        attributionControl={false}
      >
        {roads && (
          <Source id="roads" type="geojson" data={roads}>
            <Layer
              id="road-casing"
              type="line"
              paint={{ "line-color": "#0f172a", "line-width": 10, "line-opacity": 0.95 }}
            />
            <Layer
              id="road-fill"
              type="line"
              paint={{ "line-color": "#38bdf8", "line-width": 4.5, "line-opacity": 0.9 }}
            />
          </Source>
        )}

        <Source id="trail" type="geojson" data={trailGeoJson}>
          <Layer
            id="vehicle-trail"
            type="line"
            paint={{
              "line-color": "#22d3ee",
              "line-width": 4,
              "line-opacity": 0.8,
            }}
          />
        </Source>

        <Source id="edges" type="geojson" data={edgeGeoJson}>
          <Layer
            id="edge-coverage"
            type="circle"
            paint={{
              "circle-color": ["get", "color"],
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 20, 14, 48],
              "circle-opacity": 0.2,
              "circle-stroke-color": ["get", "color"],
              "circle-stroke-width": 2.5,
              "circle-stroke-opacity": 0.9,
            }}
          />
        </Source>

        {snapshot?.topology.map((node) => (
          <Marker
            key={node.edge_id}
            longitude={node.longitude}
            latitude={node.latitude}
            anchor="bottom"
          >
            <div className="text-[10px] font-semibold text-white bg-black/70 px-1.5 py-0.5 rounded border border-slate-600">
              {node.edge_id}
            </div>
          </Marker>
        ))}

        {snapshot?.traffic_vehicles?.map((v) => (
          <Marker key={v.vehicle_id} longitude={v.longitude} latitude={v.latitude} anchor="center">
            <div
              className="w-2.5 h-2.5 rounded-sm bg-amber-400/90 shadow-[0_0_6px_rgba(251,191,36,0.9)]"
              style={{ transform: `rotate(${v.heading_deg}deg)` }}
            />
          </Marker>
        ))}

        {snapshot?.vehicle_latitude != null && snapshot?.vehicle_longitude != null && (
          <Marker
            longitude={snapshot.vehicle_longitude}
            latitude={snapshot.vehicle_latitude}
            anchor="center"
          >
            <div className="relative flex flex-col items-center" style={{ transform: `rotate(${heading}deg)` }}>
              <div className="absolute w-8 h-8 rounded-full bg-cyan-400/20 animate-pulse" />
              <div className="w-0 h-0 border-l-[10px] border-r-[10px] border-b-[22px] border-l-transparent border-r-transparent border-b-cyan-300 drop-shadow-[0_0_12px_rgba(34,211,238,1)]" />
            </div>
          </Marker>
        )}
      </Map>
      <div className="absolute top-3 left-3 bg-black/60 text-xs text-slate-200 px-2 py-1 rounded border border-slate-600">
        Cinematic live sim · roads · traffic · chase camera
      </div>
    </div>
  );
}
