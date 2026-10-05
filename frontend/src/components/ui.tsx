import type { ReactNode } from "react";

export function Card({
  children,
  className = "",
  accent,
}: {
  children: ReactNode;
  className?: string;
  accent?: "indigo" | "teal" | "cyan" | "green" | "amber" | "red" | "none";
}) {
  const ring =
    accent === "green" || accent === "teal" || accent === "cyan"
      ? "ring-1 ring-blue-100"
      : accent === "amber"
        ? "ring-1 ring-amber-200"
        : accent === "red"
          ? "ring-1 ring-rose-200"
          : accent === "indigo"
            ? "ring-1 ring-violet-200"
            : "ring-1 ring-line/80";
  return (
    <section className={`panel p-5 ${ring} ${className}`}>
      {children}
    </section>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="text-sm font-medium text-muted">{children}</p>;
}

export const Eyebrow = SectionLabel;

export function StatusPill({
  tone,
  children,
}: {
  tone: "green" | "amber" | "red" | "teal" | "cyan" | "indigo" | "slate";
  children: ReactNode;
}) {
  const map = {
    green: "bg-blue-50 text-blue-800 ring-blue-100",
    amber: "bg-amber-50 text-amber-800 ring-amber-200",
    red: "bg-rose-50 text-rose-700 ring-rose-200",
    teal: "bg-cyan-50 text-cyan-800 ring-cyan-100",
    cyan: "bg-cyan-50 text-cyan-800 ring-cyan-100",
    indigo: "bg-violet-50 text-violet-800 ring-violet-100",
    slate: "bg-slate-100 text-slate-600 ring-slate-200",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${map[tone]}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

export function Metric({
  label,
  value,
  hint,
  live,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  live?: boolean;
}) {
  return (
    <div className="rounded-2xl bg-slate-50/90 px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted">{label}</p>
        {live && <span className="text-xs font-medium text-electric">Live</span>}
      </div>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-ink">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-slate-50/80 px-4 py-8 text-center">
      <p className="text-sm font-semibold text-ink">{title}</p>
      <p className="mt-1 text-sm text-muted">{detail}</p>
    </div>
  );
}

export function PageIntro({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="mb-6 max-w-3xl">
      <h2 className="text-3xl font-semibold tracking-tight text-ink">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-muted">{detail}</p>
    </div>
  );
}
