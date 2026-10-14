import { CODES, KEYS, getFontString } from "@excalidraw/common";

import {
  CaptureUpdateAction,
  computeContainerDimensionForBoundText,
  getBoundTextElement,
  getContainerElement,
  isArrowElement,
  isBoundToContainer,
  measureText,
  redrawTextBoundingBox,
  updateBoundElements,
  updateOriginalContainerCache,
  wrapText,
} from "@excalidraw/element";

import type {
  ElementsMap,
  ExcalidrawElement,
  ExcalidrawTextContainer,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";

import { register } from "./register";

/** non-arrow containers with bound text, resolved from the selection (a
 * selected bound text counts as its container) */
const getContainersToFit = (
  selectedElements: readonly ExcalidrawElement[],
  elementsMap: ElementsMap,
) => {
  const containers = new Map<string, ExcalidrawTextContainer>();
  for (const element of selectedElements) {
    const container = isBoundToContainer(element)
      ? getContainerElement(element, elementsMap)
      : element;
    if (
      container &&
      !isArrowElement(container) &&
      getBoundTextElement(container, elementsMap)
    ) {
      containers.set(container.id, container as ExcalidrawTextContainer);
    }
  }
  return [...containers.values()];
};

/** container width / height the fit aims for */
const TARGET_ASPECT_RATIO = 1;
/** wrap widths tried between the longest word and the unwrapped text */
const WRAP_WIDTH_SAMPLES = 50;

/**
 * Finds the container size that wraps the text closest to
 * TARGET_ASPECT_RATIO, never wrapping narrower than the longest word.
 */
const getBalancedContainerSize = (
  container: ExcalidrawTextContainer,
  textElement: ExcalidrawTextElement,
) => {
  const fontString = getFontString(textElement);
  const measure = (text: string) =>
    measureText(text, fontString, textElement.lineHeight);
  const { originalText } = textElement;

  const minWrapWidth = Math.max(
    ...originalText.split(/\s+/).map((word) => measure(word).width),
  );
  const maxWrapWidth = Math.max(minWrapWidth, measure(originalText).width);

  let best = { width: 0, height: 0, score: Infinity };
  for (let i = 0; i <= WRAP_WIDTH_SAMPLES; i++) {
    const wrapWidth = Math.ceil(
      minWrapWidth + ((maxWrapWidth - minWrapWidth) * i) / WRAP_WIDTH_SAMPLES,
    );
    const metrics = measure(wrapText(originalText, fontString, wrapWidth));
    const width = computeContainerDimensionForBoundText(
      metrics.width,
      container.type,
    );
    const height = computeContainerDimensionForBoundText(
      metrics.height,
      container.type,
    );
    const score = Math.abs(Math.log(width / height / TARGET_ASPECT_RATIO));
    if (score < best.score) {
      best = { width, height, score };
    }
  }
  return best;
};

/**
 * Resizes each selected container to tightly wrap its bound text, rewrapping
 * the text so the container is roughly square. Keeps the container's center.
 */
export const actionFitContainerToText = register({
  name: "fitContainerToText",
  label: "labels.fitContainerToText",
  icon: null,
  trackEvent: { category: "element" },
  predicate: (elements, appState, _, app) =>
    getContainersToFit(
      app.scene.getSelectedElements(appState),
      app.scene.getNonDeletedElementsMap(),
    ).length > 0,
  perform: (elements, appState, _, app) => {
    const elementsMap = app.scene.getNonDeletedElementsMap();
    const containers = getContainersToFit(
      app.scene.getSelectedElements(appState),
      elementsMap,
    );

    if (!containers.length) {
      return false;
    }

    for (const container of containers) {
      const textElement = getBoundTextElement(container, elementsMap)!;
      if (!textElement.originalText.trim()) {
        continue;
      }
      const { width, height } = getBalancedContainerSize(
        container,
        textElement,
      );

      app.scene.mutateElement(container, {
        x: container.x + (container.width - width) / 2,
        y: container.y + (container.height - height) / 2,
        width,
        height,
      });
      updateOriginalContainerCache(container.id, height);
      redrawTextBoundingBox(textElement, container, app.scene);
      updateBoundElements(container, app.scene);
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
    event.code === CODES.F,
});
