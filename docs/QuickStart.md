# Getting Started

## Prerequisites

- **Node.js** and **pnpm** (see `.node-version` for required version)
- **Visual Studio or Rider** (for C# plugin development)
- **Rhino 8**

## Initial Setup

```bash
pnpm install
pnpm run build:all
```

## Development

### Builder App (local Grasshopper connection)

1. Start the C# plugin in Visual Studio/Rider (debug mode)
2. In a separate terminal:
   ```bash
   cd packages/builder-app
   pnpm run dev
   # http://localhost:5173
   ```

### Compute App (Rhino.Compute cloud mode)

1. Copy the env template:
   ```bash
   cp packages/compute-app/.env.example packages/compute-app/.env
   ```
   Pick a backend provider and fill in its vars — see [selva-local-provider](../packages/local-provider/README.md) (default) or [@selva/supabase-provider](../packages/supabase-provider/README.md).
2. Install the [Selva plugin](../Plugin/) and set up the [custom Rhino.Compute fork](https://github.com/VektorNode/compute.rhino3d.git).
3. After the app is running, open `/admin/compute` and register your Rhino.Compute server URL (and optional API key).

```bash
cd packages/compute-app
pnpm run dev
```

## Deployment

- **Builder App**: Use `adapter-auto` (Vercel/Firebase) or Node.js adapter
- **Compute App**: See the [deployment guides](./deployment/compute-app/README.md)

## Troubleshooting

- **Frontend loads slowly on first build** — normal, subsequent reloads are faster
- **Compute-app features missing** — verify Rhino.Compute is running and `.env` is configured
