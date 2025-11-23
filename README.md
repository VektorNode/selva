# ComputeBuilder

[![npm version](https://img.shields.io/npm/v/@computebuilder/core)](https://www.npmjs.com/package/@computebuilder/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue)](https://www.typescriptlang.org/)
[![Svelte](https://img.shields.io/badge/Svelte-5.0-FF3E00)](https://svelte.dev)
[![.NET](https://img.shields.io/badge/.NET-4.8%2F7.0-512BD4)](https://dotnet.microsoft.com/)

A comprehensive, cross-platform toolkit for building web-based UIs for Rhino Grasshopper parametric models using **Rhino Compute**. ComputeBuilder combines a powerful C# plugin, type-safe TypeScript libraries, and an intuitive web builder to streamline parametric design workflows.

## 🎯 What is ComputeBuilder?

ComputeBuilder enables you to:

- **Build web UIs** for Grasshopper definitions without writing code
- **Deploy parametric models** as interactive web applications
- **Work locally or in the cloud** with Rhino Compute servers
- **Maintain full type safety** across C# and TypeScript layers
- **Visualize 3D geometry** with integrated Three.js viewer

### Key Features

- 🎨 **Visual UI Builder** - Drag-and-drop interface for designing parameter layouts
- 🔌 **Grasshopper Plugin** - Custom components for geometry processing and data export
- 📦 **Type-Safe Libraries** - Full TypeScript support with zero dependencies
- 🌐 **Web Framework** - SvelteKit-based builder and preview system
- 📊 **3D Visualization** - Built-in Three.js integration for geometry display
- ⚡ **Real-Time Communication** - WebSocket support for live parameter updates
- 🚀 **Cloud-Ready** - Deploy to Vercel, Firebase, or self-hosted servers
- 🔄 **Rhino Compute Compatible** - Works with official Rhino Compute servers

## 📦 What's Included

### Packages

| Package                                           | Purpose                                       | Status        |
| ------------------------------------------------- | --------------------------------------------- | ------------- |
| [`@computebuilder/core`](packages/core)           | Type-safe Rhino Compute client library        | ✅ Production |
| [`@computebuilder/svelte-ui`](packages/svelte-ui) | Reusable Svelte components for inputs/outputs | ✅ Production |
| [`@computebuilder/builder`](packages/builder)     | Web UI builder application                    | ✅ Production |
| [`@computebuilder/schemas`](packages/schemas)     | Shared TypeScript/C# type definitions         | ✅ Production |

### Examples

| Example                                               | Purpose                            |
| ----------------------------------------------------- | ---------------------------------- |
| [`svelte-app`](examples/svelte-app)                   | Complete example with all features |
| [`svelte-template-app`](examples/svelte-template-app) | Starter template for new projects  |

### Plugin

| Component                      | Purpose                      |
| ------------------------------ | ---------------------------- |
| [`ComputeBuilder.gha`](Plugin) | Grasshopper plugin (C# .NET) |

## 🚀 Quick Start

### For Web Developers

```bash
# Install the core library
npm install @computebuilder/core

# Use in your project
import { GrasshopperClient } from '@computebuilder/core';

const client = new GrasshopperClient({
  serverUrl: 'https://compute.rhino3d.com',
});

const { inputs, outputs } = await client.getIO(definitionUrl);
```

See [`packages/core/README.md`](packages/core/README.md) for detailed documentation.

### For Designers (Using the Builder)

1. **Install the plugin:**

   ```bash
   dotnet build --configuration Release
   # Copy bin/Release/net7.0/ComputeBuilder.gha to Grasshopper Libraries
   ```

2. **Open the builder:**

   ```bash
   cd packages/builder
   npm install && npm run dev
   ```

3. **Create your UI** - Drag and drop inputs/outputs in the visual editor

### For Full Setup

```bash
# Clone the repository
git clone <repository-url>
cd ComputeBuilder

# Install dependencies
pnpm install

# Build everything
pnpm build

# Start development
pnpm dev
```

## 📚 Documentation

- **[CLAUDE.md](CLAUDE.md)** - Complete architecture and development guide
- **[CONTRIBUTING.md](CONTRIBUTING.md)** - Contribution guidelines and development setup
- **[MONOREPO.md](MONOREPO.md)** - Monorepo structure and workflows
- **[Plugin Overview](Plugin/OVERVIEW.md)** - C# plugin documentation

### Key Documentation by Role

**Web Developers:** Start with [`packages/core/README.md`](packages/core/README.md)

**UI/UX Designers:** See [`packages/builder/README.md`](packages/builder/README.md)

**Plugin Developers:** Check [`Plugin/README.md`](Plugin/README.md)

**Monorepo Contributors:** Read [`MONOREPO.md`](MONOREPO.md)

## 🏗️ Architecture

```
ComputeBuilder
├── Backend (C#)
│   └── Plugin/                    # Grasshopper components
│       ├── Components/            # UI builder, display, IO
│       ├── Utils/                 # Geometry processing
│       └── Models/                # Schema definitions
│
├── Frontend (TypeScript/Svelte)
│   ├── packages/
│   │   ├── core/                  # Rhino Compute client library
│   │   ├── svelte-ui/             # Reusable UI components
│   │   ├── builder/               # Web UI builder app
│   │   └── schemas/               # Shared type definitions
│   │
│   └── examples/                  # Reference implementations
│
└── Communication
    ├── WebSocket (port 8765)      # Real-time updates
    └── Session Files              # Data persistence
```

## 🔌 Communication Flow

```
Grasshopper Plugin ←→ [WebSocket] ←→ Web Browser
                   ←→ [File I/O]  ←→ Disk Storage
```

## ✨ Use Cases

### 1. **Local UI Development**

Use the builder to create interfaces for your Grasshopper definitions and preview them locally.

### 2. **Cloud Deployment**

Deploy web apps to Vercel or Firebase that solve definitions via Rhino Compute servers.

### 3. **Custom Workflows**

Use the core library to build your own applications with Rhino Compute integration.

### 4. **Data Processing**

Export geometry and data from Grasshopper to files or web services.

## 🛠️ Development

### Prerequisites

- **Rhino** 7 (Windows) or 8 (Windows/macOS)
- **.NET SDK** 7.0+
- **Node.js** 18+
- **pnpm** (recommended) or npm

### Common Commands

```bash
# Install all dependencies
pnpm install

# Build all packages
pnpm build

# Start development servers
pnpm dev

# Type checking
pnpm type-check

# Linting
pnpm lint

# Build C# plugin
dotnet build --configuration Release
```

### Project Structure

```
packages/
  ├── core/            # Main TypeScript library
  ├── svelte-ui/       # UI component library
  ├── builder/         # Web application
  └── schemas/         # Type definitions

examples/
  ├── svelte-app/      # Full-featured example
  └── svelte-template-app/  # Starter template

Plugin/               # C# Grasshopper plugin
  ├── Components/
  ├── Utils/
  └── Models/

scripts/              # Utility scripts
```

## 🧪 Testing

See [CONTRIBUTING.md](CONTRIBUTING.md) for testing procedures.

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for:

- Development setup
- Code style guidelines
- Testing requirements
- Pull request process

### Important Rules

- **Never edit generated files** - Always modify `schemas/ui-schema.json` and run `generate-schemas.sh`
- **Type safety first** - Use TypeScript strict mode
- **Document your changes** - Update relevant README files
- **Test thoroughly** - Follow testing checklist before submitting PRs

## 📋 Roadmap

### Implemented ✅

- ✅ Visual UI builder with drag-and-drop
- ✅ Rhino Compute integration
- ✅ Three.js 3D visualization
- ✅ Type-safe client library
- ✅ Real-time WebSocket communication
- ✅ Cross-platform plugin (Windows/macOS)

### Planned 🚀

- 🚀 Advanced chart components
- 🚀 Multi-user collaboration
- 🚀 Schema versioning and migration
- 🚀 Authentication providers
- 🚀 Performance analytics dashboard
- 🚀 Custom component marketplace

## 📦 Installation

### From npm

```bash
npm install @computebuilder/core
npm install @computebuilder/svelte-ui
```

### From Source

```bash
git clone <repository-url>
cd ComputeBuilder
pnpm install
pnpm build
```

##
