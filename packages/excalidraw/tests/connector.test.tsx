import React from "react";

import { KEYS } from "@excalidraw/common";
import { isArrowElement } from "@excalidraw/element";

import type { ExcalidrawArrowElement } from "@excalidraw/element/types";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Keyboard, Pointer, UI } from "./helpers/ui";
import {
  act,
  mockBoundingClientRect,
  render,
  restoreOriginalGetBoundingClientRect,
} from "./test-utils";

const { h } = window;

const mouse = new Pointer("mouse");

const lines = () =>
  h.elements.filter(
    (el): el is ExcalidrawArrowElement => isArrowElement(el) && !el.isDeleted,
  );

const ends = (line: ExcalidrawArrowElement) => [
  line.startBinding?.elementId,
  line.endBinding?.elementId,
];

describe("connector tool", () => {
  // Only shapes in the viewport can be touched
  beforeAll(() => {
    mockBoundingClientRect({ width: 1000, height: 1000 });
  });

  afterAll(() => {
    restoreOriginalGetBoundingClientRect();
  });

  beforeEach(async () => {
    await render(<Excalidraw handleKeyboardGlobally={true} />);
    mouse.reset();
  });

  const createBoxes = () => {
    const a = API.createElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
    const b = API.createElement({
      type: "rectangle",
      x: 300,
      y: 0,
      width: 100,
      height: 100,
    });
    const c = API.createElement({
      type: "ellipse",
      x: 300,
      y: 300,
      width: 100,
      height: 100,
    });
    API.setElements([a, b, c]);
    return { a, b, c };
  };

  // Drags through the given points, with intermediate moves so every shape
  // along the way is crossed.
  const drag = (points: [number, number][]) => {
    act(() => {
      mouse.reset();
      mouse.moveTo(...points[0]);
      mouse.down();
      for (const [x, y] of points.slice(1)) {
        mouse.moveTo(x, y);
      }
      mouse.up();
    });
  };

  it("is selected with C", () => {
    Keyboard.keyPress(KEYS.C);
    expect(h.state.activeTool.type).toBe("connector");
  });

  it("chains the touched shapes with center-bound lines without arrowheads", () => {
    const { a, b, c } = createBoxes();
    UI.clickTool("connector");

    drag([
      [50, 50],
      [200, 50],
      [350, 50],
      [350, 200],
      [350, 350],
    ]);

    const created = lines();
    expect(created.map(ends)).toEqual([
      [a.id, b.id],
      [b.id, c.id],
    ]);

    for (const line of created) {
      expect(line.startArrowhead).toBe(null);
      expect(line.endArrowhead).toBe(null);
      expect(line.startBinding?.center).toBe(true);
      expect(line.endBinding?.center).toBe(true);
    }

    // The visible ends are clipped to the outlines, not at the centers
    const [ab] = created;
    expect(ab.x).toBeGreaterThanOrEqual(100);
    expect(ab.x + ab.points[1][0]).toBeLessThanOrEqual(300);

    // Each shape knows about its lines
    expect(API.getElement(b).boundElements?.map(({ id }) => id)).toEqual(
      created.map(({ id }) => id),
    );

    // Lines are drawn behind the shapes they connect
    const order = h.elements.map(({ id }) => id);
    expect(order.indexOf(created[0].id)).toBeLessThan(order.indexOf(a.id));

    // The tool stays active, like the eraser
    expect(h.state.activeTool.type).toBe("connector");
    expect(h.state.elementsToHighlight).toBe(null);
  });

  it("creates nothing when fewer than two shapes are touched", () => {
    createBoxes();
    UI.clickTool("connector");

    drag([
      [50, 50],
      [60, 60],
    ]);

    expect(lines()).toEqual([]);
  });

  it("skips shapes that are already connected", () => {
    const { a, b } = createBoxes();
    UI.clickTool("connector");

    drag([
      [50, 50],
      [200, 50],
      [350, 50],
    ]);
    drag([
      [350, 50],
      [200, 50],
      [50, 50],
    ]);

    expect(lines().map(ends)).toEqual([[a.id, b.id]]);
  });

  it("connects a shape again when the drag returns to it", () => {
    const { a, b, c } = createBoxes();
    UI.clickTool("connector");

    drag([
      [50, 50],
      [200, 50],
      [350, 50],
      [350, 200],
      [350, 350],
      [200, 200],
      [50, 50],
      // wiggling inside a shape doesn't add it again
      [60, 60],
      [40, 70],
    ]);

    // (lines are ordered by z-index, not creation)
    expect(lines().map(ends)).toHaveLength(3);
    expect(lines().map(ends)).toEqual(
      expect.arrayContaining([
        [a.id, b.id],
        [b.id, c.id],
        [c.id, a.id],
      ]),
    );
  });

  it("doesn't duplicate a connection when the drag goes back and forth", () => {
    const { a, b } = createBoxes();
    UI.clickTool("connector");

    drag([
      [50, 50],
      [200, 50],
      [350, 50],
      [200, 50],
      [50, 50],
      [200, 50],
      [350, 50],
    ]);

    expect(lines().map(ends)).toEqual([[a.id, b.id]]);
  });

  it("is undone in one step", () => {
    createBoxes();
    UI.clickTool("connector");

    drag([
      [50, 50],
      [200, 50],
      [350, 50],
      [350, 200],
      [350, 350],
    ]);
    expect(lines()).toHaveLength(2);

    Keyboard.undo();

    expect(lines()).toHaveLength(0);
  });

  describe("erasing", () => {
    const connectAll = () => {
      UI.clickTool("connector");
      drag([
        [50, 50],
        [200, 50],
        [350, 50],
        [350, 200],
        [350, 350],
      ]);
      UI.clickTool("eraser");
    };

    const lineBetween = (from: { id: string }, to: { id: string }) =>
      lines().find(
        (line) =>
          line.startBinding?.elementId === from.id &&
          line.endBinding?.elementId === to.id,
      )!;

    it("erases the line when both connected shapes are erased", () => {
      const { a, b, c } = createBoxes();
      connectAll();
      const ab = lineBetween(a, b);
      const bc = lineBetween(b, c);

      // through a and b only
      drag([
        [50, 50],
        [200, 50],
        [350, 50],
      ]);

      expect(API.getElement(a).isDeleted).toBe(true);
      expect(API.getElement(b).isDeleted).toBe(true);
      expect(API.getElement(ab).isDeleted).toBe(true);
      // b is gone, so its line to c goes too, but c stays
      expect(API.getElement(bc).isDeleted).toBe(true);
      expect(API.getElement(c).isDeleted).toBe(false);
    });

    it("erases the line when only one of the shapes is erased", () => {
      const { a, b, c } = createBoxes();
      connectAll();
      const ab = lineBetween(a, b);
      const bc = lineBetween(b, c);

      // across a's left edge (the eraser only hits a transparent shape's
      // outline)
      drag([
        [20, 50],
        [-20, 50],
      ]);

      expect(API.getElement(a).isDeleted).toBe(true);
      expect(API.getElement(ab).isDeleted).toBe(true);
      expect(API.getElement(b).isDeleted).toBe(false);
      expect(API.getElement(bc).isDeleted).toBe(false);
    });

    it("keeps an arrow with a free end", () => {
      const { a } = createBoxes();
      const arrow = API.createElement({
        type: "arrow",
        x: 200,
        y: 200,
        width: 100,
        height: 100,
        endArrowhead: "arrow",
      });
      API.setElements([...h.elements, arrow]);
      h.app.scene.mutateElement(arrow, {
        startBinding: {
          elementId: a.id,
          fixedPoint: [0.5, 0.5],
          mode: "orbit",
        },
      });
      h.app.scene.mutateElement(API.getElement(a), {
        boundElements: [{ id: arrow.id, type: "arrow" }],
      });
      UI.clickTool("eraser");

      drag([
        [20, 50],
        [-20, 50],
      ]);

      expect(API.getElement(a).isDeleted).toBe(true);
      expect(API.getElement(arrow).isDeleted).toBe(false);
    });
  });
});
