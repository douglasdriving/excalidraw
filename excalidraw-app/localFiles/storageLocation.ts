// Where canvases are stored: a folder the user picked (File System Access
// API, Chromium only) or the browser's private file system (OPFS, all modern
// browsers). The choice and the folder handle are kept in IndexedDB.

import { createStore, get, set } from "idb-keyval";

import { createHandleStore } from "./handleStore";

import type { HandleStore } from "./handleStore";

export type StorageKind = "folder" | "browser";

type SavedLocation =
  | { kind: "folder"; handle: FileSystemDirectoryHandle }
  | { kind: "browser" };

/** The outcome of trying to reopen the saved location at startup. */
export type RestoreResult =
  | { status: "ready"; store: HandleStore; kind: StorageKind }
  /** nothing chosen yet: show the setup dialog */
  | { status: "setup" }
  /** folder known, but the browser wants a click before granting access */
  | { status: "permission"; folderName: string };

const idbStore = createStore("excalidraw-local-files", "location");
const KEY = "location";

const BROWSER_LABEL = "browser storage";

type PermissionHandle = FileSystemDirectoryHandle & {
  queryPermission(opts: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission(opts: { mode: "readwrite" }): Promise<PermissionState>;
};

export const supportsFolderAccess = () =>
  typeof (window as any).showDirectoryPicker === "function";

export const isBrave = () => !!(navigator as any).brave;

const openBrowserStore = async () => {
  const opfs = await navigator.storage.getDirectory();
  const root = await opfs.getDirectoryHandle("canvases", { create: true });
  // ask the browser not to evict the canvases under storage pressure
  navigator.storage.persist?.().catch(() => {});
  return createHandleStore(root, BROWSER_LABEL);
};

const openFolderStore = (handle: FileSystemDirectoryHandle) =>
  createHandleStore(handle, `the “${handle.name}” folder`);

let pendingFolder: FileSystemDirectoryHandle | null = null;

export const restoreLocation = async (): Promise<RestoreResult> => {
  const saved = await get<SavedLocation>(KEY, idbStore).catch(() => undefined);
  if (!saved) {
    return { status: "setup" };
  }
  if (saved.kind === "browser") {
    return {
      status: "ready",
      store: await openBrowserStore(),
      kind: "browser",
    };
  }
  const handle = saved.handle as PermissionHandle;
  const permission = await handle.queryPermission({ mode: "readwrite" });
  if (permission === "granted") {
    return { status: "ready", store: openFolderStore(handle), kind: "folder" };
  }
  pendingFolder = handle;
  return { status: "permission", folderName: handle.name };
};

/** Re-grants access to the saved folder. Must run inside a click handler. */
export const reconnectFolder = async (): Promise<HandleStore | null> => {
  const handle = pendingFolder as PermissionHandle | null;
  if (!handle) {
    return null;
  }
  const permission = await handle.requestPermission({ mode: "readwrite" });
  if (permission !== "granted") {
    return null;
  }
  pendingFolder = null;
  return openFolderStore(handle);
};

/**
 * Opens the folder picker. Returns null when the user cancels. Must run
 * inside a click handler. Doesn't save the choice; see `chooseFolder`.
 */
export const pickFolder =
  async (): Promise<FileSystemDirectoryHandle | null> => {
    try {
      return await (window as any).showDirectoryPicker({
        id: "excalidraw-canvases",
        mode: "readwrite",
      });
    } catch (error: any) {
      if (error?.name === "AbortError") {
        return null;
      }
      throw error;
    }
  };

export const chooseFolder = async (handle: FileSystemDirectoryHandle) => {
  const location: SavedLocation = { kind: "folder", handle };
  await set(KEY, location, idbStore);
  pendingFolder = null;
  return openFolderStore(handle);
};

export const chooseBrowserStorage = async () => {
  const location: SavedLocation = { kind: "browser" };
  await set(KEY, location, idbStore);
  pendingFolder = null;
  return openBrowserStore();
};
