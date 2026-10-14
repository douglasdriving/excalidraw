import { KEYS } from "@excalidraw/common";

import {
  moveOneLeft,
  moveOneRight,
  moveAllLeft,
  moveAllRight,
} from "@excalidraw/element";

import { CaptureUpdateAction } from "@excalidraw/element";

import {
  BringForwardIcon,
  BringToFrontIcon,
  SendBackwardIcon,
  SendToBackIcon,
} from "../components/icons";
import { t } from "../i18n";
import { getShortcutKey } from "../shortcut";

import { register } from "./register";

export const actionSendBackward = register({
  name: "sendBackward",
  label: "labels.sendBackward",
  keywords: ["move down", "zindex", "layer"],
  icon: SendBackwardIcon,
  trackEvent: { category: "element" },
  perform: (elements, appState, value, app) => {
    return {
      elements: moveOneLeft(elements, appState, app.scene),
      appState,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
  keyPriority: 40,
  keyTest: (event) =>
    event.altKey &&
    !event.shiftKey &&
    !event[KEYS.CTRL_OR_CMD] &&
    event.key === KEYS.ARROW_DOWN,
  PanelComponent: ({ updateData, appState }) => (
    <button
      type="button"
      className="zIndexButton"
      onClick={() => updateData(null)}
      title={`${t("labels.sendBackward")} — ${getShortcutKey("Alt+Down")}`}
    >
      {SendBackwardIcon}
    </button>
  ),
});

export const actionBringForward = register({
  name: "bringForward",
  label: "labels.bringForward",
  keywords: ["move up", "zindex", "layer"],
  icon: BringForwardIcon,
  trackEvent: { category: "element" },
  perform: (elements, appState, value, app) => {
    return {
      elements: moveOneRight(elements, appState, app.scene),
      appState,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
  keyPriority: 40,
  keyTest: (event) =>
    event.altKey &&
    !event.shiftKey &&
    !event[KEYS.CTRL_OR_CMD] &&
    event.key === KEYS.ARROW_UP,
  PanelComponent: ({ updateData, appState }) => (
    <button
      type="button"
      className="zIndexButton"
      onClick={() => updateData(null)}
      title={`${t("labels.bringForward")} — ${getShortcutKey("Alt+Up")}`}
    >
      {BringForwardIcon}
    </button>
  ),
});

export const actionSendToBack = register({
  name: "sendToBack",
  label: "labels.sendToBack",
  keywords: ["move down", "zindex", "layer"],
  icon: SendToBackIcon,
  trackEvent: { category: "element" },
  perform: (elements, appState) => {
    return {
      elements: moveAllLeft(elements, appState),
      appState,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
  keyTest: (event) =>
    event.altKey &&
    event.shiftKey &&
    !event[KEYS.CTRL_OR_CMD] &&
    event.key === KEYS.ARROW_DOWN,
  PanelComponent: ({ updateData, appState }) => (
    <button
      type="button"
      className="zIndexButton"
      onClick={() => updateData(null)}
      title={`${t("labels.sendToBack")} — ${getShortcutKey("Alt+Shift+Down")}`}
    >
      {SendToBackIcon}
    </button>
  ),
});

export const actionBringToFront = register({
  name: "bringToFront",
  label: "labels.bringToFront",
  keywords: ["move up", "zindex", "layer"],
  icon: BringToFrontIcon,
  trackEvent: { category: "element" },

  perform: (elements, appState) => {
    return {
      elements: moveAllRight(elements, appState),
      appState,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
  keyTest: (event) =>
    event.altKey &&
    event.shiftKey &&
    !event[KEYS.CTRL_OR_CMD] &&
    event.key === KEYS.ARROW_UP,
  PanelComponent: ({ updateData, appState }) => (
    <button
      type="button"
      className="zIndexButton"
      onClick={(event) => updateData(null)}
      title={`${t("labels.bringToFront")} — ${getShortcutKey("Alt+Shift+Up")}`}
    >
      {BringToFrontIcon}
    </button>
  ),
});
