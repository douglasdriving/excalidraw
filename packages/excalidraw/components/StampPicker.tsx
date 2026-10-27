import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";

import { KEYS } from "@excalidraw/common";

import { t } from "../i18n";
import { loadStampEmojis, searchStampEmojis } from "../stamp";

import { Dialog } from "./Dialog";
import { TextField } from "./TextField";
import { searchIcon } from "./icons";

import "./StampPicker.scss";

import type { StampEmoji } from "../stamp";

/** must match `grid-template-columns` in StampPicker.scss */
const COLUMNS = 10;

export const StampPicker = ({
  currentEmoji,
  onPick,
  onClose,
}: {
  currentEmoji: string;
  onPick: (emoji: string) => void;
  onClose: () => void;
}) => {
  const [emojis, setEmojis] = useState<readonly StampEmoji[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    loadStampEmojis().then(
      (loaded) => !cancelled && setEmojis(loaded),
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const results = useMemo(
    () => (emojis ? searchStampEmojis(emojis, query) : []),
    [emojis, query],
  );

  useEffect(() => {
    // with no query, start on the current stamp so Enter keeps it
    const currentIndex = query
      ? -1
      : results.findIndex(({ emoji }) => emoji === currentEmoji);
    setActiveIndex(Math.max(0, currentIndex));
  }, [results, query, currentEmoji]);

  useEffect(() => {
    listRef.current
      ?.querySelector(".StampPicker__emoji--active")
      ?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, results]);

  const activeEmoji: StampEmoji | undefined = results[activeIndex];

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const step =
      event.key === KEYS.ARROW_RIGHT
        ? 1
        : event.key === KEYS.ARROW_LEFT
        ? -1
        : event.key === KEYS.ARROW_DOWN
        ? COLUMNS
        : event.key === KEYS.ARROW_UP
        ? -COLUMNS
        : 0;

    if (step) {
      event.preventDefault();
      setActiveIndex((index) =>
        Math.min(Math.max(index + step, 0), results.length - 1),
      );
    } else if (event.key === KEYS.ENTER && activeEmoji) {
      event.preventDefault();
      onPick(activeEmoji.emoji);
    }
  };

  return (
    <Dialog
      onCloseRequest={onClose}
      closeOnClickOutside
      title={false}
      size={520}
      autofocus
      className="StampPicker"
    >
      <TextField
        value={query}
        placeholder={t("stampPicker.placeholder")}
        icon={searchIcon}
        onChange={setQuery}
        onKeyDown={onKeyDown}
        selectOnRender
        fullWidth
      />
      <div className="StampPicker__grid" ref={listRef} role="listbox">
        {results.map((item, index) => (
          <button
            key={item.emoji}
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            className={clsx("StampPicker__emoji", {
              "StampPicker__emoji--active": index === activeIndex,
            })}
            title={item.label}
            aria-label={item.label}
            tabIndex={-1}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => onPick(item.emoji)}
          >
            {item.emoji}
          </button>
        ))}
      </div>
      <div className="StampPicker__status">
        {failed
          ? t("stampPicker.loadError")
          : !emojis
          ? t("stampPicker.loading")
          : activeEmoji
          ? `${activeEmoji.emoji}  ${activeEmoji.label}`
          : t("stampPicker.noMatch")}
      </div>
    </Dialog>
  );
};
