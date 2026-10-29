import React from "react";

import { KEYS } from "@excalidraw/common";
import { isTextElement } from "@excalidraw/element";

import type { ExcalidrawTextElement } from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import {
  DEFAULT_STAMP_EMOJI,
  DEFAULT_STAMP_SIZE,
  STAMP_SIZES,
  loadStampEmojis,
  searchStampEmojis,
} from "../stamp";

import { API } from "./helpers/api";
import { Keyboard, Pointer, UI } from "./helpers/ui";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  withExcalidrawDimensions,
} from "./test-utils";

const { h } = window;

const mouse = new Pointer("mouse");

const stamps = () =>
  h.elements.filter(
    (el): el is ExcalidrawTextElement => isTextElement(el) && !el.isDeleted,
  );

const searchInput = () =>
  document.querySelector(".StampPanel .ExcTextField input") as HTMLInputElement;

describe("emoji search", () => {
  it("finds emoji by label and tag prefixes, label matches first", async () => {
    const emojis = await loadStampEmojis();

    expect(emojis.length).toBeGreaterThan(1000);
    // skin tone components aren't stampable
    expect(emojis.find(({ emoji }) => emoji === "🏻")).toBeUndefined();

    const apples = searchStampEmojis(emojis, "red app");
    expect(apples[0].emoji).toBe("🍎");

    // "fruit" is only a tag of 🍎, so it's matched but after label matches
    const fruit = searchStampEmojis(emojis, "fruit").map(({ emoji }) => emoji);
    expect(fruit).toContain("🍎");

    const hearts = searchStampEmojis(emojis, "heart");
    expect(hearts.length).toBeGreaterThan(5);
    expect(
      hearts.findIndex(({ label }) => !label.toLowerCase().includes("heart")),
    ).not.toBeLessThan(
      hearts.findIndex(({ label }) => label.toLowerCase().includes("heart")),
    );

    expect(searchStampEmojis(emojis, "zzqqxx")).toEqual([]);
    expect(searchStampEmojis(emojis, "  ")).toBe(emojis);
  });
});

describe("stamp tool", () => {
  beforeEach(async () => {
    await render(<Excalidraw handleKeyboardGlobally={true} />);
    mouse.reset();
  });

  it("is selected with M", () => {
    Keyboard.keyPress(KEYS.M);
    expect(h.state.activeTool.type).toBe("stamp");
  });

  it("stamps the current emoji centered on each click and stays active", () => {
    UI.clickTool("stamp");
    expect(h.state.currentStampEmoji).toBe(DEFAULT_STAMP_EMOJI);

    mouse.clickAt(100, 100);
    mouse.clickAt(300, 200);

    const [first, second] = stamps();
    expect(stamps()).toHaveLength(2);
    expect(first.text).toBe(DEFAULT_STAMP_EMOJI);
    expect(first.fontSize).toBe(DEFAULT_STAMP_SIZE);
    expect(first.x + first.width / 2).toBeCloseTo(100);
    expect(first.y + first.height / 2).toBeCloseTo(100);
    expect(second.x + second.width / 2).toBeCloseTo(300);
    expect(h.state.activeTool.type).toBe("stamp");
    expect(h.state.selectedElementIds).toEqual({});
  });

  it("scales the stamp so it has the same on-screen size at any zoom", () => {
    API.setAppState({ zoom: { value: 2 as any } });
    UI.clickTool("stamp");
    mouse.clickAt(100, 100);
    expect(stamps()[0].fontSize).toBe(DEFAULT_STAMP_SIZE / 2);
  });

  it("each stamp is one undo step", () => {
    UI.clickTool("stamp");
    mouse.clickAt(100, 100);
    mouse.clickAt(200, 100);
    expect(stamps()).toHaveLength(2);

    Keyboard.undo();
    expect(stamps()).toHaveLength(1);
  });

  it("shows the stamp panel; searching and Enter picks the emoji", async () => {
    await withExcalidrawDimensions({ width: 1000, height: 1000 }, async () => {
      UI.clickTool("stamp");

      await waitFor(() => expect(searchInput()).not.toBeNull());
      fireEvent.change(searchInput(), { target: { value: "red apple" } });
      await waitFor(() =>
        expect(
          document.querySelector(".StampPanel__emoji--active")?.textContent,
        ).toBe("🍎"),
      );
      fireEvent.keyDown(searchInput(), { key: KEYS.ENTER });

      expect(h.state.currentStampEmoji).toBe("🍎");
      expect(h.state.activeTool.type).toBe("stamp");

      mouse.clickAt(200, 200);
      expect(stamps().map((el) => el.text)).toEqual(["🍎"]);
    });
  });

  it("clicking an emoji in the panel picks it", async () => {
    UI.clickTool("stamp");

    fireEvent.change(await waitFor(() => searchInput()), {
      target: { value: "rocket" },
    });
    const rocket = await screen.findByRole("option", { name: "rocket" });
    fireEvent.click(rocket);

    expect(h.state.currentStampEmoji).toBe("🚀");
    expect(h.state.activeTool.type).toBe("stamp");
  });

  it("the panel's size buttons set the stamp size", async () => {
    UI.clickTool("stamp");
    fireEvent.click(await screen.findByTestId("stampSize-large"));
    expect(h.state.currentStampSize).toBe(STAMP_SIZES.lg);

    mouse.clickAt(100, 100);
    expect(stamps()[0].fontSize).toBe(STAMP_SIZES.lg);
  });

  it("arrow keys move the highlighted emoji", async () => {
    UI.clickTool("stamp");
    await waitFor(() =>
      expect(
        document.querySelector(".StampPanel__emoji--active")?.textContent,
      ).toBe(DEFAULT_STAMP_EMOJI),
    );

    const options = () => [...document.querySelectorAll(".StampPanel__emoji")];
    const activeIndex = () =>
      options().findIndex((el) =>
        el.classList.contains("StampPanel__emoji--active"),
      );
    const start = activeIndex();

    fireEvent.keyDown(searchInput(), { key: KEYS.ARROW_RIGHT });
    expect(activeIndex()).toBe(start + 1);
    fireEvent.keyDown(searchInput(), { key: KEYS.ARROW_DOWN });
    expect(activeIndex()).toBe(start + 8);
    fireEvent.keyDown(searchInput(), { key: KEYS.ARROW_UP });
    fireEvent.keyDown(searchInput(), { key: KEYS.ARROW_LEFT });
    expect(activeIndex()).toBe(start);
  });
});
