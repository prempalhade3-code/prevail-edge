import type { AuthorityToken } from "../types";

export function CurrentNodePanel({
  edgeId,
  authority,
}: {
  edgeId: string;
  authority: AuthorityToken;
}) {
  const isHolder = authority.holder_edge_id === edgeId;

  return (
    <div className="hud-panel p-4">
      <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45">Current edge</h2>
      <p className="font-mono text-2xl font-semibold">{edgeId}</p>
      <p className={`mt-2 text-sm ${isHolder ? "text-emerald-300" : "text-amber-300"}`}>
        {isHolder ? "Authoritative" : "Tracking"}
      </p>
      <p className="mt-2 font-mono text-[11px] text-white/40">
        {authority.holder_edge_id} · epoch {authority.epoch}
      </p>
    </div>
  );
}
