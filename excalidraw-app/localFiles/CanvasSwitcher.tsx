import { KEYS, isWritableElement } from "@excalidraw/common";
import clsx from "clsx";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { localFilesApi } from "./api";
import { LocalFiles } from "./LocalFiles";

import type { CanvasListEntry } from "./api";

/**
 * Order for the switcher: the open canvas first, then the others from most to
 * least recently opened, then any never opened (in the order of `files`).
 */
export const getSwitcherOrder = (
  files: readonly CanvasListEntry[],
  recent: readonly string[],
  currentName: string | null,
): CanvasListEntry[] => {
  const byName = new Map(files.map((file) => [file.name, file]));
  const names = [
    ...recent.filter((name) => byName.has(name)),
    ...files.map((file) => file.name).filter((name) => !recent.includes(name)),
  ];
  const ordered =
    currentName && byName.has(currentName)
      ? [currentName, ...names.filter((name) => name !== currentName)]
      : names;
  return ordered.map((name) => byName.get(name)!);
};

/**
 * Index selected after pressing Tab `steps` times. The first press skips the
 * open canvas, and cycling wraps back around to it.
 */
export const getSwitcherIndex = (
  items: readonly CanvasListEntry[],
  currentName: string | null,
  steps: number,
) => {
  const offset = items[0]?.name === currentName ? 1 : 0;
  return (offset + steps - 1) % items.length;
};

type Session = {
  id: number;
  /** null while the canvas list is loading */
  items: CanvasListEntry[] | null;
  currentName: string | null;
  steps: number;
  /** Shift was let go before the list loaded */
  released: boolean;
};

const canStart = (event: KeyboardEvent) => {
  const { availability, busy, dialog } = LocalFiles.state;
  const target = event.target;
  return (
    availability === "available" &&
    !busy &&
    !dialog &&
    !isWritableElement(target) &&
    !(target instanceof Element && target.closest(".Modal, [role=dialog]"))
  );
};

/**
 * Alt-Tab for canvases: hold Shift and press Tab to cycle through recently
 * opened canvases, let go of Shift to open the selected one. Esc cancels.
 */
export const CanvasSwitcher = ({
  excalidrawAPI,
}: {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
}) => {
  const [session, setSession] = useState<Session | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const apiRef = useRef(excalidrawAPI);
  apiRef.current = excalidrawAPI;
  const selectedRef = useRef<HTMLDivElement>(null);
  const pickRef = useRef<(index: number) => void>(() => {});

  useEffect(() => {
    const update = (next: Session | null) => {
      sessionRef.current = next;
      setSession(next);
    };

    const openSelected = (current: Session, index?: number) => {
      update(null);
      const items = current.items!;
      const name =
        items[
          index ?? getSwitcherIndex(items, current.currentName, current.steps)
        ].name;
      if (name === current.currentName) {
        return;
      }
      LocalFiles.open(name).catch((error: any) =>
        apiRef.current?.setToast({
          message: `Couldn't open “${name}”: ${error.message}`,
          duration: 4000,
        }),
      );
    };

    const start = async () => {
      const currentName = LocalFiles.state.currentName;
      const pending: Session = {
        id: Date.now(),
        items: null,
        currentName,
        steps: 1,
        released: false,
      };
      update(pending);
      let items: CanvasListEntry[];
      try {
        const { files, recent } = await localFilesApi.list();
        items = getSwitcherOrder(files, recent, currentName);
      } catch (error: any) {
        if (sessionRef.current?.id === pending.id) {
          update(null);
          apiRef.current?.setToast({
            message: `Couldn't list canvases: ${error.message}`,
            duration: 3000,
          });
        }
        return;
      }
      const latest = sessionRef.current;
      if (latest?.id !== pending.id) {
        // cancelled while loading
        return;
      }
      if (!items.some((file) => file.name !== currentName)) {
        update(null);
        apiRef.current?.setToast({
          message: "No other canvases to switch to",
          duration: 2000,
        });
        return;
      }
      const loaded = { ...latest, items };
      if (loaded.released) {
        openSelected(loaded);
      } else {
        update(loaded);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const current = sessionRef.current;
      if (
        event.key === KEYS.TAB &&
        event.shiftKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.metaKey
      ) {
        if (!current && !canStart(event)) {
          return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        if (current) {
          update({ ...current, steps: current.steps + 1 });
        } else {
          start();
        }
      } else if (current && event.key === KEYS.ESCAPE) {
        event.preventDefault();
        event.stopImmediatePropagation();
        update(null);
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      const current = sessionRef.current;
      if (event.key !== "Shift" || !current) {
        return;
      }
      if (current.items) {
        openSelected(current);
      } else {
        update({ ...current, released: true });
      }
    };

    const onBlur = () => update(null);

    pickRef.current = (index) => {
      const current = sessionRef.current;
      if (current?.items) {
        openSelected(current, index);
      }
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    window.addEventListener("keyup", onKeyUp, { capture: true });
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      window.removeEventListener("keyup", onKeyUp, { capture: true });
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  const items = session?.items;
  const selected = items
    ? getSwitcherIndex(items, session.currentName, session.steps)
    : -1;

  useLayoutEffect(() => {
    // (optional call: jsdom has no scrollIntoView)
    selectedRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);

  if (!items) {
    return null;
  }

  return (
    <div className="local-files-switcher" role="listbox" aria-label="Canvases">
      {items.map((file, index) => (
        <div
          key={file.name}
          ref={index === selected ? selectedRef : undefined}
          role="option"
          aria-selected={index === selected}
          className={clsx("local-files-switcher__item", {
            "local-files-switcher__item--selected": index === selected,
          })}
          onMouseDown={(event) => {
            event.preventDefault();
            pickRef.current(index);
          }}
        >
          <div className="local-files-switcher__thumb">
            {file.hasThumbnail ? (
              <img
                src={localFilesApi.thumbnailUrl(file.name, file.modified)}
                alt=""
              />
            ) : (
              <span className="local-files-card__no-thumb">No preview</span>
            )}
          </div>
          <div className="local-files-switcher__name" title={file.name}>
            {file.name}
          </div>
          {file.name === session.currentName && (
            <div className="local-files-switcher__meta">Currently open</div>
          )}
        </div>
      ))}
    </div>
  );
};
