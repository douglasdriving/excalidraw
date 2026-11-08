// The canvas storage API the controller and dialogs use. Delegates to the
// active HandleStore (a picked folder or browser storage), serializes writes
// so history pruning never races, and turns storage errors into readable
// messages.

import { StoreError, describeStorageError } from "./handleStore";

import type {
  CanvasListEntry,
  CanvasVersionEntry,
  HandleStore,
} from "./handleStore";
import type { StorageKind } from "./storageLocation";

export type { CanvasListEntry, CanvasVersionEntry };

export class LocalFilesApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

let active: { store: HandleStore; kind: StorageKind } | null = null;

export const setActiveStore = (
  next: { store: HandleStore; kind: StorageKind } | null,
) => {
  active = next;
  queue = Promise.resolve();
};

export const getActiveStorageKind = () => active?.kind ?? null;

const call = async <T>(fn: (store: HandleStore) => Promise<T>): Promise<T> => {
  if (!active) {
    throw new LocalFilesApiError("No storage location chosen yet", 0);
  }
  const { store } = active;
  try {
    return await fn(store);
  } catch (error: any) {
    if (error instanceof StoreError) {
      throw new LocalFilesApiError(error.message, error.status);
    }
    console.error("[local-files]", error);
    throw new LocalFilesApiError(describeStorageError(error, store.label), 500);
  }
};

let queue: Promise<unknown> = Promise.resolve();
const serialized = <T>(fn: (store: HandleStore) => Promise<T>): Promise<T> => {
  const next = queue.then(
    () => call(fn),
    () => call(fn),
  );
  queue = next.catch(() => {});
  return next;
};

export const localFilesApi = {
  list: (): Promise<{
    dir: string;
    files: CanvasListEntry[];
    lastOpened: string | null;
    /** canvas names, most recently opened first */
    recent: string[];
  }> => call((s) => s.list()),

  read: (name: string) => call((s) => s.read(name)),

  save: (body: { name: string; content: string; thumbnail?: string }) =>
    serialized((s) => s.save(body)),

  create: (body: {
    name: string;
    content: string;
    thumbnail?: string;
    pickFreeName?: boolean;
  }) => serialized((s) => s.create(body)),

  rename: (from: string, to: string) => serialized((s) => s.rename(from, to)),

  remove: (name: string) => serialized((s) => s.remove(name)),

  setLastOpened: (name: string | null) =>
    serialized((s) => s.setLastOpened(name)),

  history: (name: string) => call((s) => s.history(name)),

  readVersion: (name: string, id: string) => call((s) => s.version(name, id)),

  thumbnail: (name: string) => call((s) => s.thumbnail(name)),

  exportAll: () => call((s) => s.exportAll()),
};
