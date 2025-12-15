# Copilot Instructions for Selva

## Project Overview

Selva is a cross-platform Rhino Grasshopper plugin with a SvelteKit web UI. It uses a dual-stack architecture:

- **Backend**: C# (.NET multi-target: net48/net7.0)
- **Frontend**: SvelteKit with TypeScript + Tailwind CSS
- **Communication**: WebSocket (port 8765) + embedded HTTP server

## Code Style

- Write self-documenting code; add comments only for complex logic
- Keep code simple; avoid premature abstractions
- Only add error handling at system boundaries (user input, external APIs)

## Performance Notes

- Three.js is lazy-loaded only when 3D viewer is enabled
- `rhino-compute-core` is dynamically imported when needed
- Use `@lucide/svelte` for all icons (tree-shakeable, no duplicates)
- Prefer consolidating utilities over creating new abstractions

## Deployment

Production builds create **fully self-contained** .gha files:

- All web assets embedded as `EmbeddedResource`
- No external dependencies or web server needed
- LocalWebServer auto-allocates HTTP port at runtime
- Single .gha file for distribution
