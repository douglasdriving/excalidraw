import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";

import { KEYS } from "@excalidraw/common";

import { t } from "../i18n";
import { loadStampEmojis, searchStampEmojis, STAMP_SIZES } from "../stamp";

import { RadioSelection } from "./RadioSelection";
import { TextField } from "./TextField";
import { searchIcon } from "./icons";

import "./StampPanel.scss";

import type { StampEmoji } from "../stamp";

/** must match `grid-template-columns` in StampPanel.scss */
const COLUMNS = 7;

/** stamp size buttons show the current emoji at these font sizes (px) */
const SIZE_ICON_FONT_SIZES = {
  [STAMP_SIZES.sm]: 10,
  [STAMP_SIZES.md]: 14,
  [STAMP_SIZES.lg]: 18,
  [STAMP_SIZES.xl]: 22,
};

/**
 * Left-hand panel shown while the stamp tool is active: stamp size, and a
 * searchable emoji grid to pick the stamp from.
 */
export const StampPanel = ({
  currentEmoji,
  currentSize,
  onPickEmoji,
  onChangeSize,
}: {
  currentEmoji: string;
  currentSize: number;
  /** `viaKeyboard` when picked with Enter from the search field */
  onPickEmoji: (emoji: string, viaKeyboard: boolean) => void;
  onChangeSize: (size: number) => void;
}) => {
  const [emojis, setEmojis] = useState<readonly StampEmoji[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
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
      ? 0
      : results.findIndex(({ emoji }) => emoji === currentEmoji);
    setActiveIndex(currentIndex);
  }, [results, query, currentEmoji]);

  useEffect(() => {
    listRef.current
      ?.querySelector(".StampPanel__emoji--active")
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
      onPickEmoji(activeEmoji.emoji, true);
    } else if (event.key === KEYS.ESCAPE) {
      event.preventDefault();
      setQuery("");
      event.currentTarget.blur();
    }
  };

  return (
    <div className="StampPanel">
      <fieldset>
        <legend>{t("stampPanel.size")}</legend>
        <div className="buttonList">
          <RadioSelection
            group="stamp-size"
            options={(
              [
                [STAMP_SIZES.sm, t("labels.small"), "stampSize-small"],
                [STAMP_SIZES.md, t("labels.medium"), "stampSize-medium"],
                [STAMP_SIZES.lg, t("labels.large"), "stampSize-large"],
                [STAMP_SIZES.xl, t("labels.veryLarge"), "stampSize-veryLarge"],
              ] as const
            ).map(([value, text, testId]) => ({
              value,
              text,
              testId,
              icon: (
                <span
                  className="StampPanel__sizeIcon"
                  style={{ fontSize: SIZE_ICON_FONT_SIZES[value] }}
                >
                  {currentEmoji}
                </span>
              ),
            }))}
            value={currentSize}
            onChange={onChangeSize}
          />
        </div>
      </fieldset>
      <fieldset>
        <legend>{t("stampPanel.emoji")}</legend>
        <TextField
          value={query}
          placeholder={t("stampPanel.placeholder")}
          icon={searchIcon}
          onChange={setQuery}
          onKeyDown={onKeyDown}
          fullWidth
        />
        <div className="StampPanel__grid" ref={listRef} role="listbox">
          {results.map((item, index) => (
            <button
              key={item.emoji}
              type="button"
              role="option"
              aria-selected={item.emoji === currentEmoji}
              className={clsx("StampPanel__emoji", {
                "StampPanel__emoji--active": index === activeIndex,
                "StampPanel__emoji--current": item.emoji === currentEmoji,
              })}
              title={item.label}
              aria-label={item.label}
              tabIndex={-1}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => onPickEmoji(item.emoji, false)}
            >
              {item.emoji}
            </button>
          ))}
        </div>
        <div className="StampPanel__status">
          {failed
            ? t("stampPanel.loadError")
            : !emojis
            ? t("stampPanel.loading")
            : activeEmoji
            ? activeEmoji.label
            : results.length
            ? ""
            : t("stampPanel.noMatch")}
        </div>
      </fieldset>
    </div>
  );
};
