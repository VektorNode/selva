[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9+-blue)](https://www.typescriptlang.org/)
[![Svelte](https://img.shields.io/badge/Svelte-5.0-FF3E00)](https://svelte.dev)
[![.NET](https://img.shields.io/badge/.NET-4.8%2F7.0%2F9.0-512BD4)](https://dotnet.microsoft.com/)

# Selva

**Your workflow, everyone's tool.**

A handful of specialists build the Grasshopper definition; the rest of the company needs what it produces, not the canvas. Selva puts a web UI and live 3D in front of it, so your team gets a link instead of the file — with a live schema designer, browser visualization, and self-hosted solving via Rhino.Compute.

## What you get

- **Schema designer**: drag-and-drop UI builder mapping Grasshopper params to web controls
- **Live WebSocket link**: edit the web UI against a running Rhino, with hot reload
- **3D viewer**: Grasshopper geometry rendered in the browser via Three.js
- **Cloud deployment**: standalone apps that solve through Rhino.Compute; end users need no Rhino
- **Type-safe end to end**: one schema generates both the TypeScript and C# types
- **Single-file plugin**: one `.gha` with the web assets embedded

## Selva Canopy

[Selva Canopy](https://www.food4rhino.com/en/app/selva-canopy) is a companion Grasshopper plugin adding components for geometry processing and data preparation.

## Packages

| Package                                                              | Description                                                                     |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [`plugin-ui`](./packages/plugin-ui/README.md)                        | Grasshopper plugin UI: schema designer + preview, embedded into `Selva.gha`     |
| [`selva`](./packages/selva/README.md)                                | Standalone solver app for cloud deployment via Rhino.Compute                    |
| [`ui`](./packages/ui/README.md)                                      | Svelte layer over the cores: compute-app SDK, viewer shell, design system       |
| [`schemas`](./packages/schemas/README.md)                            | Schema definitions and TypeScript/C# code generators                            |
| [`compute`](./packages/compute/README.md)                            | Type-safe Rhino.Compute client and data-tree helpers; no renderer, no `three`   |
| [`visualization`](./packages/visualization/README.md)                | Headless viewer core over Three.js: parse, render, and scene layers             |
| [`solve`](./packages/solve/README.md)                                | The solve flow on both sides of the wire: client state machine, server pipeline |
| [`server`](./packages/server/README.md)                              | HTTP request policy: limits, rate limiting, SSRF guard, definition service      |
| [`platform`](./packages/platform/README.md)                          | Provider interfaces (auth, data, storage); no implementations                   |
| [`local-provider`](./packages/providers/local/README.md)             | Filesystem + JSON + HMAC implementation of platform                             |
| [`supabase-provider`](./packages/providers/supabase/README.md)       | Supabase (Auth + Postgres + Storage) implementation of platform                 |
| [`header-auth-provider`](./packages/providers/header-auth/README.md) | Auth-only adapter that trusts reverse-proxy identity headers                    |
| [`cli`](./packages/cli/README.md)                                    | Scaffold and operate a white-label deployment                                   |

Most publish to npm under the `@selvajs/*` scope. `plugin-ui`, `header-auth-provider`, `website`,
and `config` stay internal to the workspace. [STRUCTURE.md](./STRUCTURE.md) is authoritative for the
full folder layout.

## Requirements

- Node.js >= 24.0.0
- pnpm >= 11.0.0 (pinned in `packageManager`, activated via Corepack)
- .NET SDK 7.0+
- Rhino 8 or 9 (Rhino 7 is not supported)
- Rhino.Compute server (the [VektorNode fork](https://github.com/VektorNode/compute.rhino3d) is required for block instance support)

## Quick Start

See [docs/self-hosting/get-started/quick-start.md](./docs/self-hosting/get-started/quick-start.md) for setup and development instructions.

## Commercial services

Selva is MIT-licensed and free to self-host. VektorNode AG offers deployment support, funded
feature development, and training around it, and organisations can sponsor its development;
see [COMMERCIAL.md](./COMMERCIAL.md).

---

[MIT License](./LICENSE) · [Third-party notices](./NOTICE.md) · [Commercial services](./COMMERCIAL.md)
