# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Run all commands from the repo root unless noted. Package manager is **yarn 1.x** (Node >= 18).

```bash
yarn start              # run the web app (excalidraw.com) in dev on Vite
yarn test:typecheck     # tsc, no emit — typechecks the whole monorepo
yarn test:app           # vitest in watch mode
yarn test:app --watch=false      # vitest, single run
yarn test:update        # run all tests once + update snapshots (run before committing)
yarn test:code          # eslint (max-warnings=0)
yarn test:other         # prettier --list-different
yarn test:all           # typecheck + eslint + prettier + tests (the full CI gate)
yarn fix                # auto-fix prettier then eslint
```

Run a single test file or test by name (vitest):

```bash
yarn test:app --watch=false packages/element/src/__tests__/binding.test.ts
yarn test:app --watch=false -t "binds arrow to element"
```

Build the libraries (needed by `examples/`): `yarn build:packages`. Build the app: `yarn build`.

## Monorepo layout

Yarn workspaces: `excalidraw-app`, `packages/*`, `examples/*`. Internal packages import each other via `@excalidraw/*` aliases (resolved by `tsconfig.json` paths and `vitest.config.mts`) — there is **no build step between packages during development**; the aliases point straight at `src`.

Dependency direction (lower may not import higher):

- `@excalidraw/math` — geometry primitives (`Point`, vectors, curves, ellipses). **Always use the `Point` type, never `{ x, y }`.**
- `@excalidraw/common` — constants, keys, colors, utils, event bus, shared types. No app/element deps.
- `@excalidraw/element` — the element model: creation, mutation, bounds, collision, binding, resizing, framing, `Scene`, `Store`, and the delta/history primitives.
- `@excalidraw/excalidraw` — the React editor component published as the npm package. The center of gravity.
- `excalidraw-app/` — the excalidraw.com application (collab, sharing, PWA, persistence). Depends on the library, not vice-versa.
- `examples/` — integration examples (Next.js, browser script). These consume the **built** packages.

`packages/fractional-indexing` and `packages/laser-pointer` are small leaf utilities; `packages/utils` holds exported helper functions for npm consumers.

## Architecture

### The editor is one big stateful component

`packages/excalidraw/components/App.tsx` (~13k lines) is the heart of the editor. It owns canvas rendering orchestration, pointer/keyboard event handling, and the two pieces of state everything else reads:

- **elements** — the array of `ExcalidrawElement`s, the document model.
- **appState** (`packages/excalidraw/appState.ts`, type in `types.ts`) — transient UI/editor state (selection, current tool, zoom/scroll, theme, open dialogs, etc.).

Rendering is canvas-based, not DOM-based. `scene/Renderer.ts` and `renderer/` draw elements to `<canvas>`; React is used for UI chrome (panels, dialogs, menus), not for the drawing surface.

### Elements & the Scene

Elements are plain serializable objects. Never mutate an element field directly — go through the scene so versioning, indices, and re-render stay consistent:

- `scene.mutateElement(...)` / `ExcalidrawImperativeAPI.mutateElement` — in-place mutation that bumps the element's version (`packages/element/src/mutateElement.ts`).
- `newElementWith(...)` — immutable copy with changes.
- `Scene` (`packages/element/src/Scene.ts`) is the source of truth for the element set, spatial lookups, and frame/group relationships.

Elements have **fractional indices** (`fractionalIndex.ts` + `@excalidraw/fractional-indexing`) for stable z-ordering that survives concurrent edits.

### Actions

Editor commands (anything triggered by a menu item, shortcut, or context menu) are **Actions**, registered via `register(...)` (`packages/excalidraw/actions/register.ts`) and dispatched through the action manager (`actions/manager.tsx`). An action declares `name`, a `perform(elements, appState, ...)` that returns the next elements/appState, optional `keyTest` for shortcuts, and an optional `PanelComponent` for UI. Add new editor behavior here rather than wiring logic directly into `App.tsx` when possible.

### State changes, deltas, history & collaboration

- `Store` (`packages/element/src/store.ts`) captures snapshots and emits **deltas** (`delta.ts`: `ElementsDelta`, `AppStateDelta`).
- `history.ts` (in `packages/excalidraw`) implements undo/redo on top of those deltas.
- The same delta machinery underpins real-time collaboration in `excalidraw-app/collab/` — peers exchange and apply deltas; the app layer adds end-to-end encryption and Firebase/socket transport. The library itself is collaboration-agnostic.

### The app layer (`excalidraw-app/`)

Wraps the `<Excalidraw>` component and adds: collaboration (`collab/`), shareable encrypted links (`share/`, `data/`), local-first persistence (IndexedDB autosave), PWA, and Sentry. State glue uses **jotai** (`app-jotai.ts`; the library has its own `editor-jotai.ts`).

## Conventions

- TypeScript everywhere; `strict` is on. Prefer immutable data (`const`, `readonly`) and allocation-free / RAM-over-CPU implementations on hot paths (rendering, collision, geometry).
- Functional React components with hooks; CSS via `.scss` modules colocated with components. PascalCase components/types, camelCase values, ALL_CAPS constants.
- When writing math-related code, reference `packages/math/src/types.ts` and use `Point`, not `{ x, y }`.
- Tests are vitest + jsdom + `vitest-canvas-mock`, colocated as `*.test.ts(x)` or under `__tests__/`. Many tests rely on snapshots — run `yarn test:update` after intentional output changes and review the diff.
