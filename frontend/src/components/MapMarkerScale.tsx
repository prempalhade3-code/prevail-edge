import { useEffect } from "react";
import { useMap } from "react-leaflet";

/** Subtle zoom-aware scaling — readable when zoomed out, restrained when zoomed in. */
export function MapMarkerScale({ live = false }: { live?: boolean }) {
  const map = useMap();
  useEffect(() => {
    const update = () => {
      const z = map.getZoom();
      const base = live ? 0.82 : 0.86;
      const max = live ? 1.02 : 1.12;
      const scale = Math.min(max, Math.max(base - 0.04, 0.44 + z * 0.048));
      map.getContainer().style.setProperty("--map-mark-scale", scale.toFixed(3));
    };
    update();
    map.on("zoom", update);
    return () => {
      map.off("zoom", update);
    };
  }, [live, map]);
  return null;
}
