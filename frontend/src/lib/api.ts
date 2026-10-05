const envBase = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "");

/** Same-origin by default so the Vite proxy avoids CORS on localhost vs 127.0.0.1. */
export const API_BASE = envBase ?? "";

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

export function liveSocketUrl(): string {
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL as string;
  if (API_BASE) {
    const base = new URL(API_BASE, window.location.origin);
    const proto = base.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${base.host}/ws/live`;
  }
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/ws/live`;
}

async function readJson<T>(resp: Response, label: string): Promise<T> {
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`${label} failed (${resp.status})${text ? `: ${text.slice(0, 160)}` : ""}`);
  }
  return resp.json() as Promise<T>;
}

export async function apiFetch(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const { timeoutMs = 8000, signal, ...rest } = init;
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    return await fetch(apiUrl(path), { ...rest, signal: ctrl.signal });
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new Error(`${path} timed out`);
    }
    throw err;
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

export async function apiGet<T>(path: string, timeoutMs = 8000): Promise<T> {
  return readJson<T>(await apiFetch(path, { timeoutMs }), path);
}

export async function apiPost<T>(path: string, body?: unknown, timeoutMs = 8000): Promise<T> {
  return readJson<T>(
    await apiFetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
      timeoutMs,
    }),
    path,
  );
}
