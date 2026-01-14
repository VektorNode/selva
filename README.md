[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9+-blue)](https://www.typescriptlang.org/)
[![Svelte](https://img.shields.io/badge/Svelte-5.0-FF3E00)](https://svelte.dev)
[![.NET](https://img.shields.io/badge/.NET-4.8%2F7.0-512BD4)](https://dotnet.microsoft.com/)

# Selva

A full-stack toolkit for building Grasshopper-driven web applications. Provides a type-safe TypeScript client for Rhino Compute, Grasshopper components for UI integration, and a web application that runs in both local (WebSocket) and cloud (Rhino.Compute) modes.

**Core Library**

- **`@selva/compute`** — Type-safe Rhino Compute client with discriminated unions, error handling, Three.js helpers, and file/data utilities. Works in browsers and Node.js.

**Web Application**

- **`@selva/builder-app`** — SvelteKit-based UI builder and runtime.
  - **Local Mode:** Drag-and-drop schema designer connected to Grasshopper via WebSocket.

**Grasshopper Plugin**

- **`Selva.gha`** — Components that link Grasshopper parameters to the web stack.
  - `UIBuilderComponent` for schema linking
  - `ThreeMaterial`, `DataToFile`, `ValueListData` for visualization and data output
  - Works with the custom Rhino Compute fork

**Supporting Tools**

- **`@selva/schemas`** — Generates synchronized TypeScript and C# types from a shared schema.

---

## Architecture Overview

1. **Core (`@selva/compute`)**
   Lightweight, dependency-free Rhino Compute client used directly in custom web deployments.

2. **Grasshopper Plugin (`Selva.gha`)**
   Exposes Grasshopper parameters and helpers needed by the web interface.

3. **Web App (`@selva/frontend`)**
   One codebase supporting live local development and cloud deployment.

**Type Safety End-to-End**
A single schema (`packages/schemas/ui-schema.json`) generates both the TypeScript types for the UI and the C# types used by the plugin, keeping the entire system in sync.

---

## Getting Started

Requires the custom Rhino Compute fork:
https://github.com/VektorNode/compute.rhino3d

Full setup and workflow instructions:
[docs/QuickStart.md](./docs/QuickStart.md)

---

## License

[MIT](./LICENSE)
