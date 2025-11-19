# ComputeBuilder Deployment Strategy

This document outlines deployment strategies for ComputeBuilder, from current single-app architecture to future monorepo
scaling.

---

## Current Architecture (Single App)

```
ComputeBuilder/
├── Components/          # C# Grasshopper components
├── Utils/               # C# utilities (WebSocket, Session, etc.)
├── Models/              # C# data models (UISchema, etc.)
└── web/                 # SvelteKit application
    ├── src/
    │   ├── routes/
    │   │   ├── builder/    # Schema design UI (local only)
    │   │   ├── preview/    # Interactive preview (local only)
    │   │   ├── app/        # Rhino Compute standalone UI
    │   │   └── api/        # Session file API routes (local only)
    │   └── lib/
    │       ├── types/      # TypeScript types
    │       └── components/ # Svelte components
    └── package.json
```

### Current Deployment Methods

#### Local Use (Grasshopper Plugin)

**User experience:** Install `.gha` file → Component runs local dev server automatically

**Requirements:**

- User has Node.js installed
- User runs `pnpm install` in `web/` directory (one-time)
- Grasshopper component starts `pnpm run dev` automatically when enabled

**Pros:**

- Hot module reloading during development
- Easy debugging
- Full SvelteKit features

**Cons:**

- Requires Node.js installation
- Users must run `pnpm install`
- Not a "single file" distribution

#### Rhino Compute Deployment (`/app` route only)

**User experience:** Deploy static site to Vercel/Firebase/custom host

**Steps:**

1. Build the SvelteKit app:
   ```bash
   cd web
   pnpm run build
   ```

2. Deploy the `build/` directory to hosting provider:
    - **Vercel**: `vercel deploy`
    - **Firebase**: `firebase deploy`
    - **Netlify**: `netlify deploy`
    - **Custom**: Serve static files from any web server

3. Configure Compute server URL in environment variables or UI

**Pros:**

- No Grasshopper dependency
- Works from any device/browser
- Scalable for multiple users

**Cons:**

- Requires separate hosting
- Users need to manage deployment

---

## Future Architecture: Monorepo with Shared Components

### When to Consider This Upgrade

Upgrade to monorepo when you need:

- ✅ Multiple deployment targets (desktop app, mobile, etc.)
- ✅ Shared component library across apps
- ✅ Ability to publish reusable packages to npm
- ✅ Better separation between local and compute modes
- ✅ Reduced bundle sizes for production

### Recommended Structure

```
ComputeBuilder/
├── Components/               # C# Grasshopper plugin
├── Utils/                    # C# utilities
├── Models/                   # C# data models
├── packages/
│   ├── shared/              # @computebuilder/shared (npm package)
│   │   ├── src/
│   │   │   ├── types/       # UISchema types, interfaces
│   │   │   ├── components/  # Reusable Svelte components
│   │   │   │   ├── ui/      # InputControl, OutputDisplay, etc.
│   │   │   │   └── layout/  # TabLayout, DragDrop, etc.
│   │   │   └── utils/       # Helper functions, API clients
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── grasshopper-ui/      # Local Grasshopper interface
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   │   ├── builder/ # Schema design UI
│   │   │   │   ├── preview/ # Interactive preview
│   │   │   │   └── api/     # Session file API routes
│   │   │   └── lib/         # Local-specific logic
│   │   ├── package.json
│   │   └── svelte.config.js
│   │
│   └── compute-ui/          # Standalone Compute interface
│       ├── src/
│       │   ├── routes/
│       │   │   ├── +page.svelte      # Main UI
│       │   │   └── config/           # Server configuration
│       │   └── lib/
│       │       ├── compute-client.ts # Rhino Compute API
│       │       └── file-upload.ts    # .gh file handling
│       ├── package.json
│       └── svelte.config.js
│
└── pnpm-workspace.yaml
```

### Setup Instructions

**1. Create workspace configuration:**

`pnpm-workspace.yaml`:

```yaml
packages:
  - 'packages/*'
```

**2. Shared package structure:**

`packages/shared/package.json`:

```json
{
  "name": "@computebuilder/shared",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    "./types": "./src/types/index.ts",
    "./components": "./src/components/index.ts",
    "./utils": "./src/utils/index.ts"
  },
  "peerDependencies": {
    "svelte": "^5.0.0"
  }
}
```

**3. App dependencies:**

`packages/grasshopper-ui/package.json`:

```json
{
  "dependencies": {
    "@computebuilder/shared": "workspace:*",
    "@sveltejs/kit": "^2.0.0",
    "svelte": "^5.0.0"
  }
}
```

**4. Install all packages:**

```bash
pnpm install
```

**5. Import shared code:**

```typescript
// In grasshopper-ui or compute-ui
import { UISchema, InputParameter } from '@computebuilder/shared/types';
import { InputControl } from '@computebuilder/shared/components';
```

---

## Deployment Strategies (Monorepo)

### 1. Local Use (Grasshopper Plugin)

#### Option A: Bundled Static Files (Recommended for Distribution)

**Build process:**

```bash
# Build shared package
cd packages/shared
pnpm run build

# Build Grasshopper UI as static files
cd packages/grasshopper-ui
pnpm run build
```

**C# Integration:**

1. Copy `packages/grasshopper-ui/build/` to `wwwroot/` in C# project
2. Create `HttpApiServer.cs` to serve static files + API endpoints
3. Embed `wwwroot/` as embedded resources in `.gha` file
4. Component extracts and serves files on startup

**Distribution:**

- Users download single `.gha` file
- No Node.js required
- Component serves UI on `http://localhost:5173`

**MSBuild task to automate:**

`ComputeBuilder.csproj`:

```xml
<Target Name="BuildWeb" BeforeTargets="BeforeBuild">
  <!-- Build the web UI -->
  <Exec Command="cd packages/grasshopper-ui &amp;&amp; pnpm install &amp;&amp; pnpm run build" />

  <!-- Copy to wwwroot -->
  <ItemGroup>
    <WebFiles Include="packages/grasshopper-ui/build/**/*" />
  </ItemGroup>
  <Copy SourceFiles="@(WebFiles)" DestinationFolder="wwwroot/%(RecursiveDir)" />
</Target>

<ItemGroup>
  <!-- Embed all wwwroot files -->
  <EmbeddedResource Include="wwwroot/**/*" />
</ItemGroup>
```

**C# code to extract embedded files:**

```csharp
private void ExtractEmbeddedFiles()
{
    var assembly = Assembly.GetExecutingAssembly();
    var resourcePrefix = "ComputeBuilder.wwwroot.";
    var targetDir = Path.Combine(Path.GetTempPath(), "ComputeBuilder", "wwwroot");

    Directory.CreateDirectory(targetDir);

    foreach (var resourceName in assembly.GetManifestResourceNames())
    {
        if (!resourceName.StartsWith(resourcePrefix)) continue;

        var relativePath = resourceName.Substring(resourcePrefix.Length).Replace('.', '/');
        var targetPath = Path.Combine(targetDir, relativePath);

        Directory.CreateDirectory(Path.GetDirectoryName(targetPath));

        using (var stream = assembly.GetManifestResourceStream(resourceName))
        using (var fileStream = File.Create(targetPath))
        {
            stream.CopyTo(fileStream);
        }
    }
}
```

#### Option B: Dev Server (For Development Only)

**Build process:**

```bash
# Terminal 1: Build plugin
dotnet build

# Terminal 2: Run dev server
cd packages/grasshopper-ui
pnpm run dev
```

**Pros:**

- Hot module reloading
- Fast development
- Easy debugging

**Cons:**

- Requires Node.js
- Not suitable for distribution

---

### 2. Rhino Compute Deployment

#### Option A: Vercel (Recommended for Quick Deployment)

**Setup:**

```bash
cd packages/compute-ui
vercel deploy
```

**Configuration:**

`packages/compute-ui/vercel.json`:

```json
{
  "buildCommand": "pnpm run build",
  "outputDirectory": "build",
  "installCommand": "pnpm install",
  "framework": "sveltekit"
}
```

**Environment variables:**

```
VITE_COMPUTE_URL=https://your-compute-server.com
VITE_COMPUTE_AUTH_KEY=your-api-key (optional)
```

**Deploy:**

```bash
# Production
vercel --prod

# Preview
vercel
```

**Custom domain:**

```bash
vercel domains add your-domain.com
```

#### Option B: Firebase Hosting

**Setup:**

```bash
cd packages/compute-ui
firebase init hosting
```

**Configuration:**

`firebase.json`:

```json
{
  "hosting": {
    "public": "build",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [
      {
        "source": "**",
        "destination": "/index.html"
      }
    ]
  }
}
```

**Deploy:**

```bash
pnpm run build
firebase deploy --only hosting
```

#### Option C: Docker Container (Full Stack)

For deploying both Compute server + UI together:

`Dockerfile`:

```dockerfile
# Build web UI
FROM node:20 AS web-builder
WORKDIR /app
COPY packages/shared ./packages/shared
COPY packages/compute-ui ./packages/compute-ui
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
RUN npm install -g pnpm
RUN pnpm install
RUN pnpm --filter compute-ui run build

# Serve with nginx
FROM nginx:alpine
COPY --from=web-builder /app/packages/compute-ui/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

**Deploy:**

```bash
docker build -t computebuilder-ui .
docker run -p 80:80 computebuilder-ui
```

#### Option D: Static Hosting (AWS S3, Cloudflare Pages, etc.)

**Build:**

```bash
cd packages/compute-ui
pnpm run build
```

**Upload `build/` directory to:**

- AWS S3 + CloudFront
- Cloudflare Pages
- GitHub Pages
- Any static file host

**Configuration via runtime:**

Instead of build-time env vars, load config from `config.json`:

`static/config.json`:

```json
{
  "computeUrl": "https://your-compute-server.com",
  "authRequired": false
}
```

Load in app:

```typescript
// src/lib/config.ts
export async function loadConfig() {
  const response = await fetch('/config.json');
  return await response.json();
}
```

This allows changing server URL without rebuilding.

---

## Comparison Matrix

| Feature                | Current (Single App)        | Monorepo (Bundled)       | Monorepo (Dev Server) |
|------------------------|-----------------------------|--------------------------|-----------------------|
| **Distribution**       | Requires Node.js            | Single `.gha` file       | Requires Node.js      |
| **User Setup**         | `pnpm install`              | None                     | `pnpm install`        |
| **Bundle Size**        | Large (includes all routes) | Small (only needed code) | N/A                   |
| **Development Speed**  | Fast (HMR)                  | Slow (rebuild required)  | Fast (HMR)            |
| **Production Ready**   | No                          | Yes                      | No                    |
| **Compute Deployment** | Manual separation           | Separate package         | Separate package      |
| **Code Sharing**       | Copy/paste                  | npm workspace            | npm workspace         |

---

## Recommended Timeline

### Phase 1: Current (Now)

- Keep single app structure
- Users install Node.js + run `pnpm install`
- Manual deployment of `/app` route for Compute

### Phase 2: Bundled Distribution (Next)

- Add MSBuild task to bundle static files
- Create `HttpApiServer.cs` for serving files
- Single `.gha` distribution (no Node.js required)

### Phase 3: Monorepo (Future)

- Separate `grasshopper-ui` and `compute-ui`
- Extract `@computebuilder/shared` package
- Publish to npm (optional)
- Better deployment workflows

---

## Quick Reference: Deployment Commands

### Development (Current)

```bash
# Terminal 1: Build C# plugin
dotnet build

# Terminal 2: Start web dev server
cd web && pnpm run dev
```

### Production Build (Future - Bundled)

```bash
# Single command builds everything
dotnet build --configuration Release

# Output: ComputeBuilder.gha (includes embedded web files)
```

### Compute Deployment (Current)

```bash
cd web
pnpm run build
vercel deploy --prod
```

### Compute Deployment (Future - Monorepo)

```bash
cd packages/compute-ui
pnpm run build
vercel deploy --prod
```

---

## Security Considerations

### Local Use

- Bind HTTP server to `localhost` only (no external access)
- Validate all file paths to prevent directory traversal
- Sanitize session IDs
- Auto-cleanup old session files

### Compute Deployment

- Implement authentication (API keys, OAuth, etc.)
- Rate limiting on Compute endpoints
- CORS configuration for allowed origins
- Input validation for uploaded .gh files
- Secure WebSocket connections (WSS)

---

## Performance Optimization

### Bundle Size Reduction

- Tree-shake unused components
- Lazy load heavy components (3D viewer, charts)
- Split code by route
- Compress static assets

### Caching Strategy

- Cache static assets with long expiry
- Version assets with content hashes
- Use CDN for Compute deployments
- Service worker for offline support (optional)

---

## Future Enhancements

### Multi-Platform Distribution

- Electron app (desktop)
- Mobile app (React Native with shared components)
- VS Code extension
- Rhino plugin for other platforms

### CI/CD Pipeline

```yaml
# .github/workflows/deploy.yml
name: Deploy Compute UI
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: pnpm/action-setup@v2
      - run: pnpm install
      - run: pnpm --filter compute-ui run build
      - uses: amondnet/vercel-action@v20
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
```

---

## Troubleshooting

### "Cannot find module '@computebuilder/shared'"

- Run `pnpm install` in root directory
- Ensure `pnpm-workspace.yaml` is configured
- Check `package.json` has correct workspace dependency

### Static files not loading

- Verify `wwwroot/` directory exists
- Check embedded resources in `.csproj`
- Ensure MSBuild task ran successfully
- Check file permissions in temp directory

### WebSocket connection failed

- Verify port 8765 is not in use
- Check firewall settings
- Ensure localhost binding is correct

### Compute deployment CORS errors

- Add CORS headers in Compute server
- Configure allowed origins
- Use environment variables for URLs
