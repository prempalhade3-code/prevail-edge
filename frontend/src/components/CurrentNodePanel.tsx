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
    <div className="rounded-lg bg-prevail-panel p-4 border border-slate-700">
      <h2 className="text-sm font-semibold text-slate-300 mb-2">Current edge</h2>
      <p className="text-2xl font-bold font-mono text-white">{edgeId}</p>
      <p className="mt-2 text-sm">
        Status:{" "}
        <span className={isHolder ? "text-prevail-ok" : "text-prevail-warm"}>
          {isHolder ? "AUTHORITATIVE" : "TRACKING (non-authoritative view)"}
        </span>
      </p>
      <p className="text-xs text-slate-500 mt-2">
        Token holder: {authority.holder_edge_id} · epoch {authority.epoch}
      </p>
    </div>
  );
}
