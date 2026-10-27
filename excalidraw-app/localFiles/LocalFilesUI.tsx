import { KEYS, preventUnload } from "@excalidraw/common";
import { useEffect } from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { useAtomValue } from "../app-jotai";

import { CanvasSwitcher } from "./CanvasSwitcher";
import { LocalFiles, localFilesStateAtom } from "./LocalFiles";
import { UNTITLED_NAME } from "./names";
import { OpenCanvasDialog } from "./OpenCanvasDialog";
import { SaveAsDialog } from "./SaveAsDialog";
import { SavePopup } from "./SavePopup";
import { VersionHistoryDialog } from "./VersionHistoryDialog";

import "./LocalFiles.scss";

export { FileStatusPill } from "./FileStatusPill";

/**
 * Ctrl+O opens the canvas browser; Ctrl+S and Ctrl+Shift+S open "Save as"
 * (there's no manual save: everything autosaves). Registered in the capture
 * phase so the editor's own open/save shortcuts never see these keys.
 */
const useFileShortcuts = () => {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event[KEYS.CTRL_OR_CMD] || event.altKey) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key !== KEYS.O && key !== KEYS.S) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      const { availability, busy, dialog } = LocalFiles.state;
      if (availability !== "available" || busy || dialog) {
        return;
      }
      LocalFiles.setDialog(key === KEYS.O ? "open" : "saveAs");
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, []);
};

const useFlushOnLeave = () => {
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        LocalFiles.onPageHide();
      }
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (LocalFiles.onBeforeUnload()) {
        preventUnload(event);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, []);
};

/** Dialogs, save popup and shortcuts. Render inside <Excalidraw>. */
export const LocalFilesUI = ({
  excalidrawAPI,
}: {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
}) => {
  const { dialog, currentName, availability } =
    useAtomValue(localFilesStateAtom);

  useEffect(() => {
    LocalFiles.setApi(excalidrawAPI);
  }, [excalidrawAPI]);

  useEffect(() => {
    document.title =
      availability === "checking"
        ? "Excalidraw"
        : `${currentName ?? UNTITLED_NAME} — Excalidraw`;
  }, [currentName, availability]);

  useFileShortcuts();
  useFlushOnLeave();

  return (
    <>
      <SavePopup />
      <CanvasSwitcher excalidrawAPI={excalidrawAPI} />
      {dialog === "open" && <OpenCanvasDialog />}
      {dialog === "saveAs" && <SaveAsDialog />}
      {dialog === "history" && currentName && <VersionHistoryDialog />}
    </>
  );
};
