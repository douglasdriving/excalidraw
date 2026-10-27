import { KEYS } from "@excalidraw/common";
import { act, fireEvent, render, waitFor } from "@testing-library/react";

import {
  CanvasSwitcher,
  getSwitcherIndex,
  getSwitcherOrder,
} from "./CanvasSwitcher";
import { LocalFiles } from "./LocalFiles";
import { localFilesApi } from "./api";

import type { CanvasListEntry } from "./api";

const entry = (name: string): CanvasListEntry => ({
  name,
  modified: 0,
  size: 0,
  hasThumbnail: false,
  versionCount: 1,
});

describe("switcher order", () => {
  const files = ["D", "C", "B", "A"].map(entry);
  const names = (items: CanvasListEntry[]) => items.map((f) => f.name);

  it("puts the open canvas first, then recently opened, then the rest", () => {
    expect(names(getSwitcherOrder(files, ["B", "A", "C"], "A"))).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);
    expect(names(getSwitcherOrder(files, ["B", "gone"], null))).toEqual([
      "B",
      "D",
      "C",
      "A",
    ]);
  });

  it("skips the open canvas on the first press and wraps back to it", () => {
    const items = getSwitcherOrder(files, [], "C");
    expect(
      [1, 2, 3, 4].map((steps) => getSwitcherIndex(items, "C", steps)),
    ).toEqual([1, 2, 3, 0]);
    // untitled canvas: nothing to skip
    expect(getSwitcherIndex(files, null, 1)).toBe(0);
  });
});

describe("<CanvasSwitcher />", () => {
  const shiftTab = () =>
    fireEvent.keyDown(document.body, { key: KEYS.TAB, shiftKey: true });
  const releaseShift = () => fireEvent.keyUp(document.body, { key: "Shift" });

  let open: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.spyOn(LocalFiles, "state", "get").mockReturnValue({
      ...LocalFiles.state,
      availability: "available",
      currentName: "A",
    });
    vi.spyOn(localFilesApi, "list").mockResolvedValue({
      dir: "/canvases",
      files: ["A", "B", "C"].map(entry),
      lastOpened: "A",
      recent: ["A", "C", "B"],
    });
    open = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(LocalFiles, "open").mockImplementation(open);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const selectedName = () =>
    document.querySelector(
      ".local-files-switcher__item--selected .local-files-switcher__name",
    )?.textContent;

  it("cycles with Tab while Shift is held and opens on release", async () => {
    render(<CanvasSwitcher excalidrawAPI={null} />);
    shiftTab();
    await waitFor(() => expect(selectedName()).toBe("C"));
    shiftTab();
    expect(selectedName()).toBe("B");
    releaseShift();
    expect(open).toHaveBeenCalledWith("B");
    expect(document.querySelector(".local-files-switcher")).toBeNull();
  });

  it("opens the previous canvas when Shift is released before the list loads", async () => {
    render(<CanvasSwitcher excalidrawAPI={null} />);
    shiftTab();
    releaseShift();
    await waitFor(() => expect(open).toHaveBeenCalledWith("C"));
  });

  it("cancels with Escape and ignores Shift+Tab in text inputs", async () => {
    render(<CanvasSwitcher excalidrawAPI={null} />);
    shiftTab();
    await waitFor(() => expect(selectedName()).toBe("C"));
    fireEvent.keyDown(document.body, { key: KEYS.ESCAPE });
    releaseShift();
    expect(open).not.toHaveBeenCalled();

    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    fireEvent.keyDown(textarea, { key: KEYS.TAB, shiftKey: true });
    await act(() => Promise.resolve());
    expect(document.querySelector(".local-files-switcher")).toBeNull();
    textarea.remove();
  });
});
