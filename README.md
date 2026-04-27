[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9+-blue)](https://www.typescriptlang.org/)
[![Svelte](https://img.shields.io/badge/Svelte-5.0-FF3E00)](https://svelte.dev)
[![.NET](https://img.shields.io/badge/.NET-4.8%2F7.0-512BD4)](https://dotnet.microsoft.com/)

# Selva

Turn Grasshopper definitions into full web applications — with a live schema designer, 3D visualization in the browser, and cloud deployment via Rhino.Compute.

## Features

- **Schema Designer** — Drag-and-drop UI builder that maps Grasshopper parameters to web controls (sliders, dropdowns, number inputs, etc.)
- **Live WebSocket Connection** — Edit your web UI while connected to a running Rhino instance with hot reload
- **3D Viewer** — Render Grasshopper geometry directly in the browser using Three.js
- **Cloud Deployment** — Publish standalone web apps that solve Grasshopper definitions through Rhino.Compute, no Rhino install required for end users
- **Type-Safe End-to-End** — A single schema generates both TypeScript types and C# types, keeping the plugin and UI in sync
- **Embeddable Plugin** — Single `.gha` file with all web assets embedded, no external dependencies

## Selva Canopy

[Selva Canopy](https://www.food4rhino.com/en/app/selva-canopy) is a companion Grasshopper plugin that extends Selva with additional components for geometry processing and data preparation. It integrates directly into the Selva workflow and is available on Food4Rhino.

## Packages

| Package                                                        | Description                                                        |
| -------------------------------------------------------------- | ------------------------------------------------------------------ |
| [`builder-app`](./packages/builder-app/README.md)              | Schema designer connected to Grasshopper via WebSocket (local dev) |
| [`compute-app`](./packages/compute-app/README.md)              | Standalone solver app for cloud deployment via Rhino.Compute       |
| [`shared`](./packages/shared/README.md)                        | Shared Svelte components, theme, and utilities                     |
| [`schemas`](./packages/schemas/README.md)                      | Schema definitions and TypeScript/C# code generators               |
| [`@selvajs/compute`](https://www.npmjs.com/package/@selvajs/compute) | Type-safe Rhino Compute client and Three.js helpers (npm)          |

## Requirements

- Node.js >= 18.0.0
- .NET SDK 7.0+
- Rhino 8
- Custom [Rhino Compute fork](https://github.com/VektorNode/compute.rhino3d)

## Quick Start

See [docs/QuickStart.md](./docs/QuickStart.md) for setup and development instructions.

---

[MIT License](./LICENSE)
