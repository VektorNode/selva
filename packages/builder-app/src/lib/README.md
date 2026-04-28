# builder-app `src/lib/` layout

Quick reference for what lives where. The repo-wide rules are in [STRUCTURE.md](../../../../STRUCTURE.md) — this file just documents the builder-specific shape.

| Folder | Contents |
|---|---|
| `components/<feature>/` | Svelte components for a feature (e.g. `components/builder/` holds the schema designer UI). |
| `features/<feature>/` | Pure TypeScript logic for the same feature — operations, config, types. **No Svelte.** UI imports from logic, never the reverse. |
| `composables/` | Reactive helpers (`.svelte.ts` files using runes). |
| `stores/` | Global reactive state that isn't tied to a single feature. |
| `websocket/` | Builder-specific WebSocket bridge to the Grasshopper plugin. |
| `utils/` | Generic helpers (no domain assumptions). |
| `app.config.ts` | App-level constants (port, dev URLs, etc.). |

## Why `features/` and `components/` are split

The `builder` and `preview` features both have logic *and* UI. Keeping them in separate folders means:

- The TypeScript in `features/builder/` is consumed by tests and other TS modules without ever loading a Svelte runtime.
- Components in `components/builder/` import from `features/builder/`, never the reverse.

If you need to add something that's both logic and UI, split it: pure logic into `features/<name>/`, Svelte into `components/<name>/`.
