[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9+-blue)](https://www.typescriptlang.org/)
[![Svelte](https://img.shields.io/badge/Svelte-5.0-FF3E00)](https://svelte.dev)
[![.NET](https://img.shields.io/badge/.NET-4.8%2F7.0%2F9.0-512BD4)](https://dotnet.microsoft.com/)

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

| Package                                                              | Description                                                        |
| -------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [`plugin-ui`](./packages/plugin-ui/README.md)                        | Grasshopper plugin UI — schema designer + preview, embedded into `Selva.gha` |
| [`selva`](./packages/selva/README.md)                                | Standalone solver app for cloud deployment via Rhino.Compute       |
| [`ui`](./packages/ui/README.md)                                      | Shared Svelte components, theme, and utilities                     |
| [`schemas`](./packages/schemas/README.md)                            | Schema definitions and TypeScript/C# code generators               |
| [`platform`](./packages/platform/README.md)                          | Provider interfaces (auth, data, storage) — no implementations     |
| [`local-provider`](./packages/providers/local/README.md)             | Filesystem + JSON + HMAC implementation of platform                |
| [`supabase-provider`](./packages/providers/supabase/README.md)       | Supabase (Auth + Postgres + Storage) implementation of platform    |
| [`header-auth-provider`](./packages/providers/header-auth/README.md) | Auth-only adapter that trusts reverse-proxy identity headers       |
| [`@selvajs/compute`](https://www.npmjs.com/package/@selvajs/compute) | Type-safe Rhino Compute client and Three.js helpers (npm)          |

## Requirements

- Node.js >= 18.0.0
- .NET SDK 7.0+
- Rhino 8 or 9 (Rhino 7 is not supported)
- Rhino.Compute server (the [VektorNode fork](https://github.com/VektorNode/compute.rhino3d) is required for block instance support)

## Quick Start

See [docs/QuickStart.md](./docs/QuickStart.md) for setup and development instructions.

---

[MIT License](./LICENSE)
