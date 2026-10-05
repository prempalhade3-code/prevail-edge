import { Check, ChevronDown } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DEFAULT_VEHICLE_ID, VEHICLES, vehicleById, type SimVehicle } from "../../data/vehicles";
import { VehicleSvg } from "./VehicleSvg";

export function VehicleSelector({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelStyle, setPanelStyle] = useState<{ top: number; left: number; width: number } | null>(null);
  const selected = vehicleById(value || DEFAULT_VEHICLE_ID);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 300), 360);
    let left = rect.left;
    if (left + width > window.innerWidth - 16) {
      left = window.innerWidth - width - 16;
    }
    setPanelStyle({
      top: rect.bottom + 8,
      left: Math.max(16, left),
      width,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (ev: MouseEvent) => {
      const target = ev.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <div className="relative pb-1">
        <p className="text-sm text-muted">vehicle</p>
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          aria-expanded={open}
          aria-haspopup="listbox"
          onClick={() => setOpen((v) => !v)}
          className="mt-1 flex min-w-[220px] items-center gap-3 rounded-xl border border-line bg-white px-3 py-2.5 text-left transition hover:border-blue-200 disabled:opacity-60"
        >
          <span className="flex h-14 w-[72px] shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-b from-slate-50 to-slate-100">
            <VehicleSvg vehicle={selected} size={52} showLights />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-ink">{selected.name}</span>
            <span className="block truncate text-xs text-muted">{selected.tagline}</span>
          </span>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          />
        </button>
      </div>

      {open &&
        panelStyle &&
        createPortal(
          <div
            ref={panelRef}
            role="listbox"
            aria-label="Choose your vehicle"
            className="vehicle-selector-panel fixed z-[10000] flex max-h-[min(520px,calc(100vh-96px))] flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-[0_24px_64px_rgba(11,18,32,0.18)]"
            style={{ top: panelStyle.top, left: panelStyle.left, width: panelStyle.width }}
            onWheel={(e) => e.stopPropagation()}
          >
            <div className="shrink-0 border-b border-line/80 px-4 py-3">
              <p className="text-sm font-semibold text-ink">Choose your vehicle</p>
              <p className="mt-0.5 text-xs text-muted">Scroll to browse · select the vehicle for this run</p>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-3 py-3">
              <ul className="flex flex-col gap-2.5">
                {VEHICLES.map((vehicle) => (
                  <VehicleCard
                    key={vehicle.id}
                    vehicle={vehicle}
                    active={vehicle.id === selected.id}
                    onPick={() => {
                      onChange(vehicle.id);
                      setOpen(false);
                    }}
                  />
                ))}
              </ul>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function VehicleCard({
  vehicle,
  active,
  onPick,
}: {
  vehicle: SimVehicle;
  active: boolean;
  onPick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        role="option"
        aria-selected={active}
        onClick={onPick}
        className={`group flex w-full flex-col overflow-hidden rounded-2xl border text-left transition-all duration-200 ${
          active
            ? "border-electric/40 bg-blue-50/80 shadow-[0_8px_24px_rgba(37,99,235,0.12)] ring-1 ring-electric/25"
            : "border-line/80 bg-white hover:border-slate-300 hover:shadow-sm"
        }`}
      >
        <div
          className={`relative flex h-40 items-center justify-center overflow-hidden bg-gradient-to-b from-slate-50 via-white to-slate-100 transition-transform duration-200 ${
            active ? "scale-[1.01]" : "group-hover:scale-[1.005]"
          }`}
        >
          <div
            className="pointer-events-none absolute inset-x-8 bottom-3 h-8 rounded-[100%] bg-slate-900/10 blur-md"
            aria-hidden="true"
          />
          <VehicleSvg vehicle={vehicle} size={128} showLights />
          {active && (
            <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-electric px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
              <Check className="h-3 w-3" />
              selected
            </span>
          )}
        </div>
        <div className="border-t border-line/60 px-4 py-3">
          <p className="text-sm font-semibold text-ink">{vehicle.name}</p>
          <p className="mt-0.5 text-xs text-muted">{vehicle.tagline}</p>
        </div>
      </button>
    </li>
  );
}
