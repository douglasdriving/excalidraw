import {
  SVG_NS,
  getStrokeWidthByKey,
  sceneCoordsToViewportCoords,
} from "@excalidraw/common";

import {
  bindBindingElement,
  elementCenterPoint,
  intersectElementWithLineSegment,
  isArrowElement,
  isBindableElement,
  isBoundToContainer,
  isFrameLikeElement,
  isPointInElement,
  newArrowElement,
  updateBoundElements,
} from "@excalidraw/element";
import { withArrowBelowBindables } from "@excalidraw/element/zindex";
import { lineSegment, pointDistance, pointFrom } from "@excalidraw/math";

import type { Scene } from "@excalidraw/element";
import type { GlobalPoint, LineSegment } from "@excalidraw/math/types";
import type {
  ElementsMap,
  ExcalidrawArrowElement,
  ExcalidrawBindableElement,
  NonDeleted,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import { AnimatedTrail } from "../animatedTrail";

import type App from "../components/App";
import type { AppState } from "../types";

const CONNECTOR_COLOR = "rgba(134, 131, 226, 1)";

/**
 * Trail for the connector tool. Like the eraser, dragging marks every shape the
 * pointer passes over; on release the marked shapes are chained together (in
 * the order they were touched) with center-bound lines. Re-entering a shape
 * touched earlier in the same drag adds another link to the chain, so dragging
 * a → b → c → a closes the loop. While dragging, the lines that will be created
 * are previewed as dashed center-to-center segments.
 */
export class ConnectorTrail extends AnimatedTrail {
  /** Shapes in the order the pointer entered them (may repeat) */
  private visits: NonDeleted<ExcalidrawBindableElement>[] = [];
  /** Shapes under the previous trail segment, to detect entering a shape */
  private touching: Set<ExcalidrawBindableElement["id"]> = new Set();
  private previewElement: SVGPathElement;
  private previewContainer?: SVGSVGElement;

  constructor(app: App) {
    super(app, {
      streamline: 0.2,
      size: 5,
      keepHead: true,
      fill: () => "rgba(134, 131, 226, 0.35)",
    });

    this.previewElement = document.createElementNS(SVG_NS, "path");
    this.previewElement.setAttribute("fill", "none");
    this.previewElement.setAttribute("stroke", CONNECTOR_COLOR);
    this.previewElement.setAttribute("stroke-width", "2");
    this.previewElement.setAttribute("stroke-dasharray", "6 4");
  }

  start(container?: SVGSVGElement) {
    super.start(container);

    if (container) {
      this.previewContainer = container;
    }
  }

  stop() {
    super.stop();
    this.previewElement.remove();
  }

  startPath(x: number, y: number): void {
    this.endPath();
    super.startPath(x, y);
  }

  addPointToPath(x: number, y: number) {
    super.addPointToPath(x, y);

    const path = this.getCurrentTrail()?.originalPoints;
    if (path && path.length >= 2) {
      this.markElementsAlong(
        lineSegment<GlobalPoint>(
          pointFrom(path[path.length - 2][0], path[path.length - 2][1]),
          pointFrom(path[path.length - 1][0], path[path.length - 1][1]),
        ),
      );
    }

    this.updatePreview();
  }

  /** Marks any element at a point (used for a click without dragging). */
  markElementsAt(x: number, y: number) {
    const point = pointFrom<GlobalPoint>(x, y);
    this.markElementsAlong(lineSegment(point, point));
  }

  /** The shapes to chain together, in order (a shape may appear repeatedly) */
  getElementsToConnect() {
    return this.visits;
  }

  /** Every distinct shape touched so far */
  getTouchedElements() {
    return [...new Set(this.visits)];
  }

  endPath(): void {
    super.endPath();
    super.clearTrails();
    this.visits = [];
    this.touching = new Set();
    this.updatePreview();
  }

  private markElementsAlong(segment: LineSegment<GlobalPoint>) {
    const elementsMap = this.app.scene.getNonDeletedElementsMap();

    const hits = this.app.visibleElements.filter(
      (el): el is NonDeleted<ExcalidrawBindableElement> =>
        isConnectableElement(el) && connectorTest(segment, el, elementsMap),
    );

    // Only shapes the pointer just entered extend the chain. Staying inside a
    // shape (or inside overlapping shapes) must not add it again.
    const entered = hits
      .filter((el) => !this.touching.has(el.id))
      // A fast drag can cross several shapes in one segment: keep them in the
      // order the pointer reached them.
      .sort(
        (a, b) =>
          pointDistance(segment[0], elementCenterPoint(a, elementsMap)) -
          pointDistance(segment[0], elementCenterPoint(b, elementsMap)),
      );

    for (const element of entered) {
      if (this.visits.at(-1)?.id !== element.id) {
        this.visits = [...this.visits, element];
      }
    }

    this.touching = new Set(hits.map((el) => el.id));
  }

  private updatePreview() {
    // Only keep the preview in the SVG layer while there is a line to show
    if (this.visits.length < 2) {
      this.previewElement.remove();
      return;
    }
    if (
      this.previewContainer &&
      this.previewElement.parentNode !== this.previewContainer
    ) {
      this.previewContainer.appendChild(this.previewElement);
    }

    const elementsMap = this.app.scene.getNonDeletedElementsMap();
    const d = this.visits
      .map((element, idx) => {
        const [sceneX, sceneY] = elementCenterPoint(element, elementsMap);
        const { x, y } = sceneCoordsToViewportCoords(
          { sceneX, sceneY },
          this.app.state,
        );
        return `${idx === 0 ? "M" : "L"}${x} ${y}`;
      })
      .join(" ");

    this.previewElement.setAttribute("d", d);
  }
}

const isConnectableElement = (
  element: NonDeletedExcalidrawElement,
): element is NonDeleted<ExcalidrawBindableElement> =>
  isBindableElement(element) &&
  !element.locked &&
  !isFrameLikeElement(element) &&
  // Text inside a container is reached through its container
  !isBoundToContainer(element);

const connectorTest = (
  segment: LineSegment<GlobalPoint>,
  element: ExcalidrawBindableElement,
  elementsMap: ElementsMap,
): boolean =>
  // Unlike the eraser, the inside of a transparent shape counts as touching it
  isPointInElement(segment[1], element, elementsMap) ||
  intersectElementWithLineSegment(element, elementsMap, segment, 0, true)
    .length > 0;

const areConnected = (
  a: ExcalidrawBindableElement,
  b: ExcalidrawBindableElement,
  elementsMap: ElementsMap,
) =>
  (a.boundElements ?? []).some(({ id }) => {
    const arrow = elementsMap.get(id);
    if (!arrow || !isArrowElement(arrow)) {
      return false;
    }
    const ends = [arrow.startBinding?.elementId, arrow.endBinding?.elementId];
    return ends.includes(a.id) && ends.includes(b.id);
  });

/**
 * Chains `elements` together in order with center-bound lines (arrows without
 * arrowheads), skipping pairs that are already connected (including by a line
 * created earlier in the same chain). Returns the created lines.
 */
export const connectElements = (
  elements: readonly NonDeleted<ExcalidrawBindableElement>[],
  scene: Scene,
  appState: AppState,
): NonDeleted<ExcalidrawArrowElement>[] => {
  const created: {
    line: NonDeleted<ExcalidrawArrowElement>;
    ends: [string, string];
  }[] = [];

  for (let i = 1; i < elements.length; i++) {
    const elementsMap = scene.getNonDeletedElementsMap();
    // Re-read: earlier connections updated `boundElements`
    const from = elementsMap.get(elements[i - 1].id);
    const to = elementsMap.get(elements[i].id);
    if (
      !from ||
      !to ||
      !isBindableElement(from) ||
      !isBindableElement(to) ||
      areConnected(from, to, elementsMap)
    ) {
      continue;
    }

    const [fromX, fromY] = elementCenterPoint(from, elementsMap);
    const [toX, toY] = elementCenterPoint(to, elementsMap);

    const line = newArrowElement({
      type: "arrow",
      x: fromX,
      y: fromY,
      points: [pointFrom(0, 0), pointFrom(toX - fromX, toY - fromY)],
      strokeColor: appState.currentItemStrokeColor,
      strokeWidth: getStrokeWidthByKey(
        "arrow",
        appState.currentItemStrokeWidthKey,
      ),
      strokeStyle: appState.currentItemStrokeStyle,
      roughness: appState.currentItemRoughness,
      opacity: appState.currentItemOpacity,
      roundness: null,
      startArrowhead: null,
      endArrowhead: null,
      locked: false,
      frameId: from.frameId === to.frameId ? from.frameId : null,
      elbowed: false,
    });

    scene.insertElement(line);
    // Both endpoints sit exactly on the centers, so these become center
    // bindings; updating the bound elements then clips the ends to the outlines.
    bindBindingElement(line, from, "orbit", "start", scene);
    bindBindingElement(line, to, "orbit", "end", scene);
    updateBoundElements(from, scene);

    created.push({ line, ends: [from.id, to.id] });
  }

  if (created.length) {
    // Center-bound lines are drawn behind the shapes they connect
    scene.replaceAllElements(
      created.reduce(
        (acc, { line, ends }) => withArrowBelowBindables(acc, line.id, ends),
        scene.getElementsIncludingDeleted(),
      ),
    );
  }

  return created.map(({ line }) => line);
};
