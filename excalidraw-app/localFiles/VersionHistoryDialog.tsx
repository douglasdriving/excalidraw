import { Dialog } from "@excalidraw/excalidraw/components/Dialog";
import { FilledButton } from "@excalidraw/excalidraw/components/FilledButton";
import Spinner from "@excalidraw/excalidraw/components/Spinner";
import clsx from "clsx";
import { useEffect, useState } from "react";

import { useAtomValue } from "../app-jotai";

import { localFilesApi } from "./api";
import { LocalFiles, localFilesStateAtom } from "./LocalFiles";
import { RETENTION_TIERS } from "./retention";
import { restoreIcon } from "./icons";
import {
  formatBytes,
  formatDateTime,
  formatRelativeTime,
  useNow,
} from "./time";

import type { CanvasVersionEntry } from "./api";

const dayLabel = (timestamp: number) => {
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) {
    return "Today";
  }
  if (date.toDateString() === yesterday.toDateString()) {
    return "Yesterday";
  }
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
};

type Preview =
  | { state: "loading" }
  | { state: "ready"; url: string | undefined }
  | { state: "error"; message: string };

export const VersionHistoryDialog = () => {
  const { currentName, saveCount } = useAtomValue(localFilesStateAtom);
  const [versions, setVersions] = useState<CanvasVersionEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CanvasVersionEntry | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const now = useNow(15000);

  useEffect(() => {
    if (!currentName) {
      return;
    }
    localFilesApi
      .history(currentName)
      .then((list) => {
        setVersions(list);
        setSelected((prev) => prev ?? list[0] ?? null);
      })
      .catch((error) => setLoadError(error.message));
    // refetch when a new autosave lands while the dialog is open
  }, [currentName, saveCount]);

  useEffect(() => {
    if (!selected) {
      return;
    }
    let cancelled = false;
    setPreview({ state: "loading" });
    LocalFiles.loadVersionPreview(selected.id)
      .then((url) => !cancelled && setPreview({ state: "ready", url }))
      .catch(
        (error) =>
          !cancelled && setPreview({ state: "error", message: error.message }),
      );
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const latestId = versions?.[0]?.id;
  const groups: { label: string; items: CanvasVersionEntry[] }[] = [];
  for (const version of versions || []) {
    const label = dayLabel(version.timestamp);
    const group = groups[groups.length - 1];
    if (group?.label === label) {
      group.items.push(version);
    } else {
      groups.push({ label, items: [version] });
    }
  }

  const restore = async () => {
    if (!selected) {
      return;
    }
    setRestoring(true);
    setRestoreError(null);
    try {
      await LocalFiles.restoreVersion(
        selected.id,
        formatDateTime(selected.timestamp),
      );
    } catch (error: any) {
      setRestoreError(error.message);
      setRestoring(false);
    }
  };

  return (
    <Dialog
      size="wide"
      title={`Version history — ${currentName}`}
      className="local-files-dialog"
      onCloseRequest={() => LocalFiles.setDialog(null)}
    >
      {loadError ? (
        <div className="local-files-banner local-files-banner--error">
          Couldn't load history: {loadError}
        </div>
      ) : !versions ? (
        <div className="local-files-empty">
          <Spinner size="24px" />
          Loading versions…
        </div>
      ) : (
        <div className="local-files-history">
          <div className="local-files-history__list" role="listbox">
            {groups.map((group) => (
              <div key={group.label}>
                <div className="local-files-history__day">{group.label}</div>
                {group.items.map((version) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected?.id === version.id}
                    key={version.id}
                    className={clsx("local-files-history__item", {
                      "local-files-history__item--selected":
                        selected?.id === version.id,
                    })}
                    onClick={() => setSelected(version)}
                  >
                    <span>
                      {new Date(version.timestamp).toLocaleTimeString()}
                      {version.id === latestId && (
                        <span className="local-files-tag">Current</span>
                      )}
                    </span>
                    <span className="local-files-muted">
                      {formatRelativeTime(version.timestamp, now)} ·{" "}
                      {formatBytes(version.size)}
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>

          <div className="local-files-history__preview">
            <div className="local-files-history__canvas">
              {!preview || preview.state === "loading" ? (
                <Spinner size="24px" />
              ) : preview.state === "error" ? (
                <span className="local-files-error-text">
                  {preview.message}
                </span>
              ) : preview.url ? (
                <img src={preview.url} alt="Preview of this version" />
              ) : (
                <span className="local-files-muted">Empty canvas</span>
              )}
            </div>
            {selected && (
              <div className="local-files-history__details">
                <div>
                  <strong>{formatDateTime(selected.timestamp)}</strong>
                  <div className="local-files-muted">
                    {selected.id === latestId
                      ? "This is what's on disk right now."
                      : "Restoring replaces the canvas with this version. It's undoable, and the current state stays in history."}
                  </div>
                </div>
                <FilledButton
                  icon={restoreIcon}
                  label={restoring ? "Restoring…" : "Restore this version"}
                  status={restoring ? "loading" : null}
                  disabled={selected.id === latestId || restoring}
                  onClick={restore}
                />
              </div>
            )}
            {restoreError && (
              <div className="local-files-error-text">{restoreError}</div>
            )}
          </div>
        </div>
      )}
      <details className="local-files-history__policy">
        <summary>
          {versions?.length ?? "…"} versions kept · how old versions are thinned
          out
        </summary>
        <ul>
          {RETENTION_TIERS.map((tier) => (
            <li key={tier.label}>{tier.label}</li>
          ))}
        </ul>
      </details>
    </Dialog>
  );
};
