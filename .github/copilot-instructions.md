# Copilot Instructions for Selva

## Project Overview

Selva is a cross-platform Rhino Grasshopper plugin with a SvelteKit web UI. It uses a dual-stack architecture:

- **Backend**: C# (.NET multi-target: net48/net7.0)
- **Frontend**: SvelteKit with TypeScript + Tailwind CSS

## Code Style

- Write self-documenting code; add comments only for complex logic
- Keep code simple; avoid premature abstractions
- Only add error handling at system boundaries (user input, external APIs)
