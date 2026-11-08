// Canvas storage over a FileSystemDirectoryHandle: either a folder the user
// picked (File System Access API) or the browser's private file system
// (OPFS). Both expose the same handle interface, so one implementation serves
// both.
//
// Layout inside the root folder:
//   <name>.excalidraw                           the canvases
//   .excalidraw-local/state.json                { lastOpened, recent }
//   .excalidraw-local/thumbnails/<name>.png
//   .excalidraw-local/history/<name>/<epochMs>.excalidraw
//   .excalidraw-local/trash/<epochMs> <name>/...   deleted canvases

import {
  CANVAS_EXTENSION,
  nameExists,
  nextFreeName,
  validateCanvasName,
} from "./names";
import { getVersionsToPrune } from "./retention";

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

export class StoreError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

// lib.dom in our TS config lacks the async-iterable half of the API
type DirEntries = AsyncIterable<[string, FileSystemHandle]>;
const entriesOf = (dir: FileSystemDirectoryHandle) =>
  (dir as unknown as { entries(): DirEntries }).entries();

const isNotFound = (error: unknown) =>
  error instanceof DOMException
    ? error.name === "NotFoundError" || error.name === "TypeMismatchError"
    : (error as any)?.name === "NotFoundError";

/** Maps browser storage errors to messages a user can act on. */
export const describeStorageError = (error: any, label: string): string => {
  switch (error?.name) {
    case "NotAllowedError":
    case "SecurityError":
      return `No permission to write in ${label}`;
    case "QuotaExceededError":
      return "Storage is full";
    case "NotFoundError":
      return `${label} was not found. Was it moved or deleted?`;
    case "NoModificationAllowedError":
      return `${label} is locked by another tab or program`;
  }
  return error?.message || String(error);
};

const META = ".excalidraw-local";

export const createHandleStore = (
  root: FileSystemDirectoryHandle,
  /** shown to the user as the storage location */
  label: string,
) => {
  // --- path helpers (paths are arrays of segments relative to root) --------

  const getDir = async (
    parts: readonly string[],
    create = false,
  ): Promise<FileSystemDirectoryHandle | null> => {
    let dir = root;
    try {
      for (const part of parts) {
        dir = await dir.getDirectoryHandle(part, { create });
      }
      return dir;
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }
      throw error;
    }
  };

  const split = (parts: readonly string[]) =>
    [parts.slice(0, -1), parts[parts.length - 1]] as const;

  const getFile = async (parts: readonly string[]): Promise<File | null> => {
    const [dirParts, name] = split(parts);
    const dir = await getDir(dirParts);
    if (!dir) {
      return null;
    }
    try {
      return await (await dir.getFileHandle(name)).getFile();
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }
      throw error;
    }
  };

  /** createWritable writes to a swap file and commits on close: atomic. */
  const writeFile = async (parts: readonly string[], data: string | Blob) => {
    const [dirParts, name] = split(parts);
    const dir = (await getDir(dirParts, true))!;
    const handle = await dir.getFileHandle(name, { create: true });
    const writable = await (handle as any).createWritable();
    try {
      await writable.write(data);
      await writable.close();
    } catch (error) {
      await writable.abort?.().catch(() => {});
      throw error;
    }
  };

  const remove = async (parts: readonly string[]) => {
    const [dirParts, name] = split(parts);
    const dir = await getDir(dirParts);
    try {
      await dir?.removeEntry(name, { recursive: true });
    } catch (error) {
      if (!isNotFound(error)) {
        throw error;
      }
    }
  };

  const listDir = async (parts: readonly string[]) => {
    const dir = await getDir(parts);
    const entries: { name: string; kind: FileSystemHandleKind }[] = [];
    if (dir) {
      for await (const [name, handle] of entriesOf(dir)) {
        entries.push({ name, kind: handle.kind });
      }
    }
    return entries;
  };

  /**
   * Moves a file or folder. The API has no portable rename, so this copies
   * then deletes: a crash in between leaves a duplicate, never a loss.
   */
  const move = async (
    from: readonly string[],
    to: readonly string[],
  ): Promise<void> => {
    const file = await getFile(from);
    if (file) {
      await writeFile(to, file);
      await remove(from);
      return;
    }
    const dir = await getDir(from);
    if (!dir) {
      return;
    }
    await getDir(to, true);
    for (const entry of await listDir(from)) {
      await move([...from, entry.name], [...to, entry.name]);
    }
    await remove(from);
  };

  // --- layout ---------------------------------------------------------------

  const canvasPath = (name: string) => [name + CANVAS_EXTENSION];
  const statePath = [META, "state.json"];
  const thumbPath = (name: string) => [META, "thumbnails", `${name}.png`];
  const historyDir = (name: string) => [META, "history", name];
  const versionPath = (name: string, id: string | number) => [
    ...historyDir(name),
    `${id}${CANVAS_EXTENSION}`,
  ];

  const assertName = (name: unknown): string => {
    if (typeof name !== "string") {
      throw new StoreError("Missing canvas name", 400);
    }
    const error = validateCanvasName(name);
    if (error) {
      throw new StoreError(error, 400);
    }
    return name;
  };

  const assertContent = (content: unknown): string => {
    if (typeof content !== "string") {
      throw new StoreError("Missing canvas content", 400);
    }
    try {
      JSON.parse(content);
    } catch {
      throw new StoreError("Canvas content is not valid JSON", 400);
    }
    return content;
  };

  type State = {
    lastOpened: string | null;
    /** canvas names, most recently opened first */
    recent: string[];
  };

  const readState = async (): Promise<State> => {
    try {
      const file = await getFile(statePath);
      const state = file ? JSON.parse(await file.text()) : {};
      return {
        lastOpened: state.lastOpened ?? null,
        recent: Array.isArray(state.recent) ? state.recent : [],
      };
    } catch {
      return { lastOpened: null, recent: [] };
    }
  };

  const writeState = (state: State) =>
    writeFile(statePath, JSON.stringify(state, null, 2));

  const setLastOpened = async (name: string | null) => {
    const state = await readState();
    await writeState({
      lastOpened: name,
      recent: name
        ? [name, ...state.recent.filter((n) => n !== name)]
        : state.recent,
    });
  };

  const listNames = async (): Promise<string[]> =>
    (await listDir([]))
      .filter((e) => e.kind === "file" && e.name.endsWith(CANVAS_EXTENSION))
      .map((e) => e.name.slice(0, -CANVAS_EXTENSION.length))
      .filter((name) => !validateCanvasName(name));

  const listVersionIds = async (name: string) =>
    (await listDir(historyDir(name)))
      .filter((e) => e.kind === "file" && e.name.endsWith(CANVAS_EXTENSION))
      .map((e) => e.name.slice(0, -CANVAS_EXTENSION.length))
      .filter((id) => /^\d+$/.test(id));

  const addVersion = async (name: string, content: string) => {
    const existing = new Set(await listVersionIds(name));
    let timestamp = Date.now();
    while (existing.has(String(timestamp))) {
      timestamp++;
    }
    await writeFile(versionPath(name, timestamp), content);
    existing.add(String(timestamp));

    const prune = getVersionsToPrune([...existing].map(Number), Date.now());
    for (const ts of prune) {
      await remove(versionPath(name, ts));
    }
  };

  const writeThumbnail = async (name: string, thumbnail: unknown) => {
    if (typeof thumbnail !== "string") {
      return;
    }
    const match = thumbnail.match(/^data:image\/png;base64,(.+)$/);
    if (match) {
      const bytes = Uint8Array.from(atob(match[1]), (c) => c.charCodeAt(0));
      await writeFile(
        thumbPath(name),
        new Blob([bytes], { type: "image/png" }),
      );
    }
  };

  const mustExist = async (name: string, message: string) => {
    const file = await getFile(canvasPath(name));
    if (!file) {
      throw new StoreError(message, 404);
    }
    return file;
  };

  return {
    label,
    root,

    async list() {
      const names = await listNames();
      const files: CanvasListEntry[] = await Promise.all(
        names.map(async (name) => {
          const file = (await getFile(canvasPath(name)))!;
          return {
            name,
            modified: file.lastModified,
            size: file.size,
            hasThumbnail: !!(await getFile(thumbPath(name))),
            versionCount: (await listVersionIds(name)).length,
          };
        }),
      );
      files.sort((a, b) => b.modified - a.modified);
      const { lastOpened, recent } = await readState();
      return {
        dir: label,
        files,
        lastOpened:
          lastOpened && names.includes(lastOpened) ? lastOpened : null,
        recent: recent.filter((name) => names.includes(name)),
      };
    },

    async read(name: string): Promise<string> {
      const valid = assertName(name);
      return (await mustExist(valid, `Canvas "${valid}" not found`)).text();
    },

    async save(body: { name: string; content: string; thumbnail?: string }) {
      const name = assertName(body.name);
      const content = assertContent(body.content);
      const previous = await mustExist(
        name,
        `Canvas "${name}" no longer exists in ${label}`,
      );
      if ((await previous.text()) === content) {
        return { saved: false, modified: previous.lastModified };
      }
      await writeFile(canvasPath(name), content);
      await addVersion(name, content);
      await writeThumbnail(name, body.thumbnail);
      await setLastOpened(name);
      const file = (await getFile(canvasPath(name)))!;
      return { saved: true, modified: file.lastModified };
    },

    /** Creates a new canvas. With `pickFreeName`, `name` is a base name. */
    async create(body: {
      name: string;
      content: string;
      thumbnail?: string;
      pickFreeName?: boolean;
    }) {
      const content = assertContent(body.content);
      let name = assertName(body.name);
      const names = await listNames();
      if (body.pickFreeName) {
        name = nextFreeName(name, names, { allowBase: true });
      } else if (nameExists(name, names)) {
        throw new StoreError(`A canvas named "${name}" already exists`, 409);
      }
      await writeFile(canvasPath(name), content);
      await addVersion(name, content);
      await writeThumbnail(name, body.thumbnail);
      await setLastOpened(name);
      const file = (await getFile(canvasPath(name)))!;
      return { name, modified: file.lastModified };
    },

    async rename(from: string, to: string) {
      assertName(from);
      assertName(to);
      await mustExist(from, `Canvas "${from}" not found`);
      const others = (await listNames()).filter(
        (n) => n.toLowerCase() !== from.toLowerCase(),
      );
      if (nameExists(to, others)) {
        throw new StoreError(`A canvas named "${to}" already exists`, 409);
      }
      await move(canvasPath(from), canvasPath(to));
      await move(thumbPath(from), thumbPath(to));
      await move(historyDir(from), historyDir(to));
      const state = await readState();
      await writeState({
        lastOpened: state.lastOpened === from ? to : state.lastOpened,
        recent: state.recent.map((n) => (n === from ? to : n)),
      });
      return { name: to };
    },

    /** Moves the canvas (and its history) into the trash folder. */
    async remove(name: string) {
      assertName(name);
      await mustExist(name, `Canvas "${name}" not found`);
      const bin = [META, "trash", `${Date.now()} ${name}`];
      await move(canvasPath(name), [...bin, name + CANVAS_EXTENSION]);
      await move(thumbPath(name), [...bin, "thumbnail.png"]);
      await move(historyDir(name), [...bin, "history"]);
      const state = await readState();
      await writeState({
        lastOpened: state.lastOpened === name ? null : state.lastOpened,
        recent: state.recent.filter((n) => n !== name),
      });
      return { trashedTo: bin.join("/") };
    },

    async setLastOpened(name: string | null) {
      await setLastOpened(name === null ? null : assertName(name));
      return { lastOpened: name };
    },

    async thumbnail(name: string): Promise<Blob | null> {
      return getFile(thumbPath(assertName(name)));
    },

    async history(name: string): Promise<CanvasVersionEntry[]> {
      const valid = assertName(name);
      const ids = await listVersionIds(valid);
      const versions = await Promise.all(
        ids.map(async (id) => ({
          id,
          timestamp: Number(id),
          size: (await getFile(versionPath(valid, id)))?.size ?? 0,
        })),
      );
      return versions.sort((a, b) => b.timestamp - a.timestamp);
    },

    async version(name: string, id: string): Promise<string> {
      const valid = assertName(name);
      if (!/^\d+$/.test(id)) {
        throw new StoreError("Invalid version id", 400);
      }
      const file = await getFile(versionPath(valid, id));
      if (!file) {
        throw new StoreError("Version not found", 404);
      }
      return file.text();
    },

    /** All canvases as files, for "Export all" from browser storage. */
    async exportAll(): Promise<{ name: string; content: string }[]> {
      const names = await listNames();
      return Promise.all(
        names.map(async (name) => ({
          name: name + CANVAS_EXTENSION,
          content: await (await getFile(canvasPath(name)))!.text(),
        })),
      );
    },
  };
};

export type HandleStore = ReturnType<typeof createHandleStore>;
