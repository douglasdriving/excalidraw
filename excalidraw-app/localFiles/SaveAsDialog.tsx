import { Dialog } from "@excalidraw/excalidraw/components/Dialog";
import { FilledButton } from "@excalidraw/excalidraw/components/FilledButton";
import { TextField } from "@excalidraw/excalidraw/components/TextField";
import { useEffect, useRef, useState } from "react";

import { useAtomValue } from "../app-jotai";

import { localFilesApi } from "./api";
import { LocalFiles, localFilesStateAtom } from "./LocalFiles";
import {
  UNTITLED_NAME,
  nameExists,
  nextFreeName,
  validateCanvasName,
} from "./names";

export const SaveAsDialog = () => {
  const { currentName, dir } = useAtomValue(localFilesStateAtom);
  const [existing, setExisting] = useState<string[] | null>(null);
  const [value, setValue] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    localFilesApi
      .list()
      .then(({ files }) => {
        const names = files.map((f) => f.name);
        setExisting(names);
        setValue(
          currentName
            ? nextFreeName(currentName, names)
            : nextFreeName(UNTITLED_NAME, names, { allowBase: true }),
        );
        requestAnimationFrame(() => inputRef.current?.select());
      })
      .catch((error) => {
        setExisting([]);
        setSubmitError(error.message);
      });
  }, [currentName]);

  const validation =
    validateCanvasName(value) ||
    (existing && nameExists(value, existing)
      ? `A canvas named “${value}” already exists`
      : null);

  const close = () => LocalFiles.setDialog(null);

  const submit = async () => {
    if (validation || pending) {
      return;
    }
    setPending(true);
    setSubmitError(null);
    try {
      await LocalFiles.saveAs(value);
    } catch (error: any) {
      setSubmitError(error.message);
      setPending(false);
    }
  };

  return (
    <Dialog
      size="small"
      title={currentName ? "Save a copy as…" : "Name this canvas"}
      className="local-files-dialog"
      onCloseRequest={close}
    >
      <p className="local-files-muted">
        {currentName ? (
          <>
            Saves a duplicate of “{currentName}” as a new file and switches to
            it. The original stays as it is.
          </>
        ) : (
          <>Saves this canvas as a new file. From then on it's autosaved.</>
        )}
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <TextField
          ref={inputRef}
          label="File name"
          value={value}
          onChange={(next) => {
            setValue(next);
            setSubmitError(null);
          }}
          onKeyDown={(event) => event.stopPropagation()}
          fullWidth
        />
        <div className="local-files-muted local-files-saveas__path">
          {dir ? `${dir}/` : ""}
          <strong>{value || "…"}.excalidraw</strong>
        </div>
        {existing && value && validation && (
          <div className="local-files-error-text">{validation}</div>
        )}
        {submitError && (
          <div className="local-files-error-text">{submitError}</div>
        )}
        <div className="local-files-dialog__actions">
          <FilledButton
            variant="outlined"
            color="muted"
            label="Cancel"
            onClick={close}
          />
          <FilledButton
            label={pending ? "Saving…" : "Save"}
            status={pending ? "loading" : null}
            disabled={!existing || !!validation}
            onClick={submit}
          />
        </div>
      </form>
    </Dialog>
  );
};
