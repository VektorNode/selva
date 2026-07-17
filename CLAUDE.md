# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Selva is a cross-platform Rhino Grasshopper plugin with a SvelteKit web UI for building Grasshopper-driven web applications. It uses a dual-stack architecture:

- **Backend**: C# (.NET multi-target: net48/net7.0/net9.0) - Grasshopper plugin
- **Frontend**: SvelteKit with TypeScript + Tailwind CSS
- **Communication**: WebSocket (port 8765) + embedded HTTP server

## Repository Structure

Monorepo with two stacks: `packages/` (TypeScript/Svelte workspace) and `Plugin/` (.NET / Grasshopper). [STRUCTURE.md](./STRUCTURE.md) is authoritative for folder layout, naming, and per-package conventions — read it before adding files.

## Common Development Commands

### JavaScript/TypeScript

```bash
# Install dependencies (required first step)
pnpm install

# Development servers
pnpm dev                    # Start plugin-ui dev server (http://localhost:5173)
pnpm dev:selva              # Start the Selva app (deployable) dev server

# Build commands (orchestrated by Turborepo — see docs/Turborepo.md)
pnpm build                  # Build every package in dep order, with caching
pnpm build --filter=@selvajs/selva           # Build one package + its deps
pnpm run build:plugin-ui    # Build plugin-ui + its deps
pnpm run build:selva        # Build the Selva app + its deps
pnpm run build:plugin       # Build production plugin with embedded web assets

# Type checking and linting
pnpm check                  # svelte-check across the workspace (turbo)
pnpm type-check             # tsc --noEmit across the workspace (turbo)
pnpm lint                   # ESLint at the repo root (not via turbo)
pnpm lint:fix               # Fix linting issues
pnpm format                 # Format code with Prettier
pnpm format:check           # Check formatting

# Testing
pnpm test                   # vitest run across packages that have tests (turbo)
cd packages/providers/local && pnpm test:watch    # Watch mode in one package

# Schema generation (run after modifying ui-schema.json)
pnpm generate                                      # turbo run generate
cd packages/schemas && pnpm run generate:all       # Or directly
cd packages/schemas && pnpm run generate:ts     # Generate TypeScript only
cd packages/schemas && pnpm run generate:cs     # Generate C# only

# Clean and reinstall
pnpm clean                  # Remove node_modules, .svelte-kit, and pnpm-lock.yaml
pnpm rebuild                # clean + install + build

# Testing a single in-repo package
cd packages/compute && pnpm test           # @selvajs/compute suite (~800 tests)
cd packages/server && pnpm test            # @selvajs/server (limits, SSRF guard, rate-limit, ...)
```

### .NET (Plugin)

```bash
cd Plugin

# Build
dotnet build                                    # Debug build
dotnet build --configuration Release            # Release build

# Test
dotnet test                                     # Run all tests
dotnet test --filter "FullyQualifiedName~SchemaMigrator"  # Run specific tests

# Clean
dotnet clean
```

## Architecture

### Type Safety End-to-End

A single schema (`packages/schemas/ui-schema.json`) generates both TypeScript types for the UI and C# types for the plugin, keeping the entire system in sync.

**Generated files:**

- TypeScript: `packages/schemas/src/generated/schema.ts`
- C#: `Plugin/Selva.Schema/Models/UISchema.Generated.cs`

After modifying `ui-schema.json`, always run:

```bash
cd packages/schemas && pnpm run generate:all
```

### Web Application Modes

The web application supports two runtime modes:

1. **Local Mode (`@selvajs/plugin-ui`)**: Drag-and-drop schema designer connected to Grasshopper via WebSocket. Embedded into `Selva.gha` and served from the plugin's local HTTP port at runtime; runs against the dev server during development with hot reload.
2. **Cloud Mode (`@selvajs/selva`)**: Standalone web app that solves Grasshopper definitions through Rhino.Compute. Used for production deployments — installed via `@selvajs/cli`.

### Production Build Process

The production build creates a **fully self-contained** `.gha` file:

1. Builds `@selvajs/plugin-ui` web assets
2. Copies built assets to `Plugin/Selva.GH/EmbeddedAssets/web/`
3. Embeds all web assets as `EmbeddedResource` in the plugin
4. Builds multi-targeted plugin (net48 + net7.0 for Rhino 8, net9.0 for Rhino 9)

Output: Single `.gha` file with no external dependencies. The LocalWebServer auto-allocates an HTTP port at runtime.

```bash
pnpm run build:plugin
```

### Development Workflow

**Recommended**: Web + Plugin in Dev Mode

Terminal 1:

```bash
cd packages/plugin-ui && pnpm dev
# Web app runs on http://localhost:5173
```

Terminal 2:

```bash
cd Plugin && dotnet build
# Then run in Visual Studio, Rider, or VS Code
# Plugin auto-connects to dev server via WebSocket (port 8765)
```

Benefits: Hot reload on web changes, debug plugin in IDE, fast iteration.

### Grasshopper Plugin Components

Located in `Plugin/Selva.GH/Features/`:

- **UIBuilder** - `UIBuilderComponent` for schema linking and WebSocket communication
- **Display** - `ThreeMaterial` for 3D web visualization configuration
- **FileIO** - `DataToFile`, `BlockToFile` for geometry export
- **ComputeIO** - `ValueListData`, `GetValueList` for interactive selections

### Core Package Architecture (`@selvajs/compute`)

In-repo at `packages/compute` (published to npm as `@selvajs/compute`). Modular exports for tree-shaking:

- Main export: General utilities and types
- `/grasshopper`: Rhino Compute client, data tree handling, input/output parsers
- `/visualization`: Three.js helpers, WebDisplay utilities
- `/files`: File handling utilities
- `/core`: Low-level compute fetch and error handling

Key features:

- Discriminated unions for type-safe error handling
- Data tree parsing and serialization
- Three.js geometry conversion helpers
- Browser and Node.js compatible

## Code Style

- Write self-documenting code; add comments only for complex logic
- Keep code simple; avoid premature abstractions
- Only add error handling at system boundaries (user input, external APIs)
- Section headers use the format: `// ============================================================================` with title between two lines of equals signs

## Installation to Grasshopper

After building the plugin, copy to your Grasshopper Libraries folder:

**Windows (Rhino 8):**

```bash
copy "Plugin\bin\Release\net7.0\Selva.gha" "%APPDATA%\Grasshopper\Libraries-8\"
```

**macOS (Rhino 8):**

```bash
cp Plugin/bin/Release/net7.0/Selva.gha ~/Library/Application\ Support/McNeel/Rhinoceros/8.0/Plug-ins/Grasshopper/Libraries/
```

Restart Rhino completely after installation.

## Data Privacy & Compliance

**Selva minimizes the personal data it holds, but it does hold some — and the operator is the data controller.** Whoever deploys Selva is responsible for data residency, retention, and responding to erasure requests. This section states what is actually stored; do not describe Selva as having "zero exposure" to data-protection law.

**What Selva stores in every deployment:**

- Opaque session tokens (in cookies)
- User id + permissions (authorization data)
- Display names (`user_profiles.display_name`)
- Invite email addresses (`invites.email`) — retained after an invite is accepted or expires
- Audit-event payloads (`audit_events.data`), which embed an email for `invite.created` (see the `DomainEvent` union in `packages/platform/src/events/interface.ts`)
- Solve telemetry (`solve_metrics`), keyed by `actor_id` and deliberately **not** FK-cascaded, so it survives deletion of the definition or user it refers to

**How much the auth provider owns depends on which provider you run:**

- **Supabase provider** — credentials and identity live in Supabase `auth.users`; Selva holds only the authorization data above. This is the case the "provider owns it" framing describes.
- **Local provider** — **Selva _is_ the auth provider.** `auth-users.json` stores email addresses and PBKDF2 password hashes on the deployment's own disk (`packages/providers/local/src/auth/users.ts`). No third party is involved, and no credential isolation claim applies.

**Erasure (audit P1 — mostly closed):** `SupabaseDataProvider.onUserDeleted(ctx, userId, { email })` now scrubs the personal data that FK cascade does not reach: it deletes `audit_events` the user authored (keyed by plain-text `actor_id`), deletes `invites` addressed to their email, redacts that email out of surviving `invite.created` audit payloads (via the `redact_audit_event_email` function), and anonymizes `solve_metrics` by tombstoning `actor_id` to `'deleted'` (the row survives for capacity/billing aggregates; the person does not). The admin delete handler captures the email before `deleteUser` and passes it through. **Remaining gap:** there is still no _time-based_ retention policy on `audit_events` or `solve_metrics` (rows live forever until a subject is erased). Deletion-triggered erasure is closed; scheduled retention is not.

Login IPs are processed by the rate limiter but stay in-memory, expire within the rate-limit window, and are never persisted.

**Logs are an escape hatch that erasure cannot follow.** `onUserDeleted` scrubs rows; it has no reach into stdout, which on a real deployment has already shipped to a collector and may be indexed by a third party. So a log line carrying personal data outlives every erasure guarantee above. Do not log a whole domain object — an `invite.created` payload embeds the invitee's email, and `console.error('...', { event })` was silently copying it to stdout until 2026-07-17. Log identifiers (`eventType`, `actorId`, `userId`), never payloads. The pino redaction list (`packages/server/src/logging/PinoLogger.ts`) scrubs by **credential field name** (`token`, `apiKey`, …) and will NOT catch an email nested in a payload — it's a backstop for accidents, not a licence to log objects.

## Requirements

- [pnpm](https://pnpm.io) >= 10.0.0 (Node.js package manager — version pinned in `packageManager`, activated via Corepack)
- Node.js >= 22.0.0
- .NET SDK 7.0+ (for plugin development)
- Rhino 8 or 9 (for using the plugin — Rhino 7 is not supported)
- Rhino.Compute server — the [VektorNode fork](https://github.com/VektorNode/compute.rhino3d) is required for block instance support

## Environment Variables

The authoritative reference is [packages/selva/.env.example](packages/selva/.env.example) — every var the Selva app reads (provider, tenancy, flags, secrets, optional server config) is documented inline there. Don't duplicate that documentation here or in provider READMEs; link to `.env.example`.

The plugin UI needs no env vars (WebSocket on port 8765 by default).

Rhino.Compute server URL + API key are configured in `/admin/compute` and persisted via `IComputeServerStore` — not env vars.

### Platform Package (`@selvajs/platform`)

Pluggable provider interfaces (auth, data stores, storage, permissions, access rules) with Zod schemas. Granular exports for tree-shaking — see [packages/platform/src/](packages/platform/src/) for the module list. `@selvajs/local-provider` is the filesystem-backed implementation (HMAC sessions, atomic-write JSON, WebP image transcoding).

## Issues

When creating issues, use the templates in [.github/ISSUE_TEMPLATE/](/.github/ISSUE_TEMPLATE/)
