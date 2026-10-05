import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useMap } from "react-leaflet";
import { CITY_UNIT, FLAG_UNIT, TOWER_UNIT } from "../lib/mapIcons";
import { placeVisualUnits, type PlacedVisual, type VisualSpec } from "../lib/mapVisualCollision";

export interface MapVisualItem {
  id: string;
  lat: number;
  lng: number;
  kind: VisualSpec["kind"];
  priority: number;
  html: string;
  role?: string;
}

function unitSize(kind: VisualSpec["kind"]): { w: number; h: number } {
  if (kind === "tower") return TOWER_UNIT;
  if (kind === "source" || kind === "destination") return FLAG_UNIT;
  return CITY_UNIT;
}

export function MapVisualLayer({ items }: { items: MapVisualItem[] }) {
  const map = useMap();
  const specs = useMemo(
    (): VisualSpec[] =>
      items.map((item) => ({
        id: item.id,
        lat: item.lat,
        lng: item.lng,
        kind: item.kind,
        priority: item.priority,
        ...unitSize(item.kind),
      })),
    [items],
  );

  const htmlById = useMemo(() => new Map(items.map((i) => [i.id, i.html])), [items]);
  const key = useMemo(() => items.map((i) => `${i.id}:${i.priority}:${i.html}`).join("|"), [items]);

  const [placed, setPlaced] = useState<PlacedVisual[]>(() => placeVisualUnits(map, specs));

  useEffect(() => {
    let frame = 0;
    const update = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => setPlaced(placeVisualUnits(map, specs)));
    };
    update();
    map.on("move zoom zoomend moveend resize viewreset", update);
    return () => {
      window.cancelAnimationFrame(frame);
      map.off("move zoom zoomend moveend resize viewreset", update);
    };
  }, [map, key, specs]);

  const host = map.getContainer();
  return createPortal(
    <div className="map-visual-layer pointer-events-none absolute inset-0 z-[680] overflow-hidden">
      <svg className="map-visual-leaders absolute inset-0 h-full w-full">
        {placed
          .filter((p) => p.leader)
          .map((p) => {
            const { h } = unitSize(p.kind);
            const tipX = p.anchorX + p.offsetX;
            const tipY = p.anchorY + p.offsetY - h * 0.12;
            return (
              <g key={`${p.id}-leader`}>
                <line x1={p.anchorX} y1={p.anchorY} x2={tipX} y2={tipY} className="map-visual-leader-line" />
                <circle cx={p.anchorX} cy={p.anchorY} r="2.5" className="map-visual-anchor-dot" />
              </g>
            );
          })}
      </svg>
      {placed.map((p) => {
        const { w, h } = unitSize(p.kind);
        const left = p.anchorX + p.offsetX - w / 2;
        const top = p.anchorY + p.offsetY - h;
        return (
          <div
            key={p.id}
            className={`map-visual-item map-visual-${p.kind}`}
            style={{ transform: `translate(${left}px, ${top}px)`, width: w, height: h }}
            dangerouslySetInnerHTML={{ __html: htmlById.get(p.id) ?? "" }}
          />
        );
      })}
    </div>,
    host,
  );
}
