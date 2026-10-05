import L from "leaflet";
import { useEffect, useId, useRef } from "react";
import { useMap } from "react-leaflet";
import { renderToStaticMarkup } from "react-dom/server";
import type { SimVehicle } from "../../data/vehicles";
import { VehicleSvg } from "./VehicleSvg";

/** Map marker footprint — two size steps down from 216px. */
export const VEHICLE_MARKER_PX = 144;
const ANCHOR = VEHICLE_MARKER_PX / 2;

function markerHtml(
  vehicle: SimVehicle,
  rotatorId: string,
  heading: number,
  moving: boolean,
): string {
  const effectClass = moving ? `vehicle-effect-${vehicle.effect}` : "";
  const movingClass = moving ? "sim-vehicle-moving" : "";
  const body = renderToStaticMarkup(
    <VehicleSvg vehicle={vehicle} size={VEHICLE_MARKER_PX * 0.78} showLights />,
  );
  return `<div class="sim-vehicle-shell">
    <div id="${rotatorId}" class="sim-vehicle-rotator ${effectClass} ${movingClass}" style="--vehicle-accent:${vehicle.accent};--vehicle-glow:${vehicle.glow};transform:rotate(${heading}deg)">
      <span class="sim-vehicle-road-shadow" aria-hidden="true"></span>
      <span class="sim-vehicle-trail" aria-hidden="true"></span>
      <span class="sim-vehicle-body">${body}</span>
    </div>
  </div>`;
}

export function VehicleMarker({
  lat,
  lon,
  vehicle,
  heading,
  moving,
}: {
  lat: number;
  lon: number;
  vehicle: SimVehicle;
  heading: number;
  moving: boolean;
}) {
  const map = useMap();
  const markerRef = useRef<L.Marker | null>(null);
  const uid = useId().replace(/:/g, "");
  const rotatorId = `veh-rot-${uid}`;

  useEffect(() => {
    const icon = L.divIcon({
      className: "sim-vehicle-marker-wrap",
      html: markerHtml(vehicle, rotatorId, heading, moving),
      iconSize: [VEHICLE_MARKER_PX, VEHICLE_MARKER_PX],
      iconAnchor: [ANCHOR, ANCHOR],
    });
    const marker = L.marker([lat, lon], {
      icon,
      pane: "vehicle",
      interactive: false,
      zIndexOffset: 1400,
    });
    marker.addTo(map);
    markerRef.current = marker;
    return () => {
      marker.remove();
      markerRef.current = null;
    };
  }, [map, vehicle.id, rotatorId, heading, moving]);

  useEffect(() => {
    markerRef.current?.setLatLng([lat, lon]);
  }, [lat, lon]);

  useEffect(() => {
    const el = document.getElementById(rotatorId);
    if (el) {
      el.style.transform = `rotate(${heading}deg)`;
    }
  }, [heading, rotatorId]);

  useEffect(() => {
    const el = document.getElementById(rotatorId);
    if (!el) return;
    el.classList.toggle(`vehicle-effect-${vehicle.effect}`, moving);
    el.classList.toggle("sim-vehicle-moving", moving);
  }, [moving, vehicle.effect, rotatorId]);

  return null;
}
