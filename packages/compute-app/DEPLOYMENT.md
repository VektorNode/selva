# Deployment Guide for Selva Compute App

This application is built with [SvelteKit](https://kit.svelte.dev/) and is configured to support both zero-configuration cloud deployments (Vercel, Netlify) and custom server hosting (Node.js, Docker).

## 1. Environment Variables and Definition Strategy

The compute-app uses **environment variables to configure where definitions are hosted**, and **query parameters to switch between definitions**.

### Understanding GH_DEFINITIONS_PATH

This is the recommended approach for managing Grasshopper scripts securely:

```
GH_DEFINITIONS_PATH = ./definitions    (local directory)
User visits:          ?gh=solver-1     (query parameter)
App loads:            ./definitions/solver-1.gh
```

**You can have ONE container serve multiple definitions** by using query parameters:

```
http://yourapp.com/app?gh=solver-1          → loads ./definitions/solver-1.gh
http://yourapp.com/app?gh=parametric-design → loads ./definitions/parametric-design.gh
http://yourapp.com/app?gh=analysis-tool     → loads ./definitions/analysis-tool.gh
```

### Environment Configuration Strategies

Choose the strategy that matches your deployment target:

#### Strategy A: Local Files (Recommended for Security)

Use server-side file access from a local directory. This keeps your scripts private and requires no external storage.

1. Place `.gh` files in the `definitions/` folder.
2. Set `GH_DEFINITIONS_PATH="./definitions"`.
3. (Docker) Map the volume: `- ./definitions:/app/definitions`.

#### Strategy B: Environment Variables (For Remote Definitions)

For cloud deployments or scenarios where you need to fetch definitions from remote servers without exposing URLs to users, use the environment loader.

1. Define environment variables with your definition URLs and metadata (as JSON):
   ```bash
   GH_DEF_SOLVER='{"metadata":{"displayName":"Solver Algorithm","description":"Fast solver","category":"computation"},"url":"https://storage.mycompany.com/solver.gh"}'
   GH_DEF_ANALYSIS='{"metadata":{"displayName":"Analysis Tool","description":"Data analysis","tags":["analysis","data"]},"url":"https://storage.mycompany.com/analysis.gh"}'
   ```
2. Set `DEFINITION_SOURCE="environment"` to use the environment loader
3. **(Docker) Important**: These URLs must be reachable by your Rhino Compute server.

### Required Environment Variables

| Variable                  | Description                                                                   | Example                                          |
| :------------------------ | :---------------------------------------------------------------------------- | :----------------------------------------------- |
| `COMPUTE_SERVER_URL`      | The URL of your Rhino.Compute server where solving happens.                   | `http://host.docker.internal:8081`               |
| `GH_DEFINITIONS_PATH`     | **(Strategy A)** Local path to definitions folder.                            | `./definitions`                                  |
| `DEFINITION_SOURCE`       | **(Strategy B)** Set to `"environment"` to use environment loader.            | `environment`                                    |
| `GH_DEF_*`                | **(Strategy B)** Definition URLs (e.g., `GH_DEF_SOLVER`, `GH_DEF_ANALYSIS`). | `https://storage.mycompany.com/solver.gh`        |
| `COMPUTE_API_KEY`         | (Optional) API Key if your Rhino.Compute server requires authentication.      | `abc-123-secret-key`                             |
| `ORIGIN`                  | (Docker Only) The URL of this app. Prevents CSRF errors.                      | `http://localhost:3000`                          |

### Setting Environment Variables Safely

**In Docker Compose**:

Simply create a `.env` file alongside `docker-compose.yml`:

```bash
COMPUTE_SERVER_URL=http://host.docker.internal:8081
GH_DEFINITIONS_PATH=./definitions
COMPUTE_API_KEY=your-secret-key
```

The `docker-compose.yml` is already configured to automatically load this file using `env_file: .env`. You do not need to modify the compose file.

**Why this matters:**

- Developers copy `.env` from `.env.example` (clear instructions)
- CI/CD systems set variables without editing docker-compose.yml
- Mistakes are caught early with helpful error messages

> **Security Note:** This app uses SvelteKit's `$env/dynamic/private` to read these values at **runtime**. They are kept on the server and never exposed to the client browser.
>
> **Validation:** The application will **fail to start** (exit with error) if these variables are missing. This is a safety feature to prevent deploying a broken configuration.

## 2. Option A: Cloud Deployment (Vercel, Netlify, etc.)

We use `@sveltejs/adapter-auto`, which automatically detects your hosting environment.

1.  **Push to GitHub**: Ensure your code is in a repository connected to your Vercel/Netlify account.
2.  **Configure Project**:
    - **Framework Preset**: SvelteKit (usually auto-detected).
    - **Root Directory**: `packages/compute-app` (since this is a monorepo).
3.  **Set Environment Variables**: In your dashboard settings (e.g., Vercel Project Settings > Environment Variables), add the keys listed above (`COMPUTE_SERVER_URL`, etc.).
4.  **Deploy**: Trigger a deployment.

## 2.5. Multi-Definition Strategy (Single Container, Multiple Scripts)

**Recommended approach**: Deploy ONE container that serves multiple Grasshopper definitions.

### Setup: Docker Compose with Mounted Definitions

Instead of deploying separate containers per definition, mount a folder containing all definitions:

```yaml
# docker-compose.yml
services:
  web:
    build:
      context: ../../
      dockerfile: packages/compute-app/Dockerfile
    container_name: selva-compute-app
    restart: unless-stopped
    ports:
      - '3000:3000'
    env_file: .env
    environment:
      - NODE_ENV=production
      - PORT=3000
      - HOST=0.0.0.0
      - ADAPTER=node
    volumes:
      - ./definitions:/app/definitions # ← Mount local folder
    extra_hosts:
      - 'host.docker.internal:host-gateway'
```

### File Structure

```
packages/compute-app/
├── definitions/
│   ├── solver-1.gh
│   ├── solver-2.gh
│   ├── parametric-design.gh
│   ├── analysis-tool.gh
│   └── optimization.gh
├── Dockerfile
├── docker-compose.yml
└── .env
```

### Usage

Users access different definitions via query parameter:

```
http://localhost:3000/app?gh=solver-1
http://localhost:3000/app?gh=solver-2
http://localhost:3000/app?gh=parametric-design
```

### Adding New Definitions

1. Save new `.gh` files to `definitions/` folder
2. No rebuild needed! They're immediately available
3. Users can access via: `?gh=newdefinition`

### Benefits

- ✅ Single container (no duplication)
- ✅ Easy to add/remove definitions (just copy files)
- ✅ Shared compute resources
- ✅ No ENV variable changes needed
- ✅ Scales better (10+ definitions efficiently)

---

## 3. Option B: Custom Node.js Server

If you are hosting on your own infrastructure (VPS, internal network), use the Node.js adapter.

### Build

You must explicitly tell the build system to use the Node adapter by setting the `ADAPTER` environment variable.

```bash
# Run from the root of the monorepo or inside packages/compute-app
export ADAPTER=node
pnpm build --filter selva-compute-app
```

### Run

The build output will be in the `build/` directory.

```bash
# Standard run
node build/index.js

# Customizing strict network settings
PORT=3000 HOST=0.0.0.0 ORIGIN=https://my-app.com node build/index.js
```

### Using PM2 (Recommended for Production)

[PM2](https://pm2.keymetrics.io/) keeps your process alive and handles logs.

```bash
# config.js (ecosystem file example)
module.exports = {
  apps: [{
    name: "selva-compute",
    script: "build/index.js",
    env: {
      ADAPTER: "node",
      PORT: 3000,
      COMPUTE_SERVER_URL: "...",
      GH_DEFINITIONS_PATH: "./definitions"
    }
  }]
}
```

```bash
pm2 start config.js
```

## 4. Option C: Docker (Recommended for Custom Hosting)

We provide a production-ready setup using `docker-compose`.

### Usage

1.  **Configure**: Create a `.env` file in this folder with your `COMPUTE_SERVER_URL` and `GH_DEFINITIONS_PATH`.
2.  **Run**:
    ```bash
    # Run from the packages/compute-app directory
    docker compose up --build -d
    ```

That's it! Access the app at `http://localhost:3000`.

### Troubleshooting

If the build fails, ensure you are not accidentally including large files. We use a `.dockerignore` file at the root of the repository to keep builds fast and clean.

## Security Best Practices

### API & Authentication

1.  **Isolate Secrets**: Never import `$env/dynamic/private` into `+page.ts` or `+layout.ts` (client-side files). Only use them in `+page.server.ts` or `+server.ts` endpoints.
2.  **Origin Validation**: If hosting behind a proxy (nginx, load balancer), set the `ORIGIN` environment variable to prevent cross-site request forgery (CSRF) on form submissions.
3.  **Strict Proxies**: If using headers like `X-Forwarded-For`, ensure you configure your proxy to strip incoming headers from untrusted clients.
4.  **Health Check Security**: The `/api/health` endpoint is intentionally public (no authentication required) to allow orchestration systems to monitor the app. Do not expose sensitive data through this endpoint.

### Definition File Security ⚠️

**IMPORTANT**: Your Grasshopper definition files (`.gh`) are valuable intellectual property. Protect them:

- **NEVER** store `.gh` files in the `static/` folder or any public directory
- **NEVER** commit `.gh` files to public git repositories (see `.gitignore`)
- Store definitions in **private, access-controlled locations** only:
  - Local Docker volumes on secure infrastructure (recommended)
  - AWS S3 with authentication enabled
  - Private HTTP server behind authentication
- Use `GH_DEFINITIONS_PATH` for local files (most secure, never exposed to users)
- For remote definitions, use environment variables (`GH_DEF_*`) to keep URLs server-side
- Review who has access to your deployment environment

**See [SECURITY.md](./SECURITY.md) for complete definition file protection guide.**

Current status: Local definitions are the most secure option—they're never exposed to the client. For remote definitions, the environment loader keeps URLs server-side and never sends them to the browser.
