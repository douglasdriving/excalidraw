import React from "react";

import { BOUND_TEXT_PADDING, CODES, KEYS } from "@excalidraw/common";

import type { ExcalidrawTextElement } from "@excalidraw/element/types";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Keyboard } from "./helpers/ui";
import { render } from "./test-utils";

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
});
