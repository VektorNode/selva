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

1. Create a `.env` file in `packages/compute-app/` from the example env file
2. Set `COMPUTE_SERVER_URL` to your Rhino.Compute instance
3. Install the [Selva plugin](../Plugin/) and set up the [custom Rhino.Compute fork](https://github.com/VektorNode/compute.rhino3d.git)

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
