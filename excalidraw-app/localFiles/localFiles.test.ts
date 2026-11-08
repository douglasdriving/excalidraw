import { createHandleStore } from "./handleStore";
import {
  INSTALL_PROMPT_SNOOZE,
  shouldShowInstallPrompt,
} from "./InstallPrompt";
import { nextFreeName, validateCanvasName } from "./names";
import { getVersionsToPrune } from "./retention";
import { createZip, crc32 } from "./zip";

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

/**
 * In-memory stand-in for FileSystemDirectoryHandle, covering the subset the
 * store uses (jsdom has no File System Access API).
 */
type MemNode = MemDir | MemFile;
class MemFile {
  readonly kind = "file";
  data: string | Blob = "";
  lastModified = Date.now();
  constructor(readonly name: string) {}
  async getFile() {
    const data = this.data;
    // jsdom's Blob has no text(); the store only reads back canvases/state
    const text =
      typeof data === "string"
        ? data
        : "text" in data && typeof data.text === "function"
        ? await data.text()
        : "<binary>";
    return {
      name: this.name,
      size: text.length,
      lastModified: this.lastModified,
      text: async () => text,
    };
  }
  async createWritable() {
    let next: string | Blob = "";
    return {
      write: async (data: string | Blob) => {
        next = data;
      },
      close: async () => {
        this.data = next;
        this.lastModified = Date.now();
      },
    };
  }
}
class MemDir {
  readonly kind = "directory";
  children = new Map<string, MemNode>();
  constructor(readonly name: string) {}
  private get(name: string, kind: MemNode["kind"], create?: boolean) {
    const existing = this.children.get(name);
    if (existing) {
      if (existing.kind !== kind) {
        throw new DOMException("wrong kind", "TypeMismatchError");
      }
      return existing;
    }
    if (!create) {
      throw new DOMException(`${name} not found`, "NotFoundError");
    }
    const node = kind === "file" ? new MemFile(name) : new MemDir(name);
    this.children.set(name, node);
    return node;
  }
  async getDirectoryHandle(name: string, opts?: { create?: boolean }) {
    return this.get(name, "directory", opts?.create);
  }
  async getFileHandle(name: string, opts?: { create?: boolean }) {
    return this.get(name, "file", opts?.create);
  }
  async removeEntry(name: string) {
    if (!this.children.delete(name)) {
      throw new DOMException(`${name} not found`, "NotFoundError");
    }
  }
  async *entries() {
    yield* [...this.children.entries()];
  }
}

const memPaths = (dir: MemDir, prefix = ""): string[] =>
  [...dir.children.values()].flatMap((node) =>
    node instanceof MemDir
      ? memPaths(node, `${prefix}${node.name}/`)
      : [`${prefix}${node.name}`],
  );

describe("local files store", () => {
  let root: MemDir;
  let store: ReturnType<typeof createHandleStore>;
  const scene = (label: string) =>
    JSON.stringify({ type: "excalidraw", elements: [], label });

  beforeEach(() => {
    root = new MemDir("canvases");
    store = createHandleStore(root as any, "the test folder");
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
    expect(listing.dir).toBe("the test folder");
    expect(listing.lastOpened).toBe("Untitled");
    expect(listing.files.map((f) => f.name)).toEqual(["Untitled"]);
    expect(listing.files[0].versionCount).toBe(2);
  });

  it("keeps the on-disk layout of the old dev-server store", async () => {
    await store.create({
      name: "Plan",
      content: scene("a"),
      thumbnail: `data:image/png;base64,${btoa("png")}`,
    });
    const paths = memPaths(root);
    expect(paths).toContain("Plan.excalidraw");
    expect(paths).toContain(".excalidraw-local/state.json");
    expect(paths).toContain(".excalidraw-local/thumbnails/Plan.png");
    expect(
      paths.some((p) =>
        /^\.excalidraw-local\/history\/Plan\/\d+\.excalidraw$/.test(p),
      ),
    ).toBe(true);
    expect((await store.list()).files[0].hasThumbnail).toBe(true);
    expect(await store.thumbnail("Plan")).not.toBeNull();
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
    await store.rename("Draft", "Final");
    expect((await store.list()).lastOpened).toBe("Final");
    expect(await store.history("Final")).toHaveLength(1);
    expect(await store.read("Final")).toBe(scene("a"));

    const { trashedTo } = await store.remove("Final");
    expect((await store.list()).files).toEqual([]);
    expect((await store.list()).lastOpened).toBeNull();
    const trashed = memPaths(root).filter((p) => p.startsWith(trashedTo));
    expect(trashed).toContain(`${trashedTo}/Final.excalidraw`);
    expect(trashed.some((p) => p.startsWith(`${trashedTo}/history/`))).toBe(
      true,
    );
    expect(memPaths(root)).not.toContain(".excalidraw-local/history/Final");
  });

  it("tracks recently opened canvases through renames and deletes", async () => {
    await store.create({ name: "A", content: scene("a") });
    await store.create({ name: "B", content: scene("b") });
    await store.create({ name: "C", content: scene("c") });
    await store.setLastOpened("A");
    expect((await store.list()).recent).toEqual(["A", "C", "B"]);

    await store.rename("C", "Z");
    expect((await store.list()).recent).toEqual(["A", "Z", "B"]);

    await store.remove("A");
    const listing = await store.list();
    expect(listing.recent).toEqual(["Z", "B"]);
    expect(listing.lastOpened).toBeNull();
  });

  it("rejects names that escape the folder", async () => {
    await expect(store.read("../secrets")).rejects.toMatchObject({
      status: 400,
    });
  });

  it("reports missing canvases as 404", async () => {
    await expect(store.read("Nope")).rejects.toMatchObject({ status: 404 });
    await expect(
      store.save({ name: "Nope", content: scene("a") }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("exports every canvas", async () => {
    await store.create({ name: "A", content: scene("a") });
    await store.create({ name: "B", content: scene("b") });
    const files = await store.exportAll();
    expect(files.map((f) => f.name).sort()).toEqual([
      "A.excalidraw",
      "B.excalidraw",
    ]);
  });
});

describe("zip export", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("writes a well-formed stored zip", () => {
    const zip = createZip([
      { name: "A.excalidraw", content: "{}" },
      { name: "Bé.excalidraw", content: "[1]" },
    ]);
    const view = new DataView(zip.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    const end = zip.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
    // central directory offset points at the first central entry
    const centralOffset = view.getUint32(end + 16, true);
    expect(view.getUint32(centralOffset, true)).toBe(0x02014b50);
  });
});

describe("install prompt", () => {
  const base = {
    runningAsApp: false,
    embedded: false,
    snoozedAt: null,
    now: 0,
  };

  it("shows in a browser tab, not in the installed app or an embed", () => {
    expect(shouldShowInstallPrompt(base)).toBe(true);
    expect(shouldShowInstallPrompt({ ...base, runningAsApp: true })).toBe(
      false,
    );
    expect(shouldShowInstallPrompt({ ...base, embedded: true })).toBe(false);
  });

  it("stays hidden while snoozed", () => {
    const snoozedAt = 1_000;
    expect(
      shouldShowInstallPrompt({ ...base, snoozedAt, now: snoozedAt + 1 }),
    ).toBe(false);
    expect(
      shouldShowInstallPrompt({
        ...base,
        snoozedAt,
        now: snoozedAt + INSTALL_PROMPT_SNOOZE + 1,
      }),
    ).toBe(true);
  });
});
