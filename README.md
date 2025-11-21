# ComputeBuilder

A cross-platform Rhino Grasshopper plugin that enables web-based UIs for parametric models using WebSocket communication.

## What It Does

ComputeBuilder lets you:

- **Design custom web UIs** for your Grasshopper definitions using a visual builder
- **Interact in real-time** with parameters through a browser interface
- **Deploy parametric models** to the web with Rhino Compute compatibility

## Quick Start

### Prerequisites

- Rhino 7 (Windows) or Rhino 8 (Windows/macOS)
- .NET SDK (for building)
- Node.js 18+ (for web app)

### Installation

1. **Build and install the plugin:**

```bash
# Build for both Rhino 7 and 8
dotnet build --configuration Release

# Install (Windows - Rhino 8)
copy "bin\Release\net7.0\ComputeBuilder.gha" "%APPDATA%\Grasshopper\Libraries-8\"

# Install (macOS - Rhino 8)
cp bin/Release/net7.0/ComputeBuilder.gha ~/Library/Application\ Support/McNeel/Rhinoceros/8.0/Plug-ins/Grasshopper/Libraries/
```

2. **Start the web server:**

```bash
cd web
npm install
npm run dev
```

3. **Restart Rhino completely**

### Usage

1. In Grasshopper, add contextual parameters (e.g., Number Slider)
2. Add the **UIBuilderComponent** and set `Enable = true`
3. Browser opens automatically to configure your UI
4. Interact with your model through the web interface in real-time

## Architecture

- **Backend:** C# Grasshopper components (.NET multi-target)
- **Frontend:** SvelteKit web application (TypeScript, Tailwind)
- **Communication:** WebSocket (port 8765) for real-time updates
- **Persistence:** Session files + embedded schemas in .gh files

## Documentation

For detailed documentation, see [CLAUDE.md](CLAUDE.md) which includes:

- Complete architecture overview
- Development workflows
- API documentation
- Testing procedures

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.

## License

MIT License - see [LICENSE](LICENSE) for details.
