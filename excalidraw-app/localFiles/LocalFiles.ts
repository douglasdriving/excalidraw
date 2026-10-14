/**
 * Desktop-style file handling on top of the local dev-server file API:
 * one canvas = one `<name>.excalidraw` file, autosaved whenever the drawing
 * actually changes, with version history kept by the server.
 *
 * State lives in a jotai atom so the UI (status pill, dialogs) can render it.
 */

import {
  CaptureUpdateAction,
  exportToCanvas,
  getNonDeletedElements,
  hashElementsVersion,
  loadFromBlob,
  serializeAsJSON,
} from "@excalidraw/excalidraw";
import { bumpElementVersions } from "@excalidraw/excalidraw/data/restore";
import { MIME_TYPES } from "@excalidraw/common";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import type { RestoredDataState } from "@excalidraw/excalidraw/data/restore";

import { appJotaiStore, atom } from "../app-jotai";

import { LocalFilesApiError, localFilesApi } from "./api";
import { UNTITLED_NAME } from "./names";

/** save this long after the last edit... */
const SAVE_IDLE_DELAY = 1500;
/** ...but never let unsaved changes sit longer than this while drawing */
const SAVE_MAX_DELAY = 10_000;
const RETRY_DELAY = 5000;
const THUMBNAIL_SIZE = 480;

export type SaveStatus =
  /** untitled canvas with nothing drawn yet: no file exists */
  "empty" | "saved" | "dirty" | "saving" | "error";

export type LocalFilesDialog = "open" | "saveAs" | "history" | null;

export type LocalFilesState = {
  availability: "checking" | "available" | "unavailable";
  unavailableReason: string | null;
  dir: string | null;
  /** null while the canvas is untitled and has never been saved */
  currentName: string | null;
  status: SaveStatus;
  lastSavedAt: number | null;
  error: string | null;
  retryAt: number | null;
  /** bumped on every save that wrote to disk (drives the save popup) */
  saveCount: number;
  lastSaveKind: "autosave" | "created" | "savedAs" | null;
  /** a blocking operation in progress, e.g. "Opening “Roadmap”…" */
  busy: string | null;
  dialog: LocalFilesDialog;
};

export const localFilesStateAtom = atom<LocalFilesState>({
  availability: "checking",
  unavailableReason: null,
  dir: null,
  currentName: null,
  status: "empty",
  lastSavedAt: null,
  error: null,
  retryAt: null,
  saveCount: 0,
  lastSaveKind: null,
  busy: null,
  dialog: null,
});

const getState = () => appJotaiStore.get(localFilesStateAtom);
const setState = (patch: Partial<LocalFilesState>) =>
  appJotaiStore.set(localFilesStateAtom, { ...getState(), ...patch });

const computeSignature = (
  elements: readonly ExcalidrawElement[],
  appState: Pick<AppState, "viewBackgroundColor">,
) => `${hashElementsVersion(elements)}|${appState.viewBackgroundColor}`;

const hasVisibleContent = (elements: readonly ExcalidrawElement[]) =>
  elements.some((element) => !element.isDeleted);

const makeThumbnail = async (
  elements: readonly ExcalidrawElement[],
  appState: Partial<AppState>,
  files: BinaryFiles,
): Promise<string | undefined> => {
  const visible = getNonDeletedElements(elements);
  if (!visible.length) {
    return undefined;
  }
  try {
    const canvas = await exportToCanvas({
      elements: visible,
      appState: {
        ...appState,
        exportBackground: true,
        exportWithDarkMode: false,
      },
      files,
      maxWidthOrHeight: THUMBNAIL_SIZE,
      exportPadding: 16,
    });
    return canvas.toDataURL(MIME_TYPES.png);
  } catch (error) {
    console.warn("[local-files] thumbnail failed", error);
    return undefined;
  }
};

const parseScene = (
  content: string,
  api: ExcalidrawImperativeAPI,
): Promise<RestoredDataState> =>
  loadFromBlob(
    new Blob([content], { type: MIME_TYPES.excalidraw }),
    api.getAppState(),
    api.getSceneElementsIncludingDeleted(),
  );

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export class LocalFiles {
  private static api: ExcalidrawImperativeAPI | null = null;
  /** signature of the scene as it is on disk */
  private static savedSignature: string | null = null;
  /** adopt the next onChange scene as "saved" (after initial load) */
  private static adoptNextChange = false;
  /** ignore scene changes while we replace the scene ourselves */
  private static suspended = false;

  private static idleTimer: number | null = null;
  private static maxTimer: number | null = null;
  private static retryTimer: number | null = null;
  private static inFlight: Promise<void> | null = null;

  static get state() {
    return getState();
  }

  static setApi(api: ExcalidrawImperativeAPI | null) {
    this.api = api;
  }

  static isActive() {
    return getState().availability === "available";
  }

  static setDialog(dialog: LocalFilesDialog) {
    setState({ dialog });
  }

  // ---------------------------------------------------------------------------
  // initial load
  // ---------------------------------------------------------------------------

  /**
   * Called while the app initializes. Returns the last opened canvas, or null
   * when there is none (start untitled) or the file API is unavailable (in
   * which case the app falls back to its browser-storage scene).
   */
  static async loadInitialScene(
    localAppState: Partial<AppState> | null,
  ): Promise<RestoredDataState | null> {
    setState({ availability: "checking" });
    let listing;
    try {
      listing = await localFilesApi.list();
    } catch (error) {
      setState({
        availability: "unavailable",
        unavailableReason: errorMessage(error),
      });
      return null;
    }

    setState({
      availability: "available",
      unavailableReason: null,
      dir: listing.dir,
    });

    if (!listing.lastOpened) {
      setState({ currentName: null, status: "empty" });
      return null;
    }

    try {
      const content = await localFilesApi.read(listing.lastOpened);
      const scene = await loadFromBlob(
        new Blob([content], { type: MIME_TYPES.excalidraw }),
        localAppState as AppState | null,
        null,
      );
      const file = listing.files.find((f) => f.name === listing.lastOpened);
      setState({
        currentName: listing.lastOpened,
        status: "saved",
        lastSavedAt: file?.modified ?? null,
      });
      this.adoptNextChange = true;
      return {
        ...scene,
        appState: { ...scene.appState, name: listing.lastOpened },
      };
    } catch (error) {
      setState({
        currentName: null,
        status: "empty",
        error: `Couldn't open “${listing.lastOpened}”: ${errorMessage(error)}`,
      });
      return null;
    }
  }

  /**
   * For scenes that come from elsewhere (share links): don't touch the last
   * opened file, treat the scene as a new untitled canvas instead.
   */
  static async initUntitled() {
    try {
      const listing = await localFilesApi.list();
      setState({
        availability: "available",
        unavailableReason: null,
        dir: listing.dir,
        currentName: null,
        status: "empty",
      });
    } catch (error) {
      setState({
        availability: "unavailable",
        unavailableReason: errorMessage(error),
      });
    }
  }

  /** Retry after the file API was unavailable at startup. */
  static async reconnect() {
    try {
      const listing = await localFilesApi.list();
      setState({
        availability: "available",
        unavailableReason: null,
        dir: listing.dir,
        currentName: null,
        status: "empty",
      });
      // keep what's on the canvas: it becomes a new untitled canvas
      this.savedSignature = null;
      const api = this.api;
      if (api) {
        this.onChange(
          api.getSceneElementsIncludingDeleted(),
          api.getAppState(),
        );
      }
    } catch (error) {
      setState({
        availability: "unavailable",
        unavailableReason: errorMessage(error),
      });
    }
  }

  // ---------------------------------------------------------------------------
  // change tracking & autosave
  // ---------------------------------------------------------------------------

  static onChange(elements: readonly ExcalidrawElement[], appState: AppState) {
    if (!this.isActive() || this.suspended) {
      return;
    }
    const signature = computeSignature(elements, appState);

    if (this.adoptNextChange) {
      this.adoptNextChange = false;
      this.savedSignature = signature;
      return;
    }

    const state = getState();
    if (signature === this.savedSignature) {
      // e.g. undo back to the saved state
      if (state.status === "dirty") {
        this.clearSaveTimers();
        setState({ status: state.currentName ? "saved" : "empty" });
      }
      return;
    }

    if (!state.currentName && !hasVisibleContent(elements)) {
      if (state.status !== "empty") {
        this.clearSaveTimers();
        setState({ status: "empty" });
      }
      return;
    }

    if (state.status === "saving") {
      // picked up again once the current save finishes
      return;
    }
    if (state.status !== "dirty" && state.status !== "error") {
      setState({ status: "dirty" });
    }
    if (state.status !== "error") {
      this.scheduleSave();
    }
  }

  private static scheduleSave() {
    if (this.idleTimer) {
      window.clearTimeout(this.idleTimer);
    }
    this.idleTimer = window.setTimeout(() => this.save(), SAVE_IDLE_DELAY);
    if (!this.maxTimer) {
      this.maxTimer = window.setTimeout(() => this.save(), SAVE_MAX_DELAY);
    }
  }

  private static clearSaveTimers() {
    for (const timer of [this.idleTimer, this.maxTimer, this.retryTimer]) {
      if (timer) {
        window.clearTimeout(timer);
      }
    }
    this.idleTimer = this.maxTimer = this.retryTimer = null;
  }

  private static isDirty() {
    const api = this.api;
    if (!api || !this.isActive()) {
      return false;
    }
    const elements = api.getSceneElementsIncludingDeleted();
    const signature = computeSignature(elements, api.getAppState());
    if (signature === this.savedSignature) {
      return false;
    }
    return !!getState().currentName || hasVisibleContent(elements);
  }

  /** Saves the current scene now (if it changed). Never throws. */
  static save(): Promise<void> {
    if (this.inFlight) {
      return this.inFlight;
    }
    this.clearSaveTimers();
    if (!this.isDirty()) {
      return Promise.resolve();
    }
    this.inFlight = this.doSave().finally(() => {
      this.inFlight = null;
      // edits made while saving
      if (getState().status === "saved" && this.isDirty()) {
        setState({ status: "dirty" });
        this.scheduleSave();
      }
    });
    return this.inFlight;
  }

  private static async doSave() {
    const api = this.api!;
    const elements = api.getSceneElementsIncludingDeleted();
    const appState = api.getAppState();
    const files = api.getFiles();
    const signature = computeSignature(elements, appState);
    const name = getState().currentName;

    setState({ status: "saving", error: null, retryAt: null });

    try {
      const content = serializeAsJSON(
        getNonDeletedElements(elements),
        appState,
        files,
        "local",
      );
      const thumbnail = await makeThumbnail(elements, appState, files);

      let wrote = true;
      let kind: LocalFilesState["lastSaveKind"] = "autosave";
      let savedName = name;
      if (name) {
        try {
          const result = await localFilesApi.save({ name, content, thumbnail });
          wrote = result.saved;
        } catch (error) {
          // the file was deleted/renamed behind our back: recreate it
          if (error instanceof LocalFilesApiError && error.status === 404) {
            savedName = (
              await localFilesApi.create({
                name,
                content,
                thumbnail,
                pickFreeName: true,
              })
            ).name;
            kind = "created";
          } else {
            throw error;
          }
        }
      } else {
        savedName = (
          await localFilesApi.create({
            name: UNTITLED_NAME,
            content,
            thumbnail,
            pickFreeName: true,
          })
        ).name;
        kind = "created";
      }

      if (getState().currentName !== name) {
        // user switched canvases mid-save; this result is stale
        return;
      }

      this.savedSignature = signature;
      const state = getState();
      setState({
        currentName: savedName,
        status: "saved",
        lastSavedAt: Date.now(),
        error: null,
        retryAt: null,
        ...(wrote && {
          saveCount: state.saveCount + 1,
          lastSaveKind: kind,
        }),
      });
      if (savedName !== name) {
        this.withSuspended(() =>
          api.updateScene({
            appState: { name: savedName! },
            captureUpdate: CaptureUpdateAction.NEVER,
          }),
        );
      }
    } catch (error) {
      console.error("[local-files] save failed", error);
      const retryAt = Date.now() + RETRY_DELAY;
      setState({ status: "error", error: errorMessage(error), retryAt });
      this.retryTimer = window.setTimeout(() => this.save(), RETRY_DELAY);
    }
  }

  /** Called when the page is being hidden/closed. */
  static onPageHide() {
    if (this.isDirty()) {
      this.save();
    }
  }

  /** Returns true if leaving now would lose changes. */
  static onBeforeUnload(): boolean {
    if (!this.isDirty() && !this.inFlight) {
      return false;
    }
    const api = this.api!;
    const name = getState().currentName;
    if (name && !this.inFlight) {
      const content = serializeAsJSON(
        getNonDeletedElements(api.getSceneElementsIncludingDeleted()),
        api.getAppState(),
        api.getFiles(),
        "local",
      );
      if (localFilesApi.saveOnUnload({ name, content })) {
        return false;
      }
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // file operations
  // ---------------------------------------------------------------------------

  private static withSuspended<T>(fn: () => T): T {
    this.suspended = true;
    try {
      return fn();
    } finally {
      this.suspended = false;
    }
  }

  /** Replaces the scene and marks it as the saved state of `name`. */
  private static loadIntoEditor(scene: RestoredDataState, name: string | null) {
    const api = this.api!;
    this.clearSaveTimers();
    this.withSuspended(() => {
      api.updateScene({
        elements: scene.elements,
        appState: { ...scene.appState, name: name ?? UNTITLED_NAME },
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      const files = Object.values(scene.files || {});
      if (files.length) {
        api.addFiles(files);
      }
      api.history.clear();
    });
    this.savedSignature = computeSignature(
      api.getSceneElementsIncludingDeleted(),
      api.getAppState(),
    );
    if (hasVisibleContent(scene.elements)) {
      api.scrollToContent(undefined, { fitToContent: true, maxZoom: 1 });
    }
  }

  private static async runBusy<T>(
    label: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    setState({ busy: label });
    try {
      return await fn();
    } finally {
      setState({ busy: null });
    }
  }

  /** Throws on failure so dialogs can show the error. */
  static async open(name: string) {
    const api = this.api;
    if (!api) {
      return;
    }
    await this.runBusy(`Opening “${name}”…`, async () => {
      await this.save();
      const content = await localFilesApi.read(name);
      const scene = await parseScene(content, api);
      this.loadIntoEditor(scene, name);
      const file = (await localFilesApi.list()).files.find(
        (f) => f.name === name,
      );
      setState({
        currentName: name,
        status: "saved",
        lastSavedAt: file?.modified ?? null,
        error: null,
        retryAt: null,
        dialog: null,
      });
      localFilesApi.setLastOpened(name).catch(() => {});
      api.setToast({ message: `Opened “${name}”`, duration: 2000 });
    });
  }

  static async newCanvas() {
    const api = this.api;
    if (!api) {
      return;
    }
    await this.runBusy("Creating a new canvas…", async () => {
      await this.save();
      this.loadIntoEditor(
        { elements: [], appState: api.getAppState(), files: {} },
        null,
      );
      setState({
        currentName: null,
        status: "empty",
        lastSavedAt: null,
        error: null,
        retryAt: null,
        dialog: null,
      });
      localFilesApi.setLastOpened(null).catch(() => {});
      api.setToast({
        message: "New untitled canvas — it's saved as soon as you draw",
        duration: 2500,
      });
    });
  }

  /** Saves a copy of the current scene under `name` and switches to it. */
  static async saveAs(name: string) {
    const api = this.api;
    if (!api) {
      return;
    }
    await this.runBusy(`Saving as “${name}”…`, async () => {
      await this.save();
      const elements = api.getSceneElementsIncludingDeleted();
      const appState = { ...api.getAppState(), name };
      const files = api.getFiles();
      const content = serializeAsJSON(
        getNonDeletedElements(elements),
        appState,
        files,
        "local",
      );
      const thumbnail = await makeThumbnail(elements, appState, files);
      await localFilesApi.create({ name, content, thumbnail });

      const previous = getState().currentName;
      this.clearSaveTimers();
      this.savedSignature = computeSignature(elements, appState);
      this.withSuspended(() =>
        api.updateScene({
          appState: { name },
          captureUpdate: CaptureUpdateAction.NEVER,
        }),
      );
      const state = getState();
      setState({
        currentName: name,
        status: "saved",
        lastSavedAt: Date.now(),
        error: null,
        retryAt: null,
        dialog: null,
        saveCount: state.saveCount + 1,
        lastSaveKind: "savedAs",
      });
      api.setToast({
        message: previous
          ? `Saved a copy as “${name}”. You're now editing the copy; “${previous}” is unchanged.`
          : `Saved as “${name}”`,
        duration: 4000,
      });
    });
  }

  static async rename(from: string, to: string) {
    await localFilesApi.rename(from, to);
    if (getState().currentName === from) {
      setState({ currentName: to });
      this.api &&
        this.withSuspended(() =>
          this.api!.updateScene({
            appState: { name: to },
            captureUpdate: CaptureUpdateAction.NEVER,
          }),
        );
    }
    this.api?.setToast({ message: `Renamed to “${to}”`, duration: 2000 });
  }

  /** Moves a canvas to the trash folder. Deleting the open one starts fresh. */
  static async remove(name: string) {
    const isCurrent = getState().currentName === name;
    if (isCurrent) {
      // don't let a pending autosave resurrect it
      this.clearSaveTimers();
      await this.inFlight;
    }
    await localFilesApi.remove(name);
    if (isCurrent && this.api) {
      this.loadIntoEditor(
        { elements: [], appState: this.api.getAppState(), files: {} },
        null,
      );
      setState({ currentName: null, status: "empty", lastSavedAt: null });
    }
    this.api?.setToast({
      message: `Moved “${name}” to the trash folder`,
      duration: 2500,
    });
  }

  /** Brings back an old version as a new, undoable edit (then autosaved). */
  static async restoreVersion(versionId: string, label: string) {
    const api = this.api;
    const name = getState().currentName;
    if (!api || !name) {
      return;
    }
    await this.runBusy(`Restoring version from ${label}…`, async () => {
      const content = await localFilesApi.readVersion(name, versionId);
      const scene = await parseScene(content, api);
      const files = Object.values(scene.files || {});
      if (files.length) {
        api.addFiles(files);
      }
      api.updateScene({
        elements: bumpElementVersions(
          scene.elements,
          api.getSceneElementsIncludingDeleted(),
        ),
        appState: { viewBackgroundColor: scene.appState.viewBackgroundColor },
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      setState({ dialog: null });
      api.setToast({
        message: `Restored the version from ${label}. Undo (Ctrl+Z) to go back.`,
        duration: 4000,
      });
    });
    // save right away so the restore shows up in history immediately
    await this.save();
  }

  static async loadVersionPreview(versionId: string) {
    const api = this.api;
    const name = getState().currentName;
    if (!api || !name) {
      throw new Error("No canvas open");
    }
    const content = await localFilesApi.readVersion(name, versionId);
    const scene = await parseScene(content, api);
    return makeThumbnail(scene.elements, scene.appState, scene.files);
  }
}
