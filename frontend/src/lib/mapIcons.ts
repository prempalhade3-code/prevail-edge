/** SVG/HTML map marker builders — visual layer only. */

export const PREVAIL_ACCENT = "#2563eb";
export const SOURCE_FLAG = "#1e40af";
export const DEST_FLAG = "#9d174d";
export const SHADOW_BEACON = "#0891b2";
export const SHADOW_ACCENT = SHADOW_BEACON;
export const INK = "#334155";

/** Attached unit dimensions (px) for collision placement. */
export const TOWER_UNIT = { w: 76, h: 108 };
export const FLAG_UNIT = { w: 80, h: 100 };
export const CITY_UNIT = { w: 72, h: 34 };

type TowerState = "authority" | "shadow" | "follower" | "idle" | "failed";

function towerState(role: string): TowerState {
  if (role === "AUTHORITATIVE") return "authority";
  if (role === "WARM_SHADOW") return "shadow";
  if (role === "FAILED") return "failed";
  if (role === "FOLLOWER") return "follower";
  return "idle";
}

/** Dark geometric edge infrastructure tower — vector only, no card background. */
function towerSvg(): string {
  return `<svg class="tower-svg" viewBox="0 0 36 52" width="50" height="72" aria-hidden="true">
    <ellipse class="tower-ground" cx="18" cy="49" rx="9" ry="2"/>
    <path class="tower-frame" d="M18 6 L29 45 H25 L18 33 L11 45 H7 Z"/>
    <line class="tower-rung" x1="12" y1="22" x2="24" y2="22"/>
    <line class="tower-rung" x1="13" y1="30" x2="23" y2="30"/>
    <line class="tower-rung" x1="14" y1="37" x2="22" y2="37"/>
    <rect class="tower-node" x="21" y="18" width="6" height="3.5" rx="0.8" transform="rotate(16 21 19.5)"/>
    <circle class="tower-beacon-halo" cx="18" cy="8" r="7"/>
    <circle class="tower-beacon-core" cx="18" cy="8" r="2.6"/>
    <circle class="tower-beacon" cx="18" cy="8" r="4.2"/>
  </svg>`;
}

function authorityTriangleSvg(): string {
  return `<svg class="tower-authority-triangle-svg" viewBox="0 0 72 64" width="72" height="64" aria-hidden="true">
    <polygon class="tower-authority-triangle-fill" points="36,6 66,58 6,58"/>
    <polygon class="tower-authority-triangle-stroke" points="36,6 66,58 6,58"/>
  </svg>`;
}

export function edgeTowerUnit(role: string, caption: string): string {
  const state = towerState(role);
  const glow = state === "authority" ? `<span class="tower-authority-glow" aria-hidden="true"></span>` : "";
  const triangle =
    state === "authority"
      ? `<span class="tower-authority-triangle" aria-hidden="true">${authorityTriangleSvg()}</span>`
      : "";
  return `<div class="map-unit map-unit-tower edge-tower-${state}">
    ${triangle}
    ${glow}
    ${towerSvg()}
    <span class="map-label-pill map-label-edge">${caption}</span>
  </div>`;
}

function flagSvg(kind: "source" | "destination"): string {
  const fill = kind === "source" ? SOURCE_FLAG : DEST_FLAG;
  return `<svg class="endpoint-flag-svg" viewBox="0 0 40 50" width="42" height="54" aria-hidden="true">
    <line x1="10" y1="4" x2="10" y2="46" stroke="#1e293b" stroke-width="2" stroke-linecap="round"/>
    <circle cx="10" cy="4" r="2.5" fill="#1e293b"/>
    <path d="M10 8 L33 13.5 L10 19 Z" fill="${fill}" stroke="#ffffff" stroke-width="1.4" stroke-linejoin="round"/>
  </svg>`;
}

export function endpointUnit(kind: "source" | "destination", caption: string): string {
  return `<div class="map-unit map-unit-flag endpoint-flag-${kind}">
    ${flagSvg(kind)}
    <span class="map-label-pill map-label-${kind}">${caption}</span>
  </div>`;
}

export function cityUnit(name: string, onRoute: boolean): string {
  return `<div class="map-unit map-unit-city${onRoute ? " map-unit-city-route" : ""}">
    <span class="city-waypoint-dot"></span>
    <span class="map-label-pill map-label-city">${name}</span>
  </div>`;
}

export function vehicleIconHtml(heading: number): string {
  return `<div class="vehicle-marker" style="transform: rotate(${heading}deg)">
    <span class="vehicle-halo"></span>
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M16 4 L24 26 L16 21 L8 26 Z" fill="#0b1220" opacity="0.94"/>
      <path d="M16 8 L21 22 L16 19 L11 22 Z" fill="${PREVAIL_ACCENT}" opacity="0.88"/>
      <circle cx="16" cy="16" r="2.2" fill="#93c5fd"/>
    </svg>
  </div>`;
}
