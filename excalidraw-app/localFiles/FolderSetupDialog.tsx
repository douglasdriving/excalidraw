import { Dialog } from "@excalidraw/excalidraw/components/Dialog";
import { FilledButton } from "@excalidraw/excalidraw/components/FilledButton";
import { useState } from "react";

import { useAtomValue } from "../app-jotai";

import { createHandleStore } from "./handleStore";
import { installPromptOpenAtom } from "./InstallPrompt";
import { LocalFiles, localFilesStateAtom } from "./LocalFiles";
import {
  chooseBrowserStorage,
  chooseFolder,
  isBrave,
  pickFolder,
  reconnectFolder,
  supportsFolderAccess,
} from "./storageLocation";

type Picked = { handle: FileSystemDirectoryHandle; count: number };

/**
 * Choosing where canvases live: on first launch, when the saved folder needs
 * access re-granted, and when changing location from the Open dialog.
 */
export const FolderSetupDialog = () => {
  const { availability, dialog, permissionFolder, dir } =
    useAtomValue(localFilesStateAtom);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickInstead, setPickInstead] = useState(false);

  const installPromptOpen = useAtomValue(installPromptOpenAtom);

  const changing = dialog === "storage" && availability === "available";
  const open =
    !installPromptOpen &&
    (availability === "setup" || availability === "permission" || changing);
  if (!open) {
    return null;
  }

  const run = async (fn: () => Promise<void>) => {
    setPending(true);
    setError(null);
    try {
      await fn();
    } catch (error: any) {
      setError(error?.message || String(error));
    } finally {
      setPending(false);
    }
  };

  const browse = () =>
    run(async () => {
      const handle = await pickFolder();
      if (handle) {
        const { files } = await createHandleStore(handle, handle.name).list();
        setPicked({ handle, count: files.length });
      }
    });

  const connectFolder = (handle: FileSystemDirectoryHandle) =>
    run(async () => {
      await LocalFiles.connect(await chooseFolder(handle), "folder");
      setPicked(null);
      setPickInstead(false);
    });

  const connectBrowser = () =>
    run(async () => {
      await LocalFiles.connect(await chooseBrowserStorage(), "browser");
      setPicked(null);
      setPickInstead(false);
    });

  const reconnect = () =>
    run(async () => {
      const store = await reconnectFolder();
      if (!store) {
        throw new Error(
          "Access wasn't granted. Allow it, or choose another folder.",
        );
      }
      await LocalFiles.connect(store, "folder");
    });

  const errorText = error && (
    <div className="local-files-error-text">{error}</div>
  );

  if (availability === "permission" && !pickInstead) {
    return (
      <Dialog
        size="small"
        title="Reconnect to your canvases"
        className="local-files-dialog"
        onCloseRequest={() => {}}
      >
        <p className="local-files-setup__text">
          Your canvases are in the <strong>{permissionFolder}</strong> folder.
          The browser needs your OK to keep using it.
        </p>
        {errorText}
        <div className="local-files-dialog__actions">
          <FilledButton
            variant="outlined"
            color="muted"
            label="Choose another folder"
            onClick={() => setPickInstead(true)}
          />
          <FilledButton
            label="Allow access"
            status={pending ? "loading" : null}
            onClick={reconnect}
          />
        </div>
      </Dialog>
    );
  }

  const supported = supportsFolderAccess();
  const close = changing
    ? () => {
        setPicked(null);
        setError(null);
        LocalFiles.setDialog(null);
      }
    : () => {};

  return (
    <Dialog
      size="small"
      title={
        changing
          ? "Change storage location"
          : "Where should your canvases live?"
      }
      className="local-files-dialog"
      onCloseRequest={close}
    >
      {supported ? (
        <>
          <p className="local-files-setup__text">
            Pick a folder on your computer. Every canvas is saved there as a
            normal <code>.excalidraw</code> file, with version history kept
            alongside.
            {!changing && " You only do this once."}
          </p>
          {changing && (
            <p className="local-files-muted">
              Currently saving to {dir}. Canvases already saved there stay where
              they are.
            </p>
          )}
          {picked && (
            <div className="local-files-setup__picked">
              📁 <strong>{picked.handle.name}</strong> ·{" "}
              {picked.count === 0
                ? "empty folder"
                : `${picked.count} ${
                    picked.count === 1 ? "canvas" : "canvases"
                  } found`}
            </div>
          )}
          {errorText}
          <div className="local-files-dialog__actions">
            <FilledButton
              variant="outlined"
              color="muted"
              label="Keep in browser instead"
              onClick={connectBrowser}
            />
            {picked ? (
              <FilledButton
                label="Use this folder"
                status={pending ? "loading" : null}
                onClick={() => connectFolder(picked.handle)}
              />
            ) : (
              <FilledButton
                label="Choose folder…"
                status={pending ? "loading" : null}
                onClick={browse}
              />
            )}
          </div>
        </>
      ) : (
        <>
          <p className="local-files-setup__text">
            This browser can't save to a folder on your computer, so your
            canvases will be stored inside the browser. Autosave and version
            history still work; use <strong>Export all</strong> in the Open
            dialog (Ctrl+O) now and then to keep a copy as files.
          </p>
          {isBrave() ? (
            <p className="local-files-setup__text">
              On Brave you can turn folder saving on: open{" "}
              <code>brave://flags/#file-system-access-api</code>, set it to{" "}
              <em>Enabled</em>, and restart the browser.
            </p>
          ) : (
            <p className="local-files-setup__text">
              For folder saving, open this app in Chrome or Edge.
            </p>
          )}
          {errorText}
          <div className="local-files-dialog__actions">
            {changing && (
              <FilledButton
                variant="outlined"
                color="muted"
                label="Cancel"
                onClick={close}
              />
            )}
            <FilledButton
              label="Continue"
              status={pending ? "loading" : null}
              onClick={connectBrowser}
            />
          </div>
        </>
      )}
    </Dialog>
  );
};
