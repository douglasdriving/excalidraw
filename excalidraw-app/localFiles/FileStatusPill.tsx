import Spinner from "@excalidraw/excalidraw/components/Spinner";
import clsx from "clsx";
import { useEffect, useRef, useState } from "react";

import { useAtomValue } from "../app-jotai";

import { LocalFiles, localFilesStateAtom } from "./LocalFiles";
import { UNTITLED_NAME, validateCanvasName } from "./names";
import { alertIcon, checkIcon, folderOpenIcon, historyIcon } from "./icons";
import { formatRelativeTime, useNow } from "./time";

import type { LocalFilesState } from "./LocalFiles";

type Tone = "neutral" | "pending" | "busy" | "ok" | "error";

const describe = (
  state: LocalFilesState,
  now: number,
): { tone: Tone; text: string; title: string } => {
  if (state.busy) {
    return { tone: "busy", text: state.busy, title: state.busy };
  }
  if (state.availability === "checking") {
    return {
      tone: "busy",
      text: "Connecting to file storage…",
      title: "Looking for the local file server",
    };
  }
  if (state.availability === "unavailable") {
    return {
      tone: "error",
      text: "File storage offline",
      title: `${state.unavailableReason}\nChanges are only kept in this browser's storage until it reconnects.`,
    };
  }
  switch (state.status) {
    case "empty":
      return {
        tone: "neutral",
        text: "Not saved yet",
        title: "Start drawing and this canvas is saved automatically",
      };
    case "dirty":
      return {
        tone: "pending",
        text: "Unsaved changes",
        title: "Saving automatically in a moment",
      };
    case "saving":
      return { tone: "busy", text: "Saving…", title: "Writing to disk" };
    case "error":
      return {
        tone: "error",
        text: `Save failed${
          state.retryAt
            ? ` · retrying in ${Math.max(
                0,
                Math.ceil((state.retryAt - now) / 1000),
              )}s`
            : ""
        }`,
        title: state.error || "Save failed",
      };
    case "saved":
      return {
        tone: "ok",
        text: state.lastSavedAt
          ? `Saved ${formatRelativeTime(state.lastSavedAt, now)}`
          : "Saved",
        title: state.dir
          ? `Saved to ${state.dir}/${state.currentName}.excalidraw`
          : "Saved",
      };
  }
};

const RenameField = ({
  name,
  onDone,
}: {
  name: string;
  onDone: () => void;
}) => {
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!pending) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [pending]);

  const submit = async () => {
    if (pending) {
      return;
    }
    if (value === name) {
      return onDone();
    }
    const validation = validateCanvasName(value);
    if (validation) {
      return setError(validation);
    }
    setPending(true);
    try {
      await LocalFiles.rename(name, value);
      onDone();
    } catch (err: any) {
      setError(err.message);
      setPending(false);
    }
  };

  return (
    <span className="local-files-pill__rename">
      <input
        ref={inputRef}
        value={value}
        readOnly={pending}
        aria-label="Canvas name"
        onChange={(event) => {
          setValue(event.target.value);
          setError(null);
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") {
            submit();
          } else if (event.key === "Escape") {
            onDone();
          }
        }}
        onBlur={() => (error ? onDone() : submit())}
      />
      {error && <span className="local-files-pill__rename-error">{error}</span>}
    </span>
  );
};

export const FileStatusPill = () => {
  const state = useAtomValue(localFilesStateAtom);
  const now = useNow(state.status === "error" ? 1000 : 5000);
  const [renaming, setRenaming] = useState(false);
  const { tone, text, title } = describe(state, now);
  const active = state.availability === "available" && !state.busy;

  const statusIcon =
    tone === "busy" ? (
      <Spinner size="14px" />
    ) : tone === "ok" ? (
      checkIcon
    ) : tone === "error" ? (
      alertIcon
    ) : (
      <span className="local-files-pill__dot" />
    );

  return (
    <div
      className={clsx("local-files-pill", `local-files-pill--${tone}`)}
      data-testid="local-files-status"
    >
      <span className="local-files-pill__status" title={title}>
        <span className="local-files-pill__status-icon">{statusIcon}</span>
        {renaming && state.currentName ? (
          <RenameField
            name={state.currentName}
            onDone={() => setRenaming(false)}
          />
        ) : (
          <button
            type="button"
            className="local-files-pill__name"
            disabled={!active}
            title={
              state.currentName
                ? "Click to rename"
                : "Click to choose a name for this canvas"
            }
            onClick={() =>
              state.currentName
                ? setRenaming(true)
                : LocalFiles.setDialog("saveAs")
            }
          >
            {state.currentName ?? UNTITLED_NAME}
          </button>
        )}
        <span className="local-files-pill__text">{text}</span>
      </span>

      {tone === "error" && (
        <div className="local-files-pill__error-detail">
          {state.availability === "unavailable"
            ? `${state.unavailableReason} Your drawing is only kept in this browser until it reconnects.`
            : `${state.error} Your changes are still on the canvas and will be saved once this works again.`}
        </div>
      )}

      {state.availability === "unavailable" ? (
        <button
          type="button"
          className="local-files-pill__action local-files-pill__action--text"
          onClick={() => LocalFiles.reconnect()}
        >
          Retry
        </button>
      ) : (
        <>
          {state.status === "error" && (
            <button
              type="button"
              className="local-files-pill__action local-files-pill__action--text"
              onClick={() => LocalFiles.save()}
            >
              Retry now
            </button>
          )}
          <button
            type="button"
            className="local-files-pill__action"
            title="Version history"
            aria-label="Version history"
            disabled={!active || !state.currentName}
            onClick={() => LocalFiles.setDialog("history")}
          >
            {historyIcon}
          </button>
          <button
            type="button"
            className="local-files-pill__action"
            title="Open a canvas (Ctrl+O)"
            aria-label="Open a canvas"
            disabled={!active}
            onClick={() => LocalFiles.setDialog("open")}
          >
            {folderOpenIcon}
          </button>
        </>
      )}
    </div>
  );
};
