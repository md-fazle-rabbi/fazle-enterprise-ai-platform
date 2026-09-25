import "server-only";
import { env } from "@/env";

const BACKEND_TIMEOUT_MS = 5_000;

export type BackendInit = Omit<RequestInit, "signal" | "cache">;

// Why: the single door to FastAPI. The URL is built from the validated env value and a
// path chosen by our own code, never from anything a browser sent. A timeout stops a hung
// backend from hanging the page, and no-store keeps answers out of Next's fetch cache.
export async function backendFetch(path: string, init: BackendInit = {}): Promise<Response> {
  const url = new URL(path, env.BACKEND_URL);
  return fetch(url.href, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
  });
}

export async function isBackendReachable(): Promise<boolean> {
  try {
    const response = await backendFetch("/health");
    // Why: an unread body keeps the connection busy until garbage collection.
    await response.body?.cancel();
    return response.ok;
  } catch {
    return false;
  }
}
