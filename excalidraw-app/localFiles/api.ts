import type { CanvasListEntry, CanvasVersionEntry } from "./vitePlugin";

export type { CanvasListEntry, CanvasVersionEntry };

const BASE = "/api/local-files";

export class LocalFilesApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

const request = async (
  path: string,
  init?: RequestInit & { json?: unknown },
): Promise<Response> => {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      ...(init?.json !== undefined && {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(init.json),
      }),
    });
  } catch {
    throw new LocalFilesApiError(
      "Can't reach the local file server. Is the dev server running?",
      0,
    );
  }
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      message = (await response.json()).error || message;
    } catch {
      // the dev server isn't serving this API (e.g. a production build)
      message =
        response.status === 404
          ? "Local file API not available (only runs on the Vite dev server)"
          : message;
    }
    throw new LocalFilesApiError(message, response.status);
  }
  return response;
};

const enc = encodeURIComponent;

export const localFilesApi = {
  list: async (): Promise<{
    dir: string;
    files: CanvasListEntry[];
    lastOpened: string | null;
    /** canvas names, most recently opened first */
    recent: string[];
  }> => (await request("/list")).json(),

  read: async (name: string): Promise<string> =>
    (await request(`/file?name=${enc(name)}`)).text(),

  save: async (body: {
    name: string;
    content: string;
    thumbnail?: string;
  }): Promise<{ saved: boolean; modified: number }> =>
    (await request("/save", { json: body })).json(),

  create: async (body: {
    name: string;
    content: string;
    thumbnail?: string;
    pickFreeName?: boolean;
  }): Promise<{ name: string; modified: number }> =>
    (await request("/create", { json: body })).json(),

  rename: async (from: string, to: string): Promise<{ name: string }> =>
    (await request("/rename", { json: { from, to } })).json(),

  remove: async (name: string): Promise<{ trashedTo: string }> =>
    (await request("/delete", { json: { name } })).json(),

  setLastOpened: async (name: string | null) =>
    (await request("/last-opened", { json: { name } })).json(),

  history: async (name: string): Promise<CanvasVersionEntry[]> =>
    (await request(`/history?name=${enc(name)}`)).json(),

  readVersion: async (name: string, id: string): Promise<string> =>
    (await request(`/version?name=${enc(name)}&id=${enc(id)}`)).text(),

  thumbnailUrl: (name: string, cacheKey: number) =>
    `${BASE}/thumbnail?name=${enc(name)}&v=${cacheKey}`,

  /** Best-effort save while the page unloads (fetch keepalive caps ~64KB). */
  saveOnUnload: (body: { name: string; content: string }) => {
    const payload = JSON.stringify(body);
    if (payload.length > 60_000) {
      return false;
    }
    fetch(`${BASE}/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => {});
    return true;
  },
};
