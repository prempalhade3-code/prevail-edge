import { EDGE_IDS } from "../types";
import { deniedImageEdges } from "../lib/events";
import { edgeLabel, fmtPct, roleFromTopology } from "../lib/format";
import type { SystemSnapshot } from "../types";
import { Card, Eyebrow, StatusPill } from "./ui";

function toneFor(role: string): "green" | "cyan" | "amber" | "red" | "slate" {
  if (role === "AUTHORITATIVE") return "green";
  if (role === "WARM_SHADOW") return "cyan";
  if (role === "FAILED") return "red";
  if (role === "FOLLOWER") return "slate";
  return "slate";
}

export function EdgeGrid({ snapshot }: { snapshot: SystemSnapshot | null }) {
  const denied = deniedImageEdges(snapshot?.timeline);
  const holder = snapshot?.authority.holder_edge_id;
  const epoch = snapshot?.authority.epoch;
  const probs = snapshot?.prediction?.probabilities ?? {};

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {EDGE_IDS.map((id) => {
        const topo = snapshot?.topology.find((n) => n.edge_id === id);
        const shadow = snapshot?.shadows.find((s) => s.edge_id === id);
        const role = roleFromTopology(id, holder, snapshot?.shadows, topo?.role);
        const reachable = Boolean(snapshot?.edge_snapshots?.[id]?.reachable);
        const imageKnown = denied.has(id) ? false : denied.size ? true : null;
        return (
          <Card key={id} accent={role === "AUTHORITATIVE" ? "green" : role === "WARM_SHADOW" ? "cyan" : "none"} className="transition-all duration-500">
            <div className="flex items-start justify-between">
              <div>
                <Eyebrow>{edgeLabel(id)}</Eyebrow>
                <p className="mt-2 font-mono text-xl font-semibold text-slate-900">{role.replaceAll("_", " ")}</p>
              </div>
              <StatusPill tone={reachable ? toneFor(role) : "red"}>{reachable ? "Healthy" : "Offline"}</StatusPill>
            </div>
            <dl className="mt-4 space-y-1.5 text-sm text-slate-600">
              <div className="flex justify-between"><dt>Epoch</dt><dd className="font-mono">{holder === id ? epoch ?? "—" : "—"}</dd></div>
              <div className="flex justify-between"><dt>Prediction</dt><dd className="font-mono">{fmtPct(probs[id])}</dd></div>
              <div className="flex justify-between"><dt>Shadow sync</dt><dd className="font-mono">{fmtPct(shadow?.sync_ratio ?? topo?.sync_ratio)}</dd></div>
              <div className="flex justify-between"><dt>Image</dt><dd>{imageKnown == null ? "awaiting event" : imageKnown ? "✓" : "✕ denied"}</dd></div>
            </dl>
          </Card>
        );
      })}
    </div>
  );
}
