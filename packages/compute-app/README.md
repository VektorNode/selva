# @selva/compute-app

Standalone SvelteKit web application for solving Grasshopper definitions via Rhino.Compute. Deployed independently as a cloud-hosted app or self-hosted server.

## Development

```bash
pnpm install
pnpm dev          # http://localhost:5173
```

## Production Build

```bash
export ADAPTER=node
pnpm build
node build/index.js
```

## Configuration

Set environment variables in `.env`:

```env
PORT=3000
ORIGIN=https://your-domain.com
COMPUTE_SERVER_URL=https://your-compute-server
COMPUTE_API_KEY=your-api-key
GH_DEFINITIONS_PATH=/path/to/definitions
BODY_SIZE_LIMIT=Infinity
ADMIN_PASSWORD=your-secure-password
NODE_ENV=production
```

See `example.ecosystem.config.cjs` for PM2 deployment config.

## Related

- [`selva-compute`](../../packages/compute) — Rhino Compute client
- [`@selva/shared`](../shared) — Shared UI components
- [`@selva/builder-app`](../builder-app) — Local development UI designer
