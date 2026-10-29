import React from "react";

import { BOUND_TEXT_PADDING, CODES, KEYS } from "@excalidraw/common";

import { getCommonBounds } from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawTextContainer,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Keyboard, Pointer, UI } from "./helpers/ui";
import { getTextEditor } from "./queries/dom";
import { fireEvent, render } from "./test-utils";

const { h } = window;

describe("fork shortcuts", () => {
  beforeEach(async () => {
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  it("X deletes the selection", () => {
    const rect = API.createElement({ type: "rectangle" });
    API.setElements([rect]);
    API.setSelectedElements([rect]);

    Keyboard.keyPress(KEYS.X);

    expect(API.getElement(rect).isDeleted).toBe(true);
    expect(h.state.activeTool.type).toBe("selection");
  });

  it("Alt+Up/Down moves one layer, Alt+Shift+Up/Down to front/back", () => {
    const a = API.createElement({ type: "rectangle" });
    const b = API.createElement({ type: "rectangle" });
    const c = API.createElement({ type: "rectangle" });
    API.setElements([a, b, c]);
    const order = () => h.elements.map((el) => el.id);

    API.setSelectedElements([a]);
    Keyboard.withModifierKeys({ alt: true }, () => {
      Keyboard.keyPress(KEYS.ARROW_UP);
    });
    expect(order()).toEqual([b.id, a.id, c.id]);

    Keyboard.withModifierKeys({ alt: true }, () => {
      Keyboard.keyPress(KEYS.ARROW_DOWN);
    });
    expect(order()).toEqual([a.id, b.id, c.id]);

    Keyboard.withModifierKeys({ alt: true, shift: true }, () => {
      Keyboard.keyPress(KEYS.ARROW_UP);
    });
    expect(order()).toEqual([b.id, c.id, a.id]);

    Keyboard.withModifierKeys({ alt: true, shift: true }, () => {
      Keyboard.keyPress(KEYS.ARROW_DOWN);
    });
    expect(order()).toEqual([a.id, b.id, c.id]);
  });

  it("Alt+F fits the container tightly around its text, keeping its center", () => {
    const [container, text] = API.createTextContainer({
      label: { text: "hello world" },
    });
    API.setElements([container, text]);
    h.app.scene.mutateElement(container, {
      x: 0,
      y: 0,
      width: 400,
      height: 300,
    });
    API.setSelectedElements([container]);

    Keyboard.withModifierKeys({ alt: true }, () => {
      Keyboard.codePress(CODES.F);
    });

    const fitted = API.getElement(container);
    const label = API.getElement(text) as ExcalidrawTextElement;
    expect(fitted.width).toBe(Math.ceil(label.width) + BOUND_TEXT_PADDING * 2);
    expect(fitted.height).toBe(
      Math.ceil(label.height) + BOUND_TEXT_PADDING * 2,
    );
    expect(fitted.x + fitted.width / 2).toBeCloseTo(200);
    expect(fitted.y + fitted.height / 2).toBeCloseTo(150);
    expect(label.text.split("\n").join(" ")).toBe("hello world");
  });

  // measureText is mocked: width = character count, height = 20px per line
  const fitLabel = (labelText: string) => {
    const [container, text] = API.createTextContainer({
      label: { text: labelText },
    });
    API.setElements([container, text]);
    h.app.scene.mutateElement(container, { width: 1000, height: 30 });
    API.setSelectedElements([container]);
    Keyboard.withModifierKeys({ alt: true }, () => {
      Keyboard.codePress(CODES.F);
    });
    return {
      fitted: API.getElement(container),
      label: API.getElement(text) as ExcalidrawTextElement,
    };
  };

  it("Alt+F rewraps long text so the container is roughly 16:9", () => {
    const words = Array.from({ length: 60 }, () => "word");
    const { fitted, label } = fitLabel(words.join(" "));

    expect(fitted.width / fitted.height).toBeGreaterThan(1.4);
    expect(fitted.width / fitted.height).toBeLessThan(2.2);
    // wrapped on word boundaries only
    expect(label.text.split("\n").join(" ")).toBe(words.join(" "));
  });

  it("Alt+F never wraps narrower than the longest word", () => {
    const longWord = "a".repeat(200);
    const { fitted, label } = fitLabel(`hi ${longWord} yo`);

    expect(label.text.split("\n")).toContain(longWord);
    expect(fitted.width).toBeGreaterThanOrEqual(
      longWord.length + BOUND_TEXT_PADDING * 2,
    );
  });

  it("W selects the lasso tool", () => {
    Keyboard.keyPress(KEYS.W);
    expect(h.state.activeTool.type).toBe("lasso");
  });

  it("Alt+A arranges the selection into an evenly spaced cluster without overlaps", () => {
    // a pile of overlapping shapes
    const shapes = Array.from({ length: 6 }, (_, i) =>
      API.createElement({
        type: "rectangle",
        x: i * 10,
        y: i * 5,
        width: 100 + i * 20,
        height: 60,
      }),
    );
    API.setElements(shapes);
    API.setSelectedElements(shapes);
    const [minX, minY, maxX, maxY] = getCommonBounds(shapes);

    Keyboard.withModifierKeys({ alt: true }, () => {
      Keyboard.codePress(CODES.A);
    });

    const arranged = shapes.map((shape) => API.getElement(shape));
    const overlaps = (a: ExcalidrawElement, b: ExcalidrawElement) =>
      a.x < b.x + b.width &&
      b.x < a.x + a.width &&
      a.y < b.y + b.height &&
      b.y < a.y + a.height;
    for (const a of arranged) {
      for (const b of arranged) {
        if (a !== b) {
          expect(overlaps(a, b)).toBe(false);
        }
      }
    }
    // centered where the selection was
    const [nextMinX, nextMinY, nextMaxX, nextMaxY] = getCommonBounds(arranged);
    expect((nextMinX + nextMaxX) / 2).toBeCloseTo((minX + maxX) / 2);
    expect((nextMinY + nextMaxY) / 2).toBeCloseTo((minY + maxY) / 2);
    // more than one row, so it's a cluster rather than a line
    expect(new Set(arranged.map((el) => el.y)).size).toBeGreaterThan(1);
  });

  it("typing in a shape keeps it fitted to the text", async () => {
    const [container, text] = API.createTextContainer({
      label: { text: "hi" },
    });
    API.setElements([container, text]);
    h.app.scene.mutateElement(container, { width: 1000, height: 30 });

    await UI.editText(
      container as ExcalidrawTextContainer,
      Array(60).fill("word").join(" "),
    );

    const fitted = API.getElement(container);
    expect(fitted.width / fitted.height).toBeGreaterThan(1.4);
    expect(fitted.width / fitted.height).toBeLessThan(2.2);
  });

  it("a shape fitting itself while typing grows from its center", async () => {
    const [container, text] = API.createTextContainer({
      label: { text: "hi" },
    });
    API.setElements([container, text]);
    h.app.scene.mutateElement(container, {
      x: 0,
      y: 0,
      width: 200,
      height: 100,
    });
    API.setSelectedElements([container]);
    Keyboard.keyPress(KEYS.ENTER);
    const editor = await getTextEditor();

    let typed = "";
    for (const word of Array(40).fill("word")) {
      typed += `${word} `;
      fireEvent.input(editor, { target: { value: typed } });
      const fitted = API.getElement(container);
      expect(fitted.x + fitted.width / 2).toBeCloseTo(100);
      expect(fitted.y + fitted.height / 2).toBeCloseTo(50);
    }
  });

  it("free text wraps once it gets too long, and unwraps when shortened", async () => {
    API.setAppState({ width: 2000, height: 1000 });
    const mouse = new Pointer("mouse");
    UI.clickTool("text");
    mouse.clickAt(100, 100);
    const editor = await getTextEditor();
    const text = () => h.elements[0] as ExcalidrawTextElement;

    // measureText is mocked: a character is 10px wide, so wraps at 600px
    fireEvent.input(editor, { target: { value: "word ".repeat(30) } });
    expect(text().autoResize).toBe(false);
    expect(text().text.split("\n").length).toBeGreaterThan(1);
    expect(text().width).toBe(600);

    fireEvent.input(editor, { target: { value: "short" } });
    expect(text().autoResize).toBe(true);
    expect(text().text).toBe("short");
  });

  it("free text wraps before running off the right edge of the view", async () => {
    API.setAppState({ width: 1000, height: 1000 });
    const mouse = new Pointer("mouse");
    UI.clickTool("text");
    mouse.clickAt(700, 100);
    const editor = await getTextEditor();
    const text = () => h.elements[0] as ExcalidrawTextElement;

    fireEvent.input(editor, { target: { value: "word ".repeat(30) } });
    expect(text().autoResize).toBe(false);
    expect(text().x + text().width).toBeLessThanOrEqual(1000 - 40);
  });
});
