// Canvas names double as file names on disk (`<name>.excalidraw`), so they
// must be safe path segments. Shared by the browser and the dev-server plugin.

export const CANVAS_EXTENSION = ".excalidraw";
export const UNTITLED_NAME = "Untitled";
export const MAX_NAME_LENGTH = 100;

// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARS = /[/\\:*?"<>|\u0000-\u001f]/;

/** Returns an error message, or `null` if the name is usable. */
export const validateCanvasName = (name: string): string | null => {
  const trimmed = name.trim();
  if (!trimmed) {
    return "Name can't be empty";
  }
  if (trimmed !== name) {
    return "Name can't start or end with spaces";
  }
  if (trimmed.length > MAX_NAME_LENGTH) {
    return `Name can be at most ${MAX_NAME_LENGTH} characters`;
  }
  if (FORBIDDEN_CHARS.test(trimmed)) {
    return "Name can't contain any of / \\ : * ? \" < > |";
  }
  if (trimmed.startsWith(".")) {
    return "Name can't start with a dot";
  }
  return null;
};

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export const nameExists = (name: string, existing: readonly string[]) =>
  existing.some((other) => sameName(other, name));

/**
 * Suggests a free name derived from `base`: "Roadmap" -> "Roadmap 2",
 * "Roadmap 2" -> "Roadmap 3", skipping names that already exist.
 * With `allowBase`, returns `base` itself when it is free.
 */
export const nextFreeName = (
  base: string,
  existing: readonly string[],
  { allowBase = false }: { allowBase?: boolean } = {},
): string => {
  if (allowBase && !nameExists(base, existing)) {
    return base;
  }
  const match = base.match(/^(.*?) (\d+)$/);
  const stem = match ? match[1] : base;
  let counter = match ? Number(match[2]) + 1 : 2;
  while (nameExists(`${stem} ${counter}`, existing)) {
    counter++;
  }
  return `${stem} ${counter}`;
};
