/** Premium simulation vehicle collection — original designs only. */

export type VehicleKind = "car" | "bike" | "futuristic";

export type VehicleEffect = "exhaust" | "motion" | "light-trail";

export type VehicleDesign =
  | "phantom-v"
  | "apex-gt"
  | "volt-r"
  | "pulse-x"
  | "rift-7"
  | "thunder-s"
  | "neon-drake";

export interface SimVehicle {
  id: string;
  name: string;
  tagline: string;
  kind: VehicleKind;
  design: VehicleDesign;
  effect: VehicleEffect;
  accent: string;
  secondary: string;
  glow: string;
}

export const VEHICLES: SimVehicle[] = [
  {
    id: "phantom-v",
    name: "Phantom V",
    tagline: "Futuristic supercar",
    kind: "futuristic",
    design: "phantom-v",
    effect: "light-trail",
    accent: "#38bdf8",
    secondary: "#0c1222",
    glow: "#0ea5e9",
  },
  {
    id: "apex-gt",
    name: "Apex GT",
    tagline: "Aggressive sports car",
    kind: "car",
    design: "apex-gt",
    effect: "motion",
    accent: "#ef4444",
    secondary: "#111827",
    glow: "#dc2626",
  },
  {
    id: "volt-r",
    name: "Volt R",
    tagline: "Futuristic electric GT",
    kind: "car",
    design: "volt-r",
    effect: "light-trail",
    accent: "#22d3ee",
    secondary: "#0f172a",
    glow: "#06b6d4",
  },
  {
    id: "pulse-x",
    name: "Pulse X",
    tagline: "Extreme performance hypercar",
    kind: "car",
    design: "pulse-x",
    effect: "motion",
    accent: "#a855f7",
    secondary: "#09090b",
    glow: "#9333ea",
  },
  {
    id: "rift-7",
    name: "Rift 7",
    tagline: "Track-assault coupe",
    kind: "car",
    design: "rift-7",
    effect: "motion",
    accent: "#f97316",
    secondary: "#1c1917",
    glow: "#ea580c",
  },
  {
    id: "thunder-s",
    name: "Thunder S",
    tagline: "High-performance motorcycle",
    kind: "bike",
    design: "thunder-s",
    effect: "exhaust",
    accent: "#eab308",
    secondary: "#27272a",
    glow: "#ca8a04",
  },
  {
    id: "neon-drake",
    name: "Neon Drake",
    tagline: "Futuristic sports bike",
    kind: "bike",
    design: "neon-drake",
    effect: "light-trail",
    accent: "#2dd4bf",
    secondary: "#042f2e",
    glow: "#14b8a6",
  },
];

export const DEFAULT_VEHICLE_ID = "apex-gt";

export function vehicleById(id: string): SimVehicle {
  return VEHICLES.find((v) => v.id === id) ?? VEHICLES[0]!;
}
