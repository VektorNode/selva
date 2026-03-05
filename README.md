[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9+-blue)](https://www.typescriptlang.org/)
[![Svelte](https://img.shields.io/badge/Svelte-5.0-FF3E00)](https://svelte.dev)
[![.NET](https://img.shields.io/badge/.NET-4.8%2F7.0-512BD4)](https://dotnet.microsoft.com/)

# Selva

Turn Grasshopper into a web application. Build interactive design tools, parametric configurators, and web-based solvers connected to Rhino Grasshopper.

## What You Can Do

- **Design Tools:** Create drag-and-drop schema builders and expose Grasshopper parameters through a web interface
- **Local Development:** Live-edit your web UI while connected to Rhino via WebSocket, with hot reload
- **Cloud Deployment:** Publish standalone web apps that solve Grasshopper definitions through Rhino.Compute
- **3D Visualization:** Render Grasshopper geometry directly in the browser with Three.js
- **Type-Safe:** Full end-to-end type safety between web UI and Grasshopper plugin

## Quick Start

See [docs/QuickStart.md](./docs/QuickStart.md) for setup and development instructions.

**Requirements:**
- Node.js >= 18.0.0
- .NET SDK 7.0+
- Rhino 8
- Custom [Rhino Compute fork](https://github.com/VektorNode/compute.rhino3d)

---

## License

[MIT](./LICENSE)
