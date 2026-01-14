# Codebase Audit Report: `packages/core`

**Date:** 14 January 2026
**Scope:** `packages/core` (Selva Core SDK)

## 1. Executive Summary

The codebase demonstrates a high level of maturity, employing a clean, feature-sliced architecture that effectively separates domain logic (`core`, `features/grasshopper`) from presentation and utility layers (`features/visualization`). The project configuration strictly adhering to modern standards (ESLint, Vitest, tsup) indicates a focus on long-term maintainability. However, there are localized areas of technical debt, specifically regarding loose type definitions (`any`) and minor inconsistencies in error handling that should be addressed before major scaling.

## 2. Architecture & Maintainability

### Strengths

- **Feature Isolation:** The directory structure is logical and scalable. Features like `grasshopper` and `visualization` are self-contained with their own internal `types`, `io`, and logic.
- **Tree-Shaking Friendly:** `src/features/visualization` is completely decoupled from the main core logic. Simply importing `selva/core` does not drag in heavy 3D dependencies types like `three`, which is critical for bundle size optimization.
- **Abstraction:** The separation between `GrasshopperClient` (HTTP transport) and `Compute` (stateless logic) is excellent. It allows for easier testing and potential future transport layer swaps.

### Areas for Improvement

- **`input-parsers.ts` Complexity:** The generic parsing logic attempts to handle both array and scalar inputs in a unified way. While DRY, this adds cognitive load and makes debugging specific input edge cases harder.

## 3. Code Quality & Best Practices

### Strengths

- **Modern Tooling:**
  - **Build:** `tsup.config.ts` properly externalizes peer dependencies (`three`, `jszip`), ensuring the library doesn't bundle common large dependencies.
  - **Testing:** `vitest` is correctly configured with alias support and coverage.
- **Naming:** Consistent conventions (`kebab-case` files, `PascalCase` classes) make navigation intuitive.

### Technical Debt (High Priority)

- **`any` Usage:** Strict TypeScript is generally enforced, but there are leaks:
  - `src/features/grasshopper/types/parameters.ts`: Methods `getValueByParamName` and `getValueByParamId` return `any`, bypassing type safety.
  - `src/features/grasshopper/types/trees.ts`: `DataTreeDefault` defaults its generic to `any`.
- **Polyfills:** `src/features/file-handling/handle-files.ts` uses `Blob` directly. While widely supported, ensure the target environment (Node < 18 vs Node 18+) is formalized in `engines` to guarantee availability.

## 4. Reliability & Production Readiness

### Strengths

- **Robust Error Handling:** The usage of `BaseError` in `src/core/errors` is excellent. It provides context, causes, and error codes (e.g., mapping HTTP 403 to `forbidden`).
- **Performance:** `src/features/visualization/webdisplay/mesh-compression.ts` utilizes `WebWorker` logic effectively to prevent main-thread blocking during decompression.

### Weaknesses

- **Inconsistent Error Throwing:**
  - In `src/features/file-handling/handle-files.ts`, file extraction failures throw a generic JavaScript `Error` instead of the project's standard `BaseError` or `SelvaError`. This makes catching and handling this specific failure difficult for consumers.
- **Swallowed Errors:** Some catch blocks in visualization parsers log errors but may return partial states without clearly notifying the consumer API.

## 5. Actionable Recommendations

| Priority   | Category       | Action                                                                                          | Files                                    |
| :--------- | :------------- | :---------------------------------------------------------------------------------------------- | :--------------------------------------- |
| **High**   | Types          | Replace `any` return types with `unknown` or a generic constrained type to force safety checks. | `grasshopper/types/parameters.ts`        |
| **Medium** | Error Handling | Refactor `handle-files.ts` to throw a specific `FileHandlingError` extending `BaseError`.       | `features/file-handling/handle-files.ts` |
| **Medium** | Documentation  | Address TODO comments regarding missing examples.                                               | `src/threejs.ts`                         |
| **Low**    | Refactor       | simplify generic logic in parsers if new input types are added.                                 | `grasshopper/io/input/input-parsers.ts`  |
