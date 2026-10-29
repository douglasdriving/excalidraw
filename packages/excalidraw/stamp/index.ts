import { newTextElement } from "@excalidraw/element";

import type { ExcalidrawTextElement } from "@excalidraw/element/types";

import type { AppState } from "../types";

export const DEFAULT_STAMP_EMOJI = "⭐";

/** font sizes of a stamp, in screen pixels at the time it's stamped */
export const STAMP_SIZES = { sm: 32, md: 64, lg: 128, xl: 256 } as const;
export const DEFAULT_STAMP_SIZE = STAMP_SIZES.md;

export type StampEmoji = {
  emoji: string;
  label: string;
  /** lowercased label + tags, for matching search terms against */
  words: readonly string[];
};

// the subset of emojibase's CompactEmoji we use (its `emojibase` types package
// isn't installed)
type EmojibaseEntry = {
  unicode: string;
  label: string;
  group?: number;
  order?: number;
  tags?: string[];
};

// emojibase's "component" group (skin tones, hair styles) isn't stampable
const COMPONENT_GROUP = 2;

let emojisPromise: Promise<readonly StampEmoji[]> | null = null;

/**
 * Lazily loads the emoji list (~500 KB of JSON), so it stays out of the main
 * bundle until the stamp picker is first opened.
 */
export const loadStampEmojis = (): Promise<readonly StampEmoji[]> => {
  if (!emojisPromise) {
    emojisPromise = import("emojibase-data/en/compact.json")
      .then(({ default: data }) =>
        (data as EmojibaseEntry[])
          .filter(
            (entry) =>
              entry.group !== undefined && entry.group !== COMPONENT_GROUP,
          )
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
          .map((entry) => ({
            emoji: entry.unicode,
            label: entry.label,
            words: [
              ...entry.label.toLowerCase().split(/[\s:,]+/),
              ...(entry.tags ?? []).map((tag) => tag.toLowerCase()),
            ].filter(Boolean),
          })),
      )
      .catch((error) => {
        emojisPromise = null;
        throw error;
      });
  }
  return emojisPromise;
};

/**
 * Every search term must be the start of one of the emoji's words (label or
 * tags). Emojis whose label matches come first, in emoji order.
 */
export const searchStampEmojis = (
  emojis: readonly StampEmoji[],
  query: string,
): readonly StampEmoji[] => {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) {
    return emojis;
  }

  const ranked: { emoji: StampEmoji; rank: number }[] = [];
  for (const emoji of emojis) {
    if (!terms.every((term) => emoji.words.some((w) => w.startsWith(term)))) {
      continue;
    }
    const label = emoji.label.toLowerCase();
    const rank =
      label === query.trim().toLowerCase()
        ? 0
        : terms.every((term) =>
            label.split(/[\s:,]+/).some((w) => w.startsWith(term)),
          )
        ? 1
        : 2;
    ranked.push({ emoji, rank });
  }

  // Array.prototype.sort is stable, so emoji order is kept within a rank
  return ranked.sort((a, b) => a.rank - b.rank).map(({ emoji }) => emoji);
};

/** A text element showing `emoji`, centered on the given scene point. */
export const newStampElement = ({
  emoji,
  sceneX,
  sceneY,
  appState,
  frameId,
}: {
  emoji: string;
  sceneX: number;
  sceneY: number;
  appState: AppState;
  frameId: ExcalidrawTextElement["frameId"];
}) =>
  newTextElement({
    text: emoji,
    x: sceneX,
    y: sceneY,
    fontSize: Math.round(appState.currentStampSize / appState.zoom.value),
    fontFamily: appState.currentItemFontFamily,
    textAlign: "center",
    verticalAlign: "middle",
    strokeColor: appState.currentItemStrokeColor,
    opacity: appState.currentItemOpacity,
    locked: false,
    frameId,
  });
