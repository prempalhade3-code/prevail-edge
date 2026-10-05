import { CONFIGURED_CAPABILITIES } from "../data/capabilities";
import { EDGE_REGIONS } from "../data/regions";
import { deniedImageEdges } from "../lib/events";
import { edgeLabel, fmtPct, roleFromTopology, roleLabel } from "../lib/format";
import type { SystemSnapshot, TimelineEvent } from "../types";
import { Card, EmptyState, PageIntro, StatusPill } from "../components/ui";

function toneFor(role: string, reachable: boolean | undefined): "green" | "teal" | "amber" | "red" | "slate" {
  if (reachable === false) return "red";
  if (role === "AUTHORITATIVE") return "green";
  if (role === "WARM_SHADOW") return "teal";
  if (role === "FAILED") return "red";
  return "slate";
}

export function EdgesPage({ snapshot, events }: { snapshot: SystemSnapshot | null; events: TimelineEvent[] }) {
  const denied = deniedImageEdges(events);
  const holder = snapshot?.authority.holder_edge_id;
  const epoch = snapshot?.authority.epoch;

  return (
    <div className="px-5 py-6">
      <PageIntro
        title="edge infrastructure"
        detail="Four edge servers. Region names come from backend edge-region metadata. Authority, shadows, and reachability come from the live snapshot."
      />
      <div className="grid gap-4 md:grid-cols-2">
        {EDGE_REGIONS.map((region) => {
          const id = region.edge_id;
          const topo = snapshot?.topology.find((n) => n.edge_id === id);
          const shadow = snapshot?.shadows.find((s) => s.edge_id === id);
          const role = roleFromTopology(id, holder, snapshot?.shadows, topo?.role);
          const reachable = snapshot?.edge_snapshots?.[id]?.reachable;
          const caps = CONFIGURED_CAPABILITIES[id];
          const imageLive = denied.has(id) ? false : denied.size ? true : null;
          const cpu = holder === id ? snapshot?.cpu_available_ratio : undefined;
          const memory = holder === id ? snapshot?.memory_available_ratio : undefined;
          return (
            <Card key={id} accent={role === "AUTHORITATIVE" ? "indigo" : role === "WARM_SHADOW" ? "teal" : "none"}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-2xl font-semibold tracking-tight text-ink">{edgeLabel(id)}</h3>
                  <p className="mt-1 text-sm text-muted">region · {region.name}</p>
                  <p className="mt-1 text-sm text-slate-600">{roleLabel(role)}</p>
                </div>
                <StatusPill tone={toneFor(role, reachable)}>
                  {reachable == null ? "awaiting reachability" : reachable ? roleLabel(role) : "unavailable"}
                </StatusPill>
              </div>
              <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
                <Stat label="authority" value={holder === id ? "holder" : "—"} />
                <Stat label="epoch" value={holder === id ? String(epoch ?? "—") : "—"} />
                <Stat label="cpu" value={fmtPct(cpu)} hint="live only for the current snapshot edge" />
                <Stat label="memory" value={fmtPct(memory)} hint="live only for the current snapshot edge" />
                <Stat label="shadow" value={shadow ? roleLabel(shadow.role) : "none"} />
                <Stat label="sync" value={fmtPct(shadow?.sync_ratio ?? topo?.sync_ratio)} />
              </dl>
              <div className="mt-5 flex flex-wrap gap-2 text-xs">
                <Cap label="stream" on={caps?.supports_stream} />
                <Cap label="image" on={caps?.supports_image} live={imageLive} />
                <Cap label="video" on={caps?.supports_video} />
                <Cap label="gpu" on={caps?.supports_gpu} />
              </div>
            </Card>
          );
        })}
      </div>
      {!snapshot && (
        <div className="mt-6">
          <EmptyState title="connecting" detail="Edge roles appear when /v1/snapshot or the live websocket is available." />
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl bg-slate-50 px-3 py-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 font-semibold text-ink">{value}</dd>
      {hint && <p className="mt-1 text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}

function Cap({ label, on, live }: { label: string; on?: boolean; live?: boolean | null }) {
  const shown = live == null ? on : live;
  return (
    <span className={`rounded-full px-2.5 py-1 font-medium ${shown ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
      {label} {shown ? "yes" : "no"}
      {live != null ? " · live" : " · configured"}
    </span>
  );
}
