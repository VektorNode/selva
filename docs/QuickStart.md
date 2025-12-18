# Getting Started

## Prerequisites

- **Node.js** and **pnpm** installed (see `.node-version` for required Node version)
- **Visual Studio or Rider** (for C# plugin development)
- **Rhino 8**

## Initial Setup

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Build all packages:
   ```bash
   pnpm run build:all
   ```

## Development

### Builder App

To run the builder app in development mode:

1. Start the C# application in Visual Studio or Rider (debug mode)
2. Run the frontend in another terminal:
   ```bash
   cd packages/builder-app
   pnpm run dev
   ```

**Note:** The initial page load may take a while as the frontend compiles.

### Compute App

The compute-app provides Grasshopper computation via Rhino.Compute.

#### Configuration

1. Create a `.env` file in `packages/compute-app/` (use the provided example env file)
2. Configure the environment variables:
   - For **local development**: Point to your local Rhino.Compute instance
   - For **hosted Rhino.Compute**: Provide the API key and endpoint

#### Full Feature Setup

To use all features:

1. Install the [Selva plugin](../Plugin/) in Rhino or link in Grasshopper.Developper settings
2. Set up the custom [Rhino.Compute fork](https://github.com/VektorNode/compute.rhino3d.git):
   ```bash
   git clone https://github.com/VektorNode/compute.rhino3d.git
   ```
   Follow the setup guide in that repository.

#### Embedding

To generate iframe embed code, use the tool at `examples/embed-code-generator.html`:

use the Live Server to serve the file

## Deployment

### Builder App

Choose an adapter based on your hosting platform:

- **Vercel or Firebase**: Use `adapter-auto`
- **Node.js hosting**: Configure for Node.js adapter (default)

### Compute App

For deploying Rhino.Compute, follow the [official setup guide](https://github.com/VektorNode/compute.rhino3d.git).

## Troubleshooting

- **Frontend loads slowly**: This is normal on first build. Subsequent reloads are faster.
- **Compute-app features missing**: Ensure Rhino.Compute is running and the `.env` is configured correctly.
