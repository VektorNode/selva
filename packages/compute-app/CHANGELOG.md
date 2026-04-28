# @selvajs/compute-app

## 0.9.0

### Patch Changes

- Updated dependencies
  - @selvajs/ui@0.9.0

## 0.8.4

### Patch Changes

- Refactor: extract solve/state logic into self-contained `ComputeApp` component
  - Add `ComputeApp.svelte` to `@selvajs/ui` — wraps all solve logic, throttling, solving indicator, definition switching, embed mode, custom primary color, and footer registration into one component
  - Add `showSaveButton`, `showLoadButton`, `stateManagerActions` props to `ComputeApp` and `AppLayout` for flexible state manager configuration
  - Add optional `header` and `children` snippets to `ComputeApp` for custom nav/layout
  - Extract `ActionButton` type to `shared/types/actionButton.ts` and `SolveFn`/`SolveResult` to `shared/types/solveFn.ts`
  - Move `hexToOklch` color utility from compute-app to `@selvajs/ui`
  - Slim `compute-app/+page.svelte` from ~280 lines to ~58 lines

- Updated dependencies
  - @selvajs/ui@0.8.4

## 0.8.3

### Patch Changes

- Updated dependencies
  - @selvajs/ui@0.8.3
