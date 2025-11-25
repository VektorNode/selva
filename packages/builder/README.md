# Selva Web App

SvelteKit web application for Selva - provides visual UI builder and interactive preview for Grasshopper parametric models.

## What It Does

- **Schema Builder** (`/builder`) - Drag-and-drop interface for designing UIs
- **Interactive Preview** (`/preview`) - Real-time parameter control via WebSocket
- **Rhino Compute Demo** (`/app`) - Standalone mode for cloud deployment

## Development

```bash
# Install dependencies
npm install

# Start dev server (http://localhost:5173)
npm run dev

# Type checking
npm run check

# Build for production
npm run build
```

## Key Features

- Real-time WebSocket communication with Grasshopper
- Three.js 3D geometry viewer
- Tabbed layouts with drag-and-drop configuration
- Rhino Compute compatibility

See the [main README](../README.md) for complete documentation.
