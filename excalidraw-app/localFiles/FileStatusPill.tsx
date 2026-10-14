import { useAtomValue } from "../app-jotai";

import { LocalFiles, localFilesStateAtom } from "./LocalFiles";
import { UNTITLED_NAME } from "./names";
import { alertIcon } from "./icons";
import { useNow } from "./time";

/**
 * Top-right indicator, shown only when something is wrong (a save failed, or
 * the local file server can't be reached). Successful saves are signalled by
 * the save popup instead.
 */
export const FileStatusPill = () => {
  const state = useAtomValue(localFilesStateAtom);
  const unavailable = state.availability === "unavailable";
  const saveFailed =
    state.availability === "available" && state.status === "error";
  const now = useNow(1000);

  if (!unavailable && !saveFailed) {
    return null;
  }

  const text = unavailable
    ? "File storage offline"
    : `Save failed${
        state.retryAt
          ? ` · retrying in ${Math.max(
              0,
              Math.ceil((state.retryAt - now) / 1000),
            )}s`
          : ""
      }`;

  return (
    <div className="local-files-pill" data-testid="local-files-status">
      <span className="local-files-pill__icon">{alertIcon}</span>
      <span className="local-files-pill__name">
        {state.currentName ?? UNTITLED_NAME}
      </span>
      <span className="local-files-pill__text">{text}</span>
      <button
        type="button"
        className="local-files-pill__retry"
        onClick={() =>
          unavailable ? LocalFiles.reconnect() : LocalFiles.save()
        }
      >
        {unavailable ? "Retry" : "Retry now"}
      </button>
      <div className="local-files-pill__error-detail">
        {unavailable
          ? `${state.unavailableReason} Your drawing is only kept in this browser until it reconnects.`
          : `${state.error} Your changes are still on the canvas and will be saved once this works again.`}
      </div>
    </div>
  );
};
