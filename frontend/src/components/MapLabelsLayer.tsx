import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useMap } from "react-leaflet";
import { placeLabels, type LabelSpec } from "../lib/mapLabels";

function labelClass(label: LabelSpec & { leader: boolean }): string {
  const parts = ["map-floating-label", `map-label-${label.kind}`];
  if (label.role === "AUTHORITATIVE") parts.push("map-label-authority");
  if (label.role === "WARM_SHADOW") parts.push("map-label-shadow");
  if (label.kind === "city" && label.priority >= 55) parts.push("map-label-route-city");
  return parts.join(" ");
}

export function MapLabelsLayer({ specs }: { specs: LabelSpec[] }) {
  const map = useMap();
  const [labels, setLabels] = useState(() => placeLabels(map, specs));
  const key = useMemo(() => specs.map((s) => `${s.id}:${s.text}:${s.priority}:${s.role ?? ""}`).join("|"), [specs]);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => setLabels(placeLabels(map, specs)));
    };
    update();
    map.on("move zoom resize viewreset", update);
    return () => {
      window.cancelAnimationFrame(frame);
      map.off("move zoom resize viewreset", update);
    };
  }, [map, key, specs]);

  const host = map.getContainer();
  return createPortal(
    <div className="map-labels-layer pointer-events-none absolute inset-0 z-[700] overflow-hidden">
      <svg className="map-label-leaders absolute inset-0 h-full w-full">
        {labels
          .filter((l) => l.leader)
          .map((l) => {
            const tx = l.align === "center" ? l.x + l.text.length * 3 : l.align === "right" ? l.x + l.text.length * 6 : l.x;
            return (
              <line
                key={`${l.id}-leader`}
                x1={l.anchorX}
                y1={l.anchorY}
                x2={tx}
                y2={l.y + 6}
                className="map-label-leader-line"
              />
            );
          })}
      </svg>
      {labels.map((label) => (
        <div
          key={label.id}
          className={labelClass(label)}
          style={{
            transform: `translate(${label.x}px, ${label.y}px)`,
            opacity: label.opacity,
            textAlign: label.align,
          }}
        >
          {label.text}
        </div>
      ))}
    </div>,
    host,
  );
}
