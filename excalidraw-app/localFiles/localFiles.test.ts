import fs from "fs/promises";
import os from "os";
import path from "path";

import { nextFreeName, validateCanvasName } from "./names";
import { getVersionsToPrune } from "./retention";
import { createLocalFilesStore } from "./vitePlugin";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("canvas names", () => {
  it("validates names that become file names", () => {
    expect(validateCanvasName("Roadmap 2026")).toBeNull();
    expect(validateCanvasName("")).not.toBeNull();
    expect(validateCanvasName(" padded")).not.toBeNull();
    expect(validateCanvasName("../escape")).not.toBeNull();
    expect(validateCanvasName("a/b")).not.toBeNull();
    expect(validateCanvasName(".hidden")).not.toBeNull();
  });

  it("suggests the next free name", () => {
    expect(nextFreeName("Roadmap", [])).toBe("Roadmap 2");
    expect(nextFreeName("Roadmap", ["Roadmap 2"])).toBe("Roadmap 3");
    expect(nextFreeName("Roadmap 2", ["Roadmap 3"])).toBe("Roadmap 4");
    expect(nextFreeName("Untitled", [], { allowBase: true })).toBe("Untitled");
    expect(nextFreeName("Untitled", ["untitled"], { allowBase: true })).toBe(
      "Untitled 2",
    );
  });
});

describe("version retention", () => {
  const now = 1_000 * DAY;

  it("keeps every version from the last 15 minutes", () => {
    const recent = [1, 2, 3, 4, 5].map((m) => now - m * MINUTE);
    expect(getVersionsToPrune(recent, now)).toEqual([]);
  });

  it("thins older versions to one per bucket, keeping the newest", () => {
    // ten saves 30s apart, about 1 hour ago: all inside one 5-minute bucket
    const base = Math.floor((now - HOUR) / (5 * MINUTE)) * (5 * MINUTE);
    const burst = Array.from({ length: 10 }, (_, i) => base + i * 30_000);
    const pruned = getVersionsToPrune([now, ...burst], now);
    expect(pruned).toHaveLength(9);
    expect(pruned).not.toContain(burst[9]);
  });

  it("keeps at most one version per day after two days", () => {
    const dayStart = Math.floor((now - 10 * DAY) / DAY) * DAY;
    const sameDay = [1, 5, 9, 13].map((h) => dayStart + h * HOUR);
    const pruned = getVersionsToPrune([now, ...sameDay], now);
    expect(pruned.sort()).toEqual(sameDay.slice(0, 3).sort());
  });

  it("always keeps the newest version", () => {
    const old = now - 400 * DAY;
    expect(getVersionsToPrune([old], now)).toEqual([]);
  });
});

describe("local files store", () => {
  let dir: string;
  let store: ReturnType<typeof createLocalFilesStore>;
  const scene = (label: string) =>
    JSON.stringify({ type: "excalidraw", elements: [], label });

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "excalidraw-local-"));
    store = createLocalFilesStore(dir);
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("creates, saves, versions and remembers the last opened canvas", async () => {
    const { name } = await store.create({
      name: "Untitled",
      content: scene("a"),
      pickFreeName: true,
    });
    expect(name).toBe("Untitled");

    expect((await store.save({ name, content: scene("b") })).saved).toBe(true);
    // unchanged content is not rewritten and adds no version
    expect((await store.save({ name, content: scene("b") })).saved).toBe(false);

    expect(await store.read(name)).toBe(scene("b"));
    const history = await store.history(name);
    expect(history).toHaveLength(2);
    expect(await store.version(name, history[1].id)).toBe(scene("a"));

    const listing = await store.list();
    expect(listing.lastOpened).toBe("Untitled");
    expect(listing.files.map((f) => f.name)).toEqual(["Untitled"]);
    expect(listing.files[0].versionCount).toBe(2);
  });

  it("picks a free name and refuses to overwrite on save-as", async () => {
    await store.create({ name: "Untitled", content: scene("a") });
    const second = await store.create({
      name: "Untitled",
      content: scene("b"),
      pickFreeName: true,
    });
    expect(second.name).toBe("Untitled 2");
    await expect(
      store.create({ name: "untitled", content: scene("c") }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("renames with history and trashes on delete", async () => {
    await store.create({ name: "Draft", content: scene("a") });
    await store.rename({ from: "Draft", to: "Final" });
    expect((await store.list()).lastOpened).toBe("Final");
    expect(await store.history("Final")).toHaveLength(1);

    const { trashedTo } = await store.remove({ name: "Final" });
    expect((await store.list()).files).toEqual([]);
    expect((await store.list()).lastOpened).toBeNull();
    expect(await fs.readdir(trashedTo)).toContain("Final.excalidraw");
  });

  it("rejects names that escape the folder", async () => {
    await expect(store.read("../secrets")).rejects.toMatchObject({
      status: 400,
    });
  });
});
