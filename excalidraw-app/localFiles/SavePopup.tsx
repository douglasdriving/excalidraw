import { useEffect, useRef, useState } from "react";

import { useAtomValue } from "../app-jotai";

import { localFilesStateAtom } from "./LocalFiles";
import { floppyIcon } from "./icons";

const VISIBLE_MS = 1600;

/** Pops up a save icon every time a save actually writes to disk. */
export const SavePopup = () => {
  const { saveCount, lastSaveKind, currentName } =
    useAtomValue(localFilesStateAtom);
  const [shown, setShown] = useState<{ key: number; label: string } | null>(
    null,
  );
  const seenCount = useRef(saveCount);

  useEffect(() => {
    if (saveCount === seenCount.current) {
      return;
    }
    seenCount.current = saveCount;
    const label =
      lastSaveKind === "created"
        ? `Created “${currentName}.excalidraw”`
        : lastSaveKind === "savedAs"
        ? `Saved as “${currentName}.excalidraw”`
        : "Autosaved";
    setShown({ key: saveCount, label });
  }, [saveCount, lastSaveKind, currentName]);

  useEffect(() => {
    if (!shown) {
      return;
    }
    const timer = window.setTimeout(() => setShown(null), VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [shown]);

  if (!shown) {
    return null;
  }
  return (
    <div
      key={shown.key}
      className="local-files-save-popup"
      role="status"
      aria-live="polite"
    >
      <span className="local-files-save-popup__icon">{floppyIcon}</span>
      {shown.label}
    </div>
  );
};
