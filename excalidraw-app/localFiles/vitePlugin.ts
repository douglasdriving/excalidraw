// Vite dev-server plugin exposing a small JSON API over a local folder of
// `.excalidraw` files, so the app can save/load canvases like a desktop app.
//
// Layout on disk:
//   <dir>/<name>.excalidraw                     the canvases
//   <dir>/.excalidraw-local/state.json          { lastOpened }
//   <dir>/.excalidraw-local/thumbnails/<name>.png
//   <dir>/.excalidraw-local/history/<name>/<epochMs>.excalidraw
//   <dir>/.excalidraw-local/trash/<epochMs> <name>/...   deleted canvases

import fs from "fs/promises";
import path from "path";

import {
  CANVAS_EXTENSION,
  nameExists,
  nextFreeName,
  validateCanvasName,
} from "./names";
import { getVersionsToPrune } from "./retention";

import type { IncomingMessage, ServerResponse } from "http";
import type { Plugin } from "vite";

export const LOCAL_FILES_API = "/api/local-files";

export type CanvasListEntry = {
  name: string;
  modified: number;
  size: number;
  hasThumbnail: boolean;
  versionCount: number;
};

export type CanvasVersionEntry = {
  id: string;
  timestamp: number;
  size: number;
};

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const createLocalFilesStore = (dir: string) => {
  const metaDir = path.join(dir, ".excalidraw-local");
  const statePath = path.join(metaDir, "state.json");
  const thumbsDir = path.join(metaDir, "thumbnails");
  const historyRoot = path.join(metaDir, "history");
  const trashDir = path.join(metaDir, "trash");

  const assertName = (name: unknown): string => {
    if (typeof name !== "string") {
      throw new HttpError(400, "Missing canvas name");
    }
    const error = validateCanvasName(name);
    if (error) {
      throw new HttpError(400, error);
    }
    return name;
  };

  const canvasPath = (name: string) => path.join(dir, name + CANVAS_EXTENSION);
  const thumbPath = (name: string) => path.join(thumbsDir, `${name}.png`);
  const historyDir = (name: string) => path.join(historyRoot, name);

  const exists = (p: string) =>
    fs.access(p).then(
      () => true,
      () => false,
    );

  const writeAtomic = async (target: string, data: string | Buffer) => {
    await fs.mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, target);
  };

  const readState = async (): Promise<{ lastOpened: string | null }> => {
    try {
      return JSON.parse(await fs.readFile(statePath, "utf8"));
    } catch {
      return { lastOpened: null };
    }
  };

  const setLastOpened = async (name: string | null) => {
    await writeAtomic(
      statePath,
      JSON.stringify({ ...(await readState()), lastOpened: name }, null, 2),
    );
  };

  const listNames = async (): Promise<string[]> => {
    await fs.mkdir(dir, { recursive: true });
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith(CANVAS_EXTENSION))
      .map((e) => e.name.slice(0, -CANVAS_EXTENSION.length))
      .filter((name) => !validateCanvasName(name));
  };

  const listVersionFiles = async (name: string) => {
    try {
      const files = await fs.readdir(historyDir(name));
      return files
        .filter((f) => f.endsWith(CANVAS_EXTENSION))
        .map((f) => ({
          id: f.slice(0, -CANVAS_EXTENSION.length),
          timestamp: Number(f.slice(0, -CANVAS_EXTENSION.length)),
        }))
        .filter((v) => Number.isFinite(v.timestamp));
    } catch {
      return [];
    }
  };

  const addVersion = async (name: string, content: string) => {
    let timestamp = Date.now();
    const versionPath = () =>
      path.join(historyDir(name), `${timestamp}${CANVAS_EXTENSION}`);
    while (await exists(versionPath())) {
      timestamp++;
    }
    await writeAtomic(versionPath(), content);

    const versions = await listVersionFiles(name);
    const prune = getVersionsToPrune(
      versions.map((v) => v.timestamp),
      Date.now(),
    );
    await Promise.all(
      prune.map((ts) =>
        fs.rm(path.join(historyDir(name), `${ts}${CANVAS_EXTENSION}`), {
          force: true,
        }),
      ),
    );
  };

  const writeThumbnail = async (name: string, thumbnail: unknown) => {
    if (typeof thumbnail !== "string") {
      return;
    }
    const match = thumbnail.match(/^data:image\/png;base64,(.+)$/);
    if (match) {
      await writeAtomic(thumbPath(name), Buffer.from(match[1], "base64"));
    }
  };

  const assertContent = (content: unknown): string => {
    if (typeof content !== "string") {
      throw new HttpError(400, "Missing canvas content");
    }
    try {
      JSON.parse(content);
    } catch {
      throw new HttpError(400, "Canvas content is not valid JSON");
    }
    return content;
  };

  const moveIfExists = async (from: string, to: string) => {
    if (await exists(from)) {
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.rename(from, to);
    }
  };

  return {
    dir,

    async list() {
      const names = await listNames();
      const files: CanvasListEntry[] = await Promise.all(
        names.map(async (name) => {
          const stat = await fs.stat(canvasPath(name));
          return {
            name,
            modified: stat.mtimeMs,
            size: stat.size,
            hasThumbnail: await exists(thumbPath(name)),
            versionCount: (await listVersionFiles(name)).length,
          };
        }),
      );
      files.sort((a, b) => b.modified - a.modified);
      const { lastOpened } = await readState();
      return {
        dir,
        files,
        lastOpened:
          lastOpened && names.includes(lastOpened) ? lastOpened : null,
      };
    },

    async read(name: unknown) {
      const valid = assertName(name);
      if (!(await exists(canvasPath(valid)))) {
        throw new HttpError(404, `Canvas "${valid}" not found`);
      }
      return fs.readFile(canvasPath(valid), "utf8");
    },

    async save(body: any) {
      const name = assertName(body.name);
      const content = assertContent(body.content);
      const target = canvasPath(name);
      if (!(await exists(target))) {
        throw new HttpError(404, `Canvas "${name}" no longer exists on disk`);
      }
      const previous = await fs.readFile(target, "utf8");
      if (previous === content) {
        return { saved: false, modified: (await fs.stat(target)).mtimeMs };
      }
      await writeAtomic(target, content);
      await addVersion(name, content);
      await writeThumbnail(name, body.thumbnail);
      await setLastOpened(name);
      return { saved: true, modified: (await fs.stat(target)).mtimeMs };
    },

    /** Creates a new canvas. With `pickFreeName`, `name` is a base name. */
    async create(body: any) {
      const content = assertContent(body.content);
      let name = assertName(body.name);
      const names = await listNames();
      if (body.pickFreeName) {
        name = nextFreeName(name, names, { allowBase: true });
      } else if (nameExists(name, names)) {
        throw new HttpError(409, `A canvas named "${name}" already exists`);
      }
      await writeAtomic(canvasPath(name), content);
      await addVersion(name, content);
      await writeThumbnail(name, body.thumbnail);
      await setLastOpened(name);
      return { name, modified: (await fs.stat(canvasPath(name))).mtimeMs };
    },

    async rename(body: any) {
      const from = assertName(body.from);
      const to = assertName(body.to);
      if (!(await exists(canvasPath(from)))) {
        throw new HttpError(404, `Canvas "${from}" not found`);
      }
      const others = (await listNames()).filter(
        (n) => n.toLowerCase() !== from.toLowerCase(),
      );
      if (nameExists(to, others)) {
        throw new HttpError(409, `A canvas named "${to}" already exists`);
      }
      await fs.rename(canvasPath(from), canvasPath(to));
      await moveIfExists(thumbPath(from), thumbPath(to));
      await moveIfExists(historyDir(from), historyDir(to));
      const { lastOpened } = await readState();
      if (lastOpened === from) {
        await setLastOpened(to);
      }
      return { name: to };
    },

    /** Moves the canvas (and its history) into the trash folder. */
    async remove(body: any) {
      const name = assertName(body.name);
      if (!(await exists(canvasPath(name)))) {
        throw new HttpError(404, `Canvas "${name}" not found`);
      }
      const bin = path.join(trashDir, `${Date.now()} ${name}`);
      await moveIfExists(
        canvasPath(name),
        path.join(bin, name + CANVAS_EXTENSION),
      );
      await moveIfExists(thumbPath(name), path.join(bin, "thumbnail.png"));
      await moveIfExists(historyDir(name), path.join(bin, "history"));
      const { lastOpened } = await readState();
      if (lastOpened === name) {
        await setLastOpened(null);
      }
      return { trashedTo: bin };
    },

    async setLastOpened(body: any) {
      const name = body.name === null ? null : assertName(body.name);
      await setLastOpened(name);
      return { lastOpened: name };
    },

    async thumbnail(name: unknown) {
      const valid = assertName(name);
      try {
        return await fs.readFile(thumbPath(valid));
      } catch {
        throw new HttpError(404, "No thumbnail");
      }
    },

    async history(name: unknown): Promise<CanvasVersionEntry[]> {
      const valid = assertName(name);
      const versions = await listVersionFiles(valid);
      const withSize = await Promise.all(
        versions.map(async (v) => ({
          ...v,
          size: (
            await fs.stat(path.join(historyDir(valid), v.id + CANVAS_EXTENSION))
          ).size,
        })),
      );
      return withSize.sort((a, b) => b.timestamp - a.timestamp);
    },

    async version(name: unknown, id: unknown) {
      const valid = assertName(name);
      if (typeof id !== "string" || !/^\d+$/.test(id)) {
        throw new HttpError(400, "Invalid version id");
      }
      try {
        return await fs.readFile(
          path.join(historyDir(valid), id + CANVAS_EXTENSION),
          "utf8",
        );
      } catch {
        throw new HttpError(404, "Version not found");
      }
    },
  };
};

const readJsonBody = (req: IncomingMessage): Promise<any> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(
          chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {},
        );
      } catch {
        reject(new HttpError(400, "Request body is not valid JSON"));
      }
    });
    req.on("error", reject);
  });

const describeError = (error: any, dir: string): string => {
  switch (error?.code) {
    case "EACCES":
    case "EPERM":
    case "EROFS":
      return `No permission to write in ${dir}`;
    case "ENOSPC":
      return "The disk is full";
    case "ENOENT":
      return `Folder not found: ${dir}`;
  }
  return error?.message || String(error);
};

const sendJson = (res: ServerResponse, status: number, data: unknown) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
};

export const localFilesPlugin = (opts: { dir: string }): Plugin => {
  const store = createLocalFilesStore(path.resolve(opts.dir));

  // Saves to the same canvas are serialized so history/pruning never race.
  let queue: Promise<unknown> = Promise.resolve();
  const serialized = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.then(fn, fn);
    queue = next.catch(() => {});
    return next;
  };

  return {
    name: "excalidraw-local-files",
    configureServer(server) {
      server.middlewares.use(LOCAL_FILES_API, async (req, res) => {
        const url = new URL(req.url || "/", "http://localhost");
        const route = `${req.method} ${url.pathname}`;
        const q = (key: string) => url.searchParams.get(key);
        try {
          switch (route) {
            case "GET /list":
              return sendJson(res, 200, await store.list());
            case "GET /file": {
              const content = await store.read(q("name"));
              res.setHeader("Content-Type", "application/json");
              res.setHeader("Cache-Control", "no-store");
              return res.end(content);
            }
            case "GET /thumbnail": {
              const png = await store.thumbnail(q("name"));
              res.setHeader("Content-Type", "image/png");
              res.setHeader("Cache-Control", "no-store");
              return res.end(png);
            }
            case "GET /history":
              return sendJson(res, 200, await store.history(q("name")));
            case "GET /version": {
              const content = await store.version(q("name"), q("id"));
              res.setHeader("Content-Type", "application/json");
              return res.end(content);
            }
          }
          if (req.method === "POST") {
            const body = await readJsonBody(req);
            const handlers: Record<string, (body: any) => Promise<unknown>> = {
              "/save": store.save,
              "/create": store.create,
              "/rename": store.rename,
              "/delete": store.remove,
              "/last-opened": store.setLastOpened,
            };
            const handler = handlers[url.pathname];
            if (handler) {
              return sendJson(res, 200, await serialized(() => handler(body)));
            }
          }
          throw new HttpError(404, `Unknown route ${route}`);
        } catch (error: any) {
          const status = error instanceof HttpError ? error.status : 500;
          if (status === 500) {
            console.error("[local-files]", error);
          }
          sendJson(res, status, { error: describeError(error, store.dir) });
        }
      });
      server.config.logger.info(`  ➜  Local canvases folder: ${store.dir}`);
    },
  };
};
