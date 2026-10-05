import type { SimVehicle } from "../../data/vehicles";

/** Top-down vehicle art — front faces UP (north at heading 0). */
export function VehicleSvg({
  vehicle,
  size = 120,
  showLights = true,
  className = "",
}: {
  vehicle: SimVehicle;
  size?: number;
  showLights?: boolean;
  className?: string;
}) {
  const { design, accent, secondary, glow } = vehicle;

  return (
    <svg
      className={`sim-vehicle-svg ${className}`}
      viewBox="0 0 100 140"
      width={size}
      height={size * 1.4}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`body-${design}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={accent} stopOpacity="0.95" />
          <stop offset="55%" stopColor={secondary} stopOpacity="1" />
          <stop offset="100%" stopColor={secondary} stopOpacity="1" />
        </linearGradient>
        <filter id={`shadow-${design}`} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#0b1220" floodOpacity="0.35" />
        </filter>
      </defs>

      <ellipse cx="50" cy="72" rx="28" ry="38" fill="rgba(11,18,32,0.12)" />

      {design === "phantom-v" && <PhantomVBody accent={accent} glow={glow} showLights={showLights} />}
      {design === "apex-gt" && <ApexGtBody accent={accent} showLights={showLights} />}
      {design === "volt-r" && <VoltRBody accent={accent} showLights={showLights} />}
      {design === "pulse-x" && <PulseXBody accent={accent} showLights={showLights} />}
      {design === "rift-7" && <Rift7Body accent={accent} showLights={showLights} />}
      {design === "thunder-s" && <ThunderSBody accent={accent} secondary={secondary} showLights={showLights} />}
      {design === "neon-drake" && <NeonDrakeBody accent={accent} secondary={secondary} glow={glow} showLights={showLights} />}
    </svg>
  );
}

function Headlights({ y = 22 }: { y?: number }) {
  return (
    <>
      <ellipse cx="34" cy={y} rx="5" ry="3.2" fill="#fef9c3" opacity="0.95" />
      <ellipse cx="66" cy={y} rx="5" ry="3.2" fill="#fef9c3" opacity="0.95" />
      <ellipse cx="34" cy={y} rx="8" ry="5" fill="#fde68a" opacity="0.22" />
      <ellipse cx="66" cy={y} rx="8" ry="5" fill="#fde68a" opacity="0.22" />
    </>
  );
}

function Taillights({ y = 118 }: { y?: number }) {
  return (
    <>
      <rect x="30" y={y} width="10" height="5" rx="1.5" fill="#ef4444" opacity="0.92" />
      <rect x="60" y={y} width="10" height="5" rx="1.5" fill="#ef4444" opacity="0.92" />
      <rect x="30" y={y} width="10" height="5" rx="1.5" fill="#fca5a5" opacity="0.35" filter="blur(1px)" />
      <rect x="60" y={y} width="10" height="5" rx="1.5" fill="#fca5a5" opacity="0.35" />
    </>
  );
}

function Wheel({ cx, cy }: { cx: number; cy: number }) {
  return (
    <>
      <rect x={cx - 7} y={cy - 4} width="14" height="8" rx="2" fill="#0b1220" stroke="#334155" strokeWidth="1" />
      <rect x={cx - 4} y={cy - 2} width="8" height="4" rx="1" fill="#475569" />
    </>
  );
}

function PhantomVBody({
  accent,
  glow,
  showLights,
}: {
  accent: string;
  glow: string;
  showLights: boolean;
}) {
  return (
    <g filter="url(#shadow-phantom-v)">
      <path d="M50 8 L78 38 L72 118 L28 118 L22 38 Z" fill={`url(#body-phantom-v)`} stroke={accent} strokeWidth="1.2" />
      <path d="M36 28 L50 18 L64 28 L58 52 L42 52 Z" fill="#0f172a" opacity="0.85" />
      <path d="M32 70 Q50 62 68 70" stroke={glow} strokeWidth="1.5" fill="none" opacity="0.55" />
      <ellipse cx="50" cy="88" rx="12" ry="6" fill={accent} opacity="0.25" />
      <Wheel cx={28} cy={44} />
      <Wheel cx={72} cy={44} />
      <Wheel cx={30} cy={108} />
      <Wheel cx={70} cy={108} />
      {showLights && (
        <>
          <Headlights y={20} />
          <Taillights y={116} />
          <ellipse cx="50" cy="14" rx="14" ry="4" fill={glow} opacity="0.18" />
        </>
      )}
    </g>
  );
}

function ApexGtBody({
  accent,
  showLights,
}: {
  accent: string;
  showLights: boolean;
}) {
  return (
    <g filter="url(#shadow-apex-gt)">
      <path d="M50 12 L82 42 L76 120 L24 120 L18 42 Z" fill={`url(#body-apex-gt)`} stroke="#0f172a" strokeWidth="1" />
      <path d="M38 32 L50 22 L62 32 L58 48 L42 48 Z" fill="#1e293b" opacity="0.9" />
      <path d="M26 58 L74 58" stroke={accent} strokeWidth="2.5" opacity="0.65" />
      <path d="M30 68 L70 68" stroke={accent} strokeWidth="1.2" opacity="0.4" />
      <Wheel cx={26} cy={50} />
      <Wheel cx={74} cy={50} />
      <Wheel cx={28} cy={110} />
      <Wheel cx={72} cy={110} />
      {showLights && (
        <>
          <Headlights />
          <Taillights />
        </>
      )}
    </g>
  );
}

function VoltRBody({
  accent,
  showLights,
}: {
  accent: string;
  showLights: boolean;
}) {
  return (
    <g filter="url(#shadow-volt-r)">
      <path d="M50 10 Q88 50 72 118 L28 118 Q12 50 50 10 Z" fill={`url(#body-volt-r)`} stroke={accent} strokeWidth="1" />
      <ellipse cx="50" cy="38" rx="16" ry="10" fill="#0f172a" opacity="0.82" />
      <path d="M42 72 Q50 68 58 72" stroke={accent} strokeWidth="2" fill="none" opacity="0.7" />
      <ellipse cx="50" cy="92" rx="10" ry="4" fill={accent} opacity="0.2" />
      <Wheel cx={30} cy={48} />
      <Wheel cx={70} cy={48} />
      <Wheel cx={32} cy={108} />
      <Wheel cx={68} cy={108} />
      {showLights && (
        <>
          <Headlights y={24} />
          <Taillights />
          <ellipse cx="50" cy="18" rx="18" ry="5" fill={accent} opacity="0.15" />
        </>
      )}
    </g>
  );
}

function PulseXBody({
  accent,
  showLights,
}: {
  accent: string;
  showLights: boolean;
}) {
  return (
    <g filter="url(#shadow-pulse-x)">
      <path d="M50 6 L86 48 L80 122 L20 122 L14 48 Z" fill={`url(#body-pulse-x)`} stroke={accent} strokeWidth="1.2" />
      <path d="M50 6 L62 28 L38 28 Z" fill="#09090b" opacity="0.9" />
      <path d="M24 64 L76 64" stroke={accent} strokeWidth="3" opacity="0.5" />
      <path d="M28 78 L72 78" stroke="#fafafa" strokeWidth="0.8" opacity="0.25" />
      <Wheel cx={22} cy={52} />
      <Wheel cx={78} cy={52} />
      <Wheel cx={26} cy={112} />
      <Wheel cx={74} cy={112} />
      {showLights && (
        <>
          <Headlights y={18} />
          <Taillights y={120} />
        </>
      )}
    </g>
  );
}

function Rift7Body({
  accent,
  showLights,
}: {
  accent: string;
  showLights: boolean;
}) {
  return (
    <g filter="url(#shadow-rift-7)">
      <path d="M50 14 L80 46 L74 118 L26 118 L20 46 Z" fill={`url(#body-rift-7)`} stroke="#0f172a" strokeWidth="1" />
      <path d="M34 36 L50 26 L66 36 L60 54 L40 54 Z" fill="#292524" opacity="0.92" />
      <path d="M22 62 L78 62" stroke={accent} strokeWidth="4" opacity="0.75" />
      <path d="M30 74 L70 74" stroke={accent} strokeWidth="1.5" opacity="0.45" />
      <Wheel cx={24} cy={52} />
      <Wheel cx={76} cy={52} />
      <Wheel cx={28} cy={108} />
      <Wheel cx={72} cy={108} />
      {showLights && (
        <>
          <Headlights y={26} />
          <Taillights />
        </>
      )}
    </g>
  );
}

function ThunderSBody({
  accent,
  secondary,
  showLights,
}: {
  accent: string;
  secondary: string;
  showLights: boolean;
}) {
  return (
    <g filter="url(#shadow-thunder-s)">
      <ellipse cx="32" cy="88" rx="14" ry="16" fill="none" stroke={secondary} strokeWidth="3" />
      <ellipse cx="68" cy="88" rx="14" ry="16" fill="none" stroke={secondary} strokeWidth="3" />
      <ellipse cx="32" cy="88" rx="8" ry="9" fill="#27272a" stroke="#52525b" strokeWidth="1" />
      <ellipse cx="68" cy="88" rx="8" ry="9" fill="#27272a" stroke="#52525b" strokeWidth="1" />
      <path d="M32 88 L50 38 L68 88" stroke={accent} strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M50 38 L58 24" stroke={secondary} strokeWidth="3" strokeLinecap="round" />
      <path d="M54 24 L62 20 L58 28" fill={accent} opacity="0.85" />
      <rect x="46" y="52" width="8" height="22" rx="3" fill={secondary} />
      {showLights && (
        <>
          <ellipse cx="58" cy="22" rx="6" ry="3" fill="#fef9c3" opacity="0.9" />
          <ellipse cx="24" cy="96" rx="4" ry="2" fill="#ef4444" opacity="0.85" />
        </>
      )}
    </g>
  );
}

function NeonDrakeBody({
  accent,
  secondary,
  glow,
  showLights,
}: {
  accent: string;
  secondary: string;
  glow: string;
  showLights: boolean;
}) {
  return (
    <g filter="url(#shadow-neon-drake)">
      <ellipse cx="34" cy="86" rx="13" ry="15" fill="none" stroke={secondary} strokeWidth="2.5" />
      <ellipse cx="66" cy="86" rx="13" ry="15" fill="none" stroke={secondary} strokeWidth="2.5" />
      <path d="M34 86 L50 32 L66 86" stroke={accent} strokeWidth="3.5" fill="none" strokeLinecap="round" />
      <path d="M50 32 L56 18 L62 26" stroke={glow} strokeWidth="2" fill="none" />
      <ellipse cx="50" cy="58" rx="6" ry="10" fill={secondary} opacity="0.9" />
      <path d="M42 70 Q50 66 58 70" stroke={glow} strokeWidth="1.5" fill="none" opacity="0.65" />
      {showLights && (
        <>
          <ellipse cx="56" cy="18" rx="8" ry="4" fill={glow} opacity="0.35" />
          <ellipse cx="56" cy="18" rx="4" ry="2" fill="#ccfbf1" opacity="0.95" />
          <ellipse cx="30" cy="94" rx="5" ry="2.5" fill="#ef4444" opacity="0.8" />
        </>
      )}
    </g>
  );
}
