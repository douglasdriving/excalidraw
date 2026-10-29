import { CODES, KEYS } from "@excalidraw/common";

import {
  CaptureUpdateAction,
  getCommonBounds,
  isBoundToContainer,
  isLinearElement,
  updateBoundElements,
} from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { register } from "./register";

import type { AppClassProperties } from "../types";

/** scene px between neighbouring items */
const ARRANGE_GAP = 40;
/** cluster width / height the packing aims for */
const ARRANGE_ASPECT_RATIO = 16 / 9;

type ArrangeUnit = {
  elements: ExcalidrawElement[];
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * Splits the selection into the things that move as one: a group, or a
 * single element together with its bound text. Arrows bound to a shape are
 * left out, since they follow the shapes they're bound to.
 */
const getArrangeUnits = (app: AppClassProperties): ArrangeUnit[] => {
  const selected = app.scene.getSelectedElements({
    selectedElementIds: app.state.selectedElementIds,
    includeBoundTextElement: true,
  });
  const elementsMap = app.scene.getNonDeletedElementsMap();

  const getUnitKey = (element: ExcalidrawElement): string => {
    if (isBoundToContainer(element)) {
      const container = elementsMap.get(element.containerId);
      if (container) {
        return getUnitKey(container);
      }
    }
    return element.groupIds.length
      ? element.groupIds[element.groupIds.length - 1]
      : element.id;
  };

  const units = new Map<string, ExcalidrawElement[]>();
  for (const element of selected) {
    if (
      isLinearElement(element) &&
      (element.startBinding || element.endBinding) &&
      !element.groupIds.length
    ) {
      continue;
    }
    const key = getUnitKey(element);
    units.set(key, [...(units.get(key) ?? []), element]);
  }

  return [...units.values()].map((elements) => {
    const [minX, minY, maxX, maxY] = getCommonBounds(elements);
    return {
      elements,
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  });
};

/**
 * Packs the units into rows (reading order of where they were), evenly
 * spaced, aiming for a roughly widescreen cluster. Returns each unit's new
 * top-left corner, relative to the cluster's top-left.
 */
const packUnits = (units: readonly ArrangeUnit[]) => {
  const area = units.reduce(
    (sum, unit) =>
      sum + (unit.width + ARRANGE_GAP) * (unit.height + ARRANGE_GAP),
    0,
  );
  const rowWidth = Math.max(
    Math.sqrt(area * ARRANGE_ASPECT_RATIO),
    ...units.map((unit) => unit.width),
  );

  const byY = [...units].sort(
    (a, b) => a.y + a.height / 2 - (b.y + b.height / 2),
  );
  const rows: ArrangeUnit[][] = [];
  let row: ArrangeUnit[] = [];
  let width = 0;
  for (const unit of byY) {
    if (row.length && width + unit.width > rowWidth) {
      rows.push(row);
      row = [];
      width = 0;
    }
    row.push(unit);
    width += unit.width + ARRANGE_GAP;
  }
  rows.push(row);

  const positions = new Map<ArrangeUnit, { x: number; y: number }>();
  const rowWidths = rows.map(
    (row) =>
      row.reduce((sum, unit) => sum + unit.width, 0) +
      ARRANGE_GAP * (row.length - 1),
  );
  const clusterWidth = Math.max(...rowWidths);
  let y = 0;
  rows.forEach((row, index) => {
    const rowHeight = Math.max(...row.map((unit) => unit.height));
    // center each row horizontally, and each unit vertically in its row
    let x = (clusterWidth - rowWidths[index]) / 2;
    for (const unit of row.sort((a, b) => a.x - b.x)) {
      positions.set(unit, { x, y: y + (rowHeight - unit.height) / 2 });
      x += unit.width + ARRANGE_GAP;
    }
    y += rowHeight + ARRANGE_GAP;
  });

  return {
    positions,
    width: clusterWidth,
    height: y - ARRANGE_GAP,
  };
};

/**
 * Tidies the selection into a neat, evenly spaced cluster with no overlaps,
 * centered where the selection was.
 */
export const actionArrangeSelection = register({
  name: "arrangeSelection",
  label: "labels.arrangeSelection",
  icon: null,
  trackEvent: { category: "element" },
  predicate: (elements, appState, _, app) => getArrangeUnits(app).length > 1,
  perform: (elements, appState, _, app) => {
    const units = getArrangeUnits(app);
    if (units.length < 2) {
      return false;
    }

    const [minX, minY, maxX, maxY] = getCommonBounds(
      units.flatMap((unit) => unit.elements),
    );
    const { positions, width, height } = packUnits(units);
    const originX = (minX + maxX) / 2 - width / 2;
    const originY = (minY + maxY) / 2 - height / 2;

    for (const unit of units) {
      const position = positions.get(unit)!;
      const dx = originX + position.x - unit.x;
      const dy = originY + position.y - unit.y;
      for (const element of unit.elements) {
        app.scene.mutateElement(element, {
          x: element.x + dx,
          y: element.y + dy,
        });
      }
    }
    for (const unit of units) {
      for (const element of unit.elements) {
        updateBoundElements(element, app.scene);
      }
    }

    return {
      elements: app.scene.getElementsIncludingDeleted(),
      appState,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
  keyTest: (event) =>
    event.altKey &&
    !event.shiftKey &&
    !event[KEYS.CTRL_OR_CMD] &&
    event.code === CODES.A,
});
