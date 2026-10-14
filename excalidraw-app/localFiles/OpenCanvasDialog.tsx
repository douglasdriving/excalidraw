import { Dialog } from "@excalidraw/excalidraw/components/Dialog";
import { FilledButton } from "@excalidraw/excalidraw/components/FilledButton";
import Spinner from "@excalidraw/excalidraw/components/Spinner";
import { TextField } from "@excalidraw/excalidraw/components/TextField";
import clsx from "clsx";
import { useCallback, useEffect, useState } from "react";

import { useAtomValue } from "../app-jotai";

import { localFilesApi } from "./api";
import { LocalFiles, localFilesStateAtom } from "./LocalFiles";
import { nameExists, validateCanvasName } from "./names";
import { filePlusIcon, pencilIcon, trashIcon } from "./icons";
import { formatBytes, formatRelativeTime, useNow } from "./time";

import type { CanvasListEntry } from "./api";

type Listing = { dir: string; files: CanvasListEntry[] };

const CanvasCard = ({
  file,
  isCurrent,
  allNames,
  now,
  onChanged,
  onError,
}: {
  file: CanvasListEntry;
  isCurrent: boolean;
  allNames: string[];
  now: number;
  onChanged: () => void;
  onError: (message: string) => void;
}) => {
  const [mode, setMode] = useState<"idle" | "rename" | "confirmDelete">("idle");
  const [renameValue, setRenameValue] = useState(file.name);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const open = async () => {
    if (mode !== "idle" || pending) {
      return;
    }
    setPending("Opening…");
    try {
      await LocalFiles.open(file.name);
    } catch (error: any) {
      setPending(null);
      onError(`Couldn't open “${file.name}”: ${error.message}`);
    }
  };

  const submitRename = async () => {
    if (renameValue === file.name) {
      return setMode("idle");
    }
    const error =
      validateCanvasName(renameValue) ||
      (nameExists(
        renameValue,
        allNames.filter((n) => n !== file.name),
      )
        ? `“${renameValue}” already exists`
        : null);
    if (error) {
      return setRenameError(error);
    }
    setPending("Renaming…");
    try {
      await LocalFiles.rename(file.name, renameValue);
      onChanged();
    } catch (err: any) {
      setRenameError(err.message);
    } finally {
      setPending(null);
    }
  };

  const remove = async () => {
    setPending("Deleting…");
    try {
      await LocalFiles.remove(file.name);
      onChanged();
    } catch (err: any) {
      setPending(null);
      setMode("idle");
      onError(`Couldn't delete “${file.name}”: ${err.message}`);
    }
  };

  return (
    <div
      className={clsx("local-files-card", {
        "local-files-card--current": isCurrent,
      })}
      role="button"
      tabIndex={0}
      aria-label={`Open ${file.name}`}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.target === event.currentTarget) {
          open();
        }
      }}
    >
      <div className="local-files-card__thumb">
        {file.hasThumbnail ? (
          <img
            src={localFilesApi.thumbnailUrl(file.name, file.modified)}
            alt=""
            loading="lazy"
          />
        ) : (
          <span className="local-files-card__no-thumb">No preview</span>
        )}
        {isCurrent && (
          <span className="local-files-card__badge">Currently open</span>
        )}
        {pending && (
          <div className="local-files-card__overlay">
            <Spinner size="20px" />
            {pending}
          </div>
        )}
      </div>

      <div
        className="local-files-card__body"
        onClick={(event) => mode !== "idle" && event.stopPropagation()}
      >
        {mode === "rename" ? (
          <div className="local-files-card__rename">
            <input
              autoFocus
              value={renameValue}
              aria-label="New name"
              onChange={(event) => {
                setRenameValue(event.target.value);
                setRenameError(null);
              }}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Enter") {
                  submitRename();
                } else if (event.key === "Escape") {
                  setMode("idle");
                }
              }}
            />
            {renameError && (
              <div className="local-files-error-text">{renameError}</div>
            )}
            <div className="local-files-card__row-actions">
              <button type="button" onClick={submitRename}>
                Rename
              </button>
              <button type="button" onClick={() => setMode("idle")}>
                Cancel
              </button>
            </div>
          </div>
        ) : mode === "confirmDelete" ? (
          <div className="local-files-card__confirm">
            <div>
              Delete “{file.name}”?
              <div className="local-files-muted">
                It's moved to the trash folder with its history.
              </div>
            </div>
            <div className="local-files-card__row-actions">
              <button
                type="button"
                className="local-files-danger-button"
                onClick={remove}
              >
                Delete
              </button>
              <button type="button" onClick={() => setMode("idle")}>
                Keep
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="local-files-card__name" title={file.name}>
              {file.name}
            </div>
            <div className="local-files-card__meta">
              Edited {formatRelativeTime(file.modified, now)} ·{" "}
              {formatBytes(file.size)} · {file.versionCount}{" "}
              {file.versionCount === 1 ? "version" : "versions"}
            </div>
            <div className="local-files-card__actions">
              <button
                type="button"
                title="Rename"
                aria-label={`Rename ${file.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  setRenameValue(file.name);
                  setMode("rename");
                }}
              >
                {pencilIcon}
              </button>
              <button
                type="button"
                title="Delete"
                aria-label={`Delete ${file.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  setMode("confirmDelete");
                }}
              >
                {trashIcon}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export const OpenCanvasDialog = () => {
  const { currentName } = useAtomValue(localFilesStateAtom);
  const [listing, setListing] = useState<Listing | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const now = useNow(15000);

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const { dir, files } = await localFilesApi.list();
      setListing({ dir, files });
    } catch (error: any) {
      setLoadError(error.message);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const filtered = listing?.files.filter((file) =>
    file.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <Dialog
      size="wide"
      title="Open a canvas"
      className="local-files-dialog"
      onCloseRequest={() => LocalFiles.setDialog(null)}
    >
      <div className="local-files-open__toolbar">
        <TextField
          type="search"
          placeholder="Search canvases…"
          value={query}
          onChange={setQuery}
          fullWidth
        />
        <FilledButton
          icon={filePlusIcon}
          label="New canvas"
          onClick={async () => {
            try {
              await LocalFiles.newCanvas();
            } catch (error: any) {
              setActionError(error.message);
            }
          }}
        />
      </div>

      {listing && (
        <div className="local-files-muted local-files-open__dir">
          {listing.files.length}{" "}
          {listing.files.length === 1 ? "canvas" : "canvases"} in{" "}
          <code>{listing.dir}</code>
        </div>
      )}

      {actionError && (
        <div className="local-files-banner local-files-banner--error">
          {actionError}
          <button type="button" onClick={() => setActionError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {loadError ? (
        <div className="local-files-banner local-files-banner--error">
          Couldn't list canvases: {loadError}
          <button type="button" onClick={refresh}>
            Retry
          </button>
        </div>
      ) : !listing ? (
        <div className="local-files-empty">
          <Spinner size="24px" />
          Loading canvases…
        </div>
      ) : !filtered?.length ? (
        <div className="local-files-empty">
          {listing.files.length
            ? `No canvas matches “${query}”`
            : "No saved canvases yet. Anything you draw is saved here automatically."}
        </div>
      ) : (
        <div className="local-files-grid">
          {filtered.map((file) => (
            <CanvasCard
              key={file.name}
              file={file}
              isCurrent={file.name === currentName}
              allNames={listing.files.map((f) => f.name)}
              now={now}
              onChanged={refresh}
              onError={setActionError}
            />
          ))}
        </div>
      )}
    </Dialog>
  );
};
