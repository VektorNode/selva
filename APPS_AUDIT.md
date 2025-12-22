# Apps Code Audit: Compute App & Builder App

## Overview

This audit covers the `packages/compute-app` and `packages/builder-app` directories. Both applications are built with SvelteKit and leverage Svelte 5's new reactivity system (Runes).

## 1. Architecture & Structure

### Strengths

- **Modern Svelte Usage**: Both apps extensively use Svelte 5 Runes (`$state`, `$derived`, `$effect`, `.svelte.ts`), resulting in clean and reactive code without the boilerplate of stores.
- **Shared Logic**: Effective use of `@selva/shared` and `@selva/core` packages prevents code duplication for common UI components and core logic.
- **Separation of Concerns**:
  - `compute-app` handles server-side schema fetching via Rhino Compute in `+page.server.ts`.
  - `builder-app` manages local WebSocket communication for real-time updates.

### Areas for Improvement

- **`WebSocketState` Complexity (Builder App)**: The `WebSocketState` class in `builder-app` is becoming a "God Class". It handles connection management, message parsing, state updates, and batching.
  - **Fix**: Split into smaller classes: `WebSocketConnection` (connection/reconnection), `MessageHandler` (parsing/routing), and `UpdateBatcher` (throttling).
- **Environment Configuration**: `compute-app` throws raw errors if environment variables are missing.
  - **Fix**: Create a robust configuration service that validates all env vars on startup and provides helpful error messages or a "Setup Needed" UI page.

## 2. Code Maintainability

### Strengths

- **Composables**: `builder-app` uses composables like `useBuilderState` and `useBuilderActions`, which is a great pattern for organizing logic in Svelte 5.
- **Typed Interfaces**: Good use of TypeScript interfaces for schemas and state.

### Areas for Improvement

- **Loose Typing**:
  - `DragStore` in `builder-app` uses `any` for the `data` property.
  - `compute-app` has `scene`, `camera`, `controls` typed as `unknown | null`.
  - **Fix**: Define proper interfaces for these types to improve type safety and developer experience.
- **Hardcoded Logic**: `compute-app`'s `load` function has hardcoded logic for URL parsing and extension handling.
  - **Fix**: Move URL manipulation logic to a utility function in `@selva/core` or `lib/utilities`.

## 3. Performance & Efficiency

### Strengths

- **Dynamic Imports**: `compute-app` dynamically imports `@selva/core` for the viewer (`await import('@selva/core')`), which reduces the initial bundle size.
- **Batching**: `WebSocketState` implements update batching (`BATCH_DELAY_MS`), which is crucial for performance when dragging sliders.

### Areas for Improvement

- **Reactivity Chains**: In `compute-app`, the initialization logic uses `$effect` with `setTimeout` to trigger the initial solve. This "effect chaining" can lead to race conditions and hard-to-debug timing issues.
  - **Fix**: Use SvelteKit's `onMount` or derived state to trigger the initial solve more deterministically, or handle it in the `load` function if possible.

## 4. Best Practices

### Strengths

- **Svelte 5 Adoption**: Early and correct adoption of Runes shows a forward-thinking approach.
- **Server-Side Loading**: `compute-app` correctly uses `+page.server.ts` to fetch initial data, ensuring the page has content on first load (SSR).

### Areas for Improvement

- **Error Handling**:
  - `compute-app` returns a generic 503 error if Rhino Compute is down.
  - **Fix**: Implement a dedicated error page or component that guides the user on how to check their Rhino Compute connection.
- **Magic Strings**: Event names like `'valueUpdate'`, `'solvingState'` are hardcoded strings.
  - **Fix**: Define these as constants or an enum (e.g., `WebSocketEvents`) to prevent typos and enable refactoring.

## Action Plan

1.  **Refactor `WebSocketState`**: Break it down into focused classes.
2.  **Strengthen Types**: Replace `any` and `unknown` with concrete types in `DragStore` and Viewer logic.
3.  **Stabilize Initialization**: Refactor `compute-app`'s initialization logic to avoid `setTimeout` inside `$effect`.
4.  **Centralize Constants**: Move event names and configuration keys to a shared constants file.

## Summary

Both applications are well-architected and use modern Svelte features effectively. The main areas for improvement are breaking down large classes in `builder-app` and improving type safety and initialization stability in `compute-app`.
