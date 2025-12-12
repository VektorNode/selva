# Selva Project - Code Analysis Report

**Date:** December 12, 2025
**Scope:** Full monorepo analysis including C# Plugin, TypeScript packages, and configuration files

---

## Executive Summary

This report provides a comprehensive analysis of the Selva project codebase. The project is a cross-platform Rhino Grasshopper plugin with a web-based UI, consisting of:

- **C# Plugin** (50+ files) - Grasshopper components and WebSocket server
- **@selva/core** - TypeScript library for Rhino Compute
- **@selva/svelte-ui** - Svelte component library
- **@selva/frontend** - SvelteKit web application

### Issue Summary

| Severity | Count | Category |
|----------|-------|----------|
| Critical | 8 | Silent exceptions, type safety, resource leaks |
| High | 15 | Fire-and-forget tasks, missing validation, accessibility |
| Medium | 20+ | Code duplication, inconsistent patterns, configuration |
| Low | 10+ | Dead code, documentation, minor improvements |

---

## Table of Contents

1. [Critical Issues](#1-critical-issues)
2. [C# Plugin Issues](#2-c-plugin-issues)
3. [TypeScript/Svelte Package Issues](#3-typescriptsvelte-package-issues)
4. [Configuration & Build Issues](#4-configuration--build-issues)
5. [Code Duplication](#5-code-duplication)
6. [Best Practices Violations](#6-best-practices-violations)
7. [Testing Gaps](#7-testing-gaps)
8. [Recommendations](#8-recommendations)

---

## 1. Critical Issues

### 1.1 Silent Exception Swallowing (C#)

**Severity:** CRITICAL
**Impact:** Bugs masked, debugging impossible, potential data loss

Empty catch blocks found in 30+ locations across the C# codebase:

| File | Lines | Description |
|------|-------|-------------|
| `GH_UIBuilderComponent.cs` | 65-68, 70-81 | Parameter clearing failures |
| `DocumentEventManager.cs` | 65-68, 77-81, 93-100 | Event subscription failures |
| `WebSocketServer.cs` | 110-113, 291 | WebSocket communication failures |
| `LocalWebServer.cs` | 103-106, 128-131 | HTTP server errors |
| `RhinoDocumentConverter.cs` | 163-165 | File cleanup failures |
| `ThreeMaterialGoo.cs` | 65-67 | Material parsing failures |
| `UISchemaGoo.cs` | 56-58 | Schema parsing failures |

**Example of problematic code:**
```csharp
catch { /* ignore */ }  // Line 66, GH_UIBuilderComponent.cs
```

### 1.2 Type Safety - Widespread `any` Usage (TypeScript)

**Severity:** CRITICAL
**Impact:** No compile-time checks, runtime errors possible

Over 1,280 occurrences of `any` type across TypeScript packages:

| File | Occurrences | Risk |
|------|-------------|------|
| `useBuilderState.svelte.ts` | 6 | WebSocket message handlers untyped |
| `handlers.ts` | 5 | Parameter processing untyped |
| `operations.ts` | 8 | Schema operations use type assertions |
| `viewer.ts` | 8 | 3D viewer data untyped |
| `websocket.svelte.ts` | 1 | Message parsing unsafe |

**Example:**
```typescript
// packages/frontend/src/lib/composables/useBuilderState.svelte.ts:29
function handleInitialData(message: any) { ... }  // No type checking
```

### 1.3 Three.js Version Conflicts

**Severity:** CRITICAL
**Impact:** Runtime type mismatches, potential crashes

| Package | three version | @types/three |
|---------|---------------|--------------|
| @selva/core | peer: >=0.160.0, dev: ^0.179.1 | ^0.179.0 |
| @selva/svelte-ui | peer: >=0.150.0, dev: ^0.170.0 | ^0.170.0 |
| @selva/frontend | ^0.179.1 | (none) |

**Problem:** svelte-ui builds against 0.170.0 types but frontend uses 0.179.1 runtime.

### 1.4 @selva/core Version Mismatch

**Severity:** CRITICAL
**Impact:** Peer dependency warnings, potential resolution failures

- `@selva/svelte-ui` requires `@selva/core: ^1.0.3` as peer dependency
- `@selva/core` package.json declares version `1.0.0`

---

## 2. C# Plugin Issues

### 2.1 Architecture Problems

#### Over-sized Main Component
**File:** `Plugin/Features/UIBuilder/Components/GH_UIBuilderComponent.cs`
**Lines:** 858+

The main component violates Single Responsibility Principle by handling:
- State management
- Event subscriptions
- Communication (WebSocket + HTTP)
- Persistence
- UI interactions
- Cleanup

**Recommendation:** Extract into focused service classes:
- `UIBuilderStateManager`
- `UIBuilderCommunicationService`
- `UIBuilderPersistenceService`

#### Tight Coupling
**File:** `GH_UIBuilderComponent.cs`, lines 284-297

All dependencies directly instantiated without dependency injection:
```csharp
_schemaManager = new SchemaManager(_sessionId);
_valueApplicator = new ValueApplicator();
_valueCollector = new ValueCollector();
_stateManager = new ComponentStateManager();
_communicationHandler = new CommunicationHandler(_sessionId);
```

### 2.2 Resource Management Issues

#### Fire-and-Forget Tasks Without Error Tracking
**Files affected:** `GH_UIBuilderComponent.cs`, `DocumentEventManager.cs`, `SchemaCleanupService.cs`

```csharp
// Line 345, GH_UIBuilderComponent.cs
_ = Task.Run(async () => { ... });  // Exceptions lost

// Line 620
var _ = _communicationHandler.BroadcastMessage(...);  // Result ignored
```

#### Incomplete Dispose Pattern
**File:** `WebSocketServer.cs`, lines 40-50

Missing `protected virtual void Dispose(bool disposing)` pattern.

#### Event Handler Memory Leaks
**File:** `DocumentEventManager.cs`, lines 72-76

Event subscriptions may not be properly unregistered when documents switch.

### 2.3 Concurrency Issues

#### Non-Thread-Safe State Manager
**File:** `ComponentStateManager.cs`, lines 12-15

```csharp
private bool _lastEnable;
private bool _isSolving;
private DateTime _lastStateChangeTime = DateTime.MinValue;
// No synchronization primitives
```

#### Unsafe List Access
**File:** `ValueApplicator.cs`, line 34

```csharp
private readonly List<IGH_ActiveObject> _pendingExpirations = new();
// Accessed from multiple threads without locking
```

### 2.4 Missing Null Checks

| File | Line | Risk |
|------|------|------|
| `ValueApplicator.cs` | 259 | `ghValue` creation could throw |
| `ParameterTypeHelper.cs` | 302 | `Input[0]` access without bounds check |
| `GH_UIBuilderComponent.cs` | 246 | Document used after validation without null check |

### 2.5 Console Output in Production Code

**Locations:**
- `ParameterTypeHelper.cs`: lines 79, 104, 316
- `ValueCollector.cs`: line 320

`Console.WriteLine` should be replaced with proper logging.

---

## 3. TypeScript/Svelte Package Issues

### 3.1 @selva/core Issues

#### Missing Error Type Preservation
**File:** `packages/core/src/features/visualization/threejs/three-initializer.ts`

Contains `// TODO` indicating incomplete implementation.

#### Unsafe Object Operations
**File:** `packages/core/src/core/utils/camel-case.ts`, lines 49-50

```typescript
const value = (obj as any)[key];
(result as any)[camelKey] = options.deep ? camelcaseKeys(value, options) : value;
```

### 3.2 @selva/svelte-ui Issues

#### Prop Drilling
**File:** `packages/svelte-ui/src/lib/InputHandler.svelte`, lines 19, 24, 34

Uses loose `any` types for state:
```typescript
let values = $state<Record<string, any>>({});
let tree: any[] = [];
```

#### Missing Accessibility
- No `aria-label` on form controls
- No `aria-describedby` for error messages
- Missing ARIA roles on accordion groups

### 3.3 @selva/frontend Issues

#### WebSocket Message Handling (High Risk)
**File:** `packages/frontend/src/lib/websocket/websocket.svelte.ts`, lines 240-258

No discriminated union type guards:
```typescript
if (message && typeof message === 'object' && 'type' in message) {
  const msg = message as { type: string; data?: unknown };
  // No validation that msg actually has expected properties
}
```

#### Accessibility Violations

| Component | Issue | Line |
|-----------|-------|------|
| `DraggableItem.svelte` | `tabindex="-1"` on button | 93 |
| `BuilderGroupItem.svelte` | No ARIA roles for drag states | - |
| `AvailableItemList.svelte` | Filter UI lacks accessibility | 76-78 |

---

## 4. Configuration & Build Issues

### 4.1 TypeScript Configuration Inconsistencies

| Package | moduleResolution | Issue |
|---------|------------------|-------|
| tsconfig.base.json | `bundler` | Reference |
| core | inherits | OK |
| svelte-ui | `NodeNext` | **Diverges from base** |
| frontend | `bundler` | OK (overrides .svelte-kit) |

### 4.2 Vite Configuration Errors

**File:** `packages/svelte-ui/vite.config.ts`, line 9

```javascript
external: ['compute-rhino3d', 'fflate', "@svelte/core", 'three']
```

- `@svelte/core` is NOT a valid package (should be `svelte`)
- Missing `rhino3dm`

### 4.3 TSup Unused Externals

**File:** `packages/core/tsup.config.ts`, line 19

```javascript
external: ['three', 'file-saver', 'jszip', 'jszip-utils']
```

`file-saver`, `jszip`, `jszip-utils` are not dependencies - leftover from previous implementation.

### 4.4 pnpm-workspace.yaml Issues

**File:** `pnpm-workspace.yaml`, lines 10-12

```yaml
onlyBuiltDependencies:
  - esbuild
  - '@tailwindcss/oxide'  # NOT in any package.json (Tailwind v4 doesn't use it)
```

### 4.5 Missing Build Type Checks

| Package | Type check in build? |
|---------|---------------------|
| @selva/core | Yes (`pnpm type-check && ...`) |
| @selva/svelte-ui | No |
| @selva/frontend | No |

### 4.6 SvelteKit Adapter in Library

**File:** `packages/svelte-ui/svelte.config.js`

Library package shouldn't have an adapter (only applications need one).

---

## 5. Code Duplication

### 5.1 Identical utils.ts Files

**Files:**
- `packages/frontend/src/lib/utils.ts`
- `packages/svelte-ui/src/lib/utils.ts`

Both files are 100% identical (13 lines):
```typescript
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
// ... identical type definitions
```

**Fix:** Extract to shared package or @selva/core.

### 5.2 Metadata Update Logic Duplication

**Files:**
- `packages/frontend/src/lib/composables/useBuilderState.svelte.ts` (lines 60-134)
- `packages/frontend/src/lib/features/preview/handlers.ts` (lines 51-130)

Same logic for updating nicknames, descriptions, and constraints.

### 5.3 Parameter Filtering Duplication

- `AvailableItemList.svelte` (lines 41-74)
- `useBuilderState.svelte.ts` (lines 85-97)

Similar filtering patterns repeated.

---

## 6. Best Practices Violations

### 6.1 Console Logging in Production

**Total occurrences:** 102 across 36 files

Top offenders:
| File | Count |
|------|-------|
| `websocket.svelte.ts` | 16 |
| `batch-parser.ts` | 12 |
| `compute-server-stats.ts` | 7 |

### 6.2 TODO/FIXME Comments

Unresolved TODO comments in production code:

| File | Line | Comment |
|------|------|---------|
| `SchemaManager.cs` | 102 | `//TODO: properly handle tree inputs` |
| `ThreeMaterial.cs` | 58 | `TODO: CHECK IF I STILL NEED THAT?` |
| `three-initializer.ts` | 101 | `// TODO: Check if thats actually the case` |

### 6.3 @ts-ignore Usage

**File:** `packages/core/src/features/grasshopper/data-tree/data-tree.ts`, line 438

```typescript
// @ts-ignore
```

Should be replaced with proper type handling.

### 6.4 eslint-disable in Generated Code

**File:** `packages/frontend/src/lib/types/generated/schema.ts`, line 1

```typescript
/* eslint-disable */
```

Acceptable for generated code, but should be documented.

### 6.5 Deprecated Test Helper

**File:** `packages/core/tests/helpers/test-data-builders.ts`, line 127

```typescript
* @deprecated Use createInputSchema() for new tests
```

Should be removed if deprecated.

---

## 7. Testing Gaps

### 7.1 Test Coverage

| Package | Test Files | Coverage |
|---------|------------|----------|
| @selva/core | 7 | Partial (utils, parsers) |
| @selva/svelte-ui | 0 | None |
| @selva/frontend | 0 | None |
| Plugin (C#) | 0 | None |

### 7.2 Missing Test Categories

- No integration tests for WebSocket communication
- No E2E tests for builder/preview flows
- No component tests for Svelte components
- No tests for C# plugin functionality

### 7.3 Test Directory Inconsistency

Different naming conventions:
- `__tests__/` (most places)
- `__test__/` (compute-server-stats.test.ts)

---

## 8. Recommendations

### 8.1 Immediate Actions (Critical)

1. **Fix silent exception handling**
   - Add logging to all catch blocks
   - Implement structured logging (ILogger pattern for C#)
   - Create error boundary components in Svelte

2. **Align Three.js versions**
   - Pin all packages to same version (recommend 0.179.x)
   - Update @types/three to match

3. **Fix @selva/core version**
   - Update package.json to 1.0.3
   - Or update svelte-ui peer to accept ^1.0.0

4. **Add type safety to WebSocket handlers**
   - Create discriminated union types for messages
   - Add runtime validation with Zod

### 8.2 High Priority (1-2 weeks)

1. **Refactor GH_UIBuilderComponent**
   - Extract into focused services
   - Implement dependency injection
   - Add proper dispose patterns

2. **Fix build pipeline**
   - Add type-check to all package builds
   - Fix vite.config.ts externals
   - Remove unused tsup externals

3. **Add accessibility**
   - Audit all interactive components
   - Add ARIA attributes
   - Fix keyboard navigation

4. **Extract duplicate code**
   - Create shared utils package
   - Consolidate metadata update logic

### 8.3 Medium Priority (2-4 weeks)

1. **Add structured logging**
   - C#: Implement ILogger pattern
   - TypeScript: Use structured logging library

2. **Add tests**
   - Component tests for svelte-ui
   - Integration tests for WebSocket
   - C# unit tests for services

3. **Fix configuration inconsistencies**
   - Align TypeScript configs
   - Clean up pnpm-workspace.yaml
   - Add prettier-plugin-tailwindcss to root

4. **Resolve all TODOs**
   - Create issues for each TODO
   - Either implement or remove

### 8.4 Low Priority (Ongoing)

1. **Remove console.log statements**
   - Replace with proper logging
   - Use log levels appropriately

2. **Clean up deprecated code**
   - Remove or migrate deprecated helpers
   - Update tests to new patterns

3. **Documentation**
   - Add JSDoc to public APIs
   - Document WebSocket message formats
   - Add architecture diagrams

---

## Appendix: File Reference

### Most Problematic Files

| File | Issues | Priority |
|------|--------|----------|
| `GH_UIBuilderComponent.cs` | 15+ | Critical |
| `useBuilderState.svelte.ts` | 10+ | High |
| `websocket.svelte.ts` | 8+ | High |
| `ValueApplicator.cs` | 6+ | High |
| `handlers.ts` | 5+ | Medium |
| `operations.ts` | 5+ | Medium |

### Generated Report Statistics

- **Files analyzed:** 150+
- **Lines of code reviewed:** ~25,000
- **Issues identified:** 50+
- **Severity breakdown:** 8 critical, 15 high, 20+ medium, 10+ low
