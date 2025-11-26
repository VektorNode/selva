# Selva Production & Food4Rhino Distribution Guide

## Overview

This guide explains how to make Selva production-ready and distribute it through Food4Rhino. The key architecture change is embedding the built web assets directly into the `.gha` plugin, eliminating the need for separate web server setup and enabling one-click installation.

## Current Architecture vs. Production Architecture

### Current State
```
┌─────────────────┐           ┌──────────────────┐
│  Selva.gha      │◄─需要 ─►│ Dev Web Server   │
│  (Plugin)       │  手动启动  │ (SvelteKit)      │
│                 │  & 端口5173 │                 │
└─────────────────┘           └──────────────────┘
```

### Production Architecture
```
┌──────────────────────────────────────────┐
│  Selva.gha (Plugin)                      │
│  ├─ Grasshopper Components               │
│  ├─ WebSocket Server (port 8765)         │
│  ├─ Local HTTP Server (port {random})    │
│  └─ Embedded Web Assets                  │
│      ├─ builder/                         │
│      ├─ preview/                         │
│      ├─ index.html                       │
│      └─ ...static files                  │
└──────────────────────────────────────────┘
      ▲
      │ Browser connects to embedded server
      │ User clicks "Enable" in Grasshopper
      │ (automatic - no manual steps)
      │
      └────► http://localhost:{PORT}
```

## Implementation Steps

### Phase 1: Embed Web Assets in Plugin

#### 1.1 Build Web Application

```bash
# From project root
pnpm build:web

# Output: packages/builder/build/
# This contains all static assets (HTML, CSS, JS, etc.)
```

#### 1.2 Copy Assets to Plugin Project

Create a new folder in the plugin project:

```
Plugin/
├── EmbeddedAssets/
│   └── web/
│       ├── index.html
│       ├── _app/
│       ├── builder/
│       ├── preview/
│       ├── assets/
│       └── ...other files from packages/builder/build/
```

#### 1.3 Update .csproj to Include Assets

Edit `Plugin/Selva.csproj`:

```xml
<ItemGroup>
  <!-- Include web assets as embedded resources -->
  <EmbeddedResource Include="EmbeddedAssets/web/**/*"
                    Visible="false" />
</ItemGroup>
```

#### 1.4 Create Asset Server in C#

Create `Plugin/Utilities/Communication/LocalWebServer.cs`:

```csharp
using System;
using System.IO;
using System.Net;
using System.Reflection;
using System.Threading.Tasks;

namespace Selva;

public class LocalWebServer : IDisposable
{
    private readonly HttpListener _listener;
    private readonly int _port;
    private Task _listenerTask;
    private bool _isRunning;

    public int Port => _port;

    public LocalWebServer(int port = 0)
    {
        _port = port > 0 ? port : GetAvailablePort();
        _listener = new HttpListener();
        _listener.Prefixes.Add($"http://localhost:{_port}/");
    }

    public void Start()
    {
        if (_isRunning) return;

        _listener.Start();
        _isRunning = true;
        _listenerTask = Task.Run(() => ListenerLoop());
    }

    public void Stop()
    {
        _isRunning = false;
        try
        {
            _listener?.Stop();
            _listenerTask?.Wait(TimeSpan.FromSeconds(5));
        }
        catch { }
    }

    public void Dispose()
    {
        Stop();
        _listener?.Close();
    }

    private async Task ListenerLoop()
    {
        while (_isRunning)
        {
            try
            {
                var context = await _listener.GetContextAsync();
                await HandleRequest(context);
            }
            catch (Exception ex) when (_isRunning)
            {
                // Log error but continue listening
            }
        }
    }

    private async Task HandleRequest(HttpListenerContext context)
    {
        try
        {
            var path = context.Request.Url.LocalPath;
            if (path == "/") path = "/index.html";

            path = path.TrimStart('/');

            var asset = GetEmbeddedAsset(path);
            if (asset == null)
            {
                // Fall back to index.html for SPA routing
                asset = GetEmbeddedAsset("index.html");
            }

            if (asset != null)
            {
                var contentType = GetContentType(path);
                context.Response.ContentType = contentType;
                context.Response.ContentLength64 = asset.Length;
                context.Response.OutputStream.Write(asset, 0, asset.Length);
            }
            else
            {
                context.Response.StatusCode = 404;
            }

            context.Response.OutputStream.Close();
        }
        catch (Exception ex)
        {
            try
            {
                context.Response.StatusCode = 500;
                context.Response.OutputStream.Close();
            }
            catch { }
        }
    }

    private byte[] GetEmbeddedAsset(string path)
    {
        var assembly = Assembly.GetExecutingAssembly();
        var resourceName = $"Selva.EmbeddedAssets.web.{path.Replace('/', '.')}";

        try
        {
            using (var stream = assembly.GetManifestResourceStream(resourceName))
            {
                if (stream == null) return null;
                using (var ms = new MemoryStream())
                {
                    stream.CopyTo(ms);
                    return ms.ToArray();
                }
            }
        }
        catch
        {
            return null;
        }
    }

    private string GetContentType(string path)
    {
        var ext = Path.GetExtension(path).ToLower();
        return ext switch
        {
            ".html" => "text/html; charset=utf-8",
            ".css" => "text/css; charset=utf-8",
            ".js" => "application/javascript; charset=utf-8",
            ".json" => "application/json",
            ".svg" => "image/svg+xml",
            ".png" => "image/png",
            ".jpg" or ".jpeg" => "image/jpeg",
            ".gif" => "image/gif",
            ".woff" => "font/woff",
            ".woff2" => "font/woff2",
            ".ttf" => "font/ttf",
            _ => "application/octet-stream"
        };
    }

    private static int GetAvailablePort()
    {
        var listener = new TcpListener(System.Net.IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        return port;
    }
}
```

### Phase 2: Automatic Web Server Startup

#### 2.1 Update GH_UIBuilderComponent

Modify `Components/UI/GH_UIBuilderComponent.cs`:

```csharp
private LocalWebServer _webServer;

protected override void BeforeSolveInstance()
{
    base.BeforeSolveInstance();

    if (IsEnabled && _webServer == null)
    {
        _webServer = new LocalWebServer();
        _webServer.Start();

        // Use the embedded server URL instead of dev server
        OpenUI($"http://localhost:{_webServer.Port}/?session={_sessionId}");
    }
}

protected override void SolveInstance(IGH_DataAccess da)
{
    // ... existing code ...
}

public override void RemovedFromDocument(GH_Document doc)
{
    _webServer?.Stop();
    _webServer?.Dispose();
    base.RemovedFromDocument(doc);
}
```

#### 2.2 Graceful Shutdown

Update `Dispose()` or document cleanup handlers to ensure:
- WebSocket server stops cleanly
- Local HTTP server shuts down
- Session cleanup runs

### Phase 3: Plugin Metadata

#### 3.1 Update SelvaInfo.cs

```csharp
public class SelvaInfo : GH_AssemblyInfo
{
    public override string Name => "Selva";

    public override Bitmap Icon => null;

    public override string Description =>
        "Web-based UI builder for Grasshopper parametric models. " +
        "Create interactive web interfaces for your definitions with drag-and-drop simplicity.";

    public override Guid Id => new("69ef43c6-0bc8-4b49-8e4d-a27f732cc10b");

    public override string AuthorName => "Your Name/Organization";

    public override string AuthorContact => "contact@example.com";

    public override string AssemblyVersion =>
        GetType().Assembly.GetName().Version.ToString();
}
```

#### 3.2 Update Selva.csproj

```xml
<PropertyGroup>
  <Version>1.0.0</Version>
  <Title>Selva</Title>
  <Company>Your Organization</Company>
  <Authors>Your Name</Authors>
  <Description>
    Web-based UI builder for Grasshopper. Create interactive web interfaces
    for your parametric models without coding.
  </Description>
  <RepositoryUrl>https://github.com/yourorg/selva</RepositoryUrl>
  <PackageProjectUrl>https://github.com/yourorg/selva</PackageProjectUrl>
  <PackageLicenseExpression>MIT</PackageLicenseExpression>
  <ReleaseNotes>
    v1.0.0: Initial release
    - Web-based UI builder
    - Real-time preview with WebSocket
    - 3D geometry viewer
    - Embedded web assets
  </ReleaseNotes>
</PropertyGroup>
```

### Phase 4: Create Yak Manifest

Create `manifest.yml` in plugin root:

```yaml
name: Selva
version: 1.0.0
title: Selva - Web UI Builder
description: |
  Selva enables you to create interactive web-based user interfaces
  for Grasshopper definitions without coding.

  Features:
  - Drag-and-drop UI layout editor
  - Real-time preview and testing
  - 3D geometry viewer
  - Support for custom parameter types
  - Cross-platform (Windows/macOS)

authors:
  - Your Name (your.email@example.com)

url: https://github.com/yourorg/selva

icon: icon.png

keywords:
  - UI
  - Web
  - Interface
  - Builder
  - Grasshopper

min-rhino-version: 7.0

source-code-url: https://github.com/yourorg/selva
issue-tracker-url: https://github.com/yourorg/selva/issues

license:
  - MIT

requirements:
  - name: Rhino
    platform: win
    min-version: 7.0
  - name: Rhino
    platform: mac
    min-version: 8.0

notes: |
  Installation Instructions:
  1. Download the .yak file
  2. In Grasshopper, go to File > Special Folders > Components Folder
  3. Drag the .yak file into the Components folder
  4. Restart Rhino
  5. Add the "UI Builder" component to your Grasshopper definition
  6. Enable the component and your browser will open automatically

```

### Phase 5: Build & Package for Distribution

#### 5.1 Build Process

Create `scripts/build-release.sh`:

```bash
#!/bin/bash

set -e

# Configuration
VERSION="1.0.0"
RELEASE_DIR="releases"
BUILD_DIR="Plugin/bin/Release"

echo "Building Selva v${VERSION}"

# Clean previous builds
rm -rf "${RELEASE_DIR}"
mkdir -p "${RELEASE_DIR}"

# Build web assets
echo "Building web application..."
pnpm build:web

# Copy web assets to plugin
echo "Copying web assets to plugin..."
mkdir -p "Plugin/EmbeddedAssets/web"
cp -r "packages/builder/build/"* "Plugin/EmbeddedAssets/web/"

# Build C# plugin
echo "Building C# plugin..."
cd Plugin
dotnet build --configuration Release
cd ..

# Copy .gha files to release directory
echo "Packaging for distribution..."
mkdir -p "${RELEASE_DIR}/net7.0"
mkdir -p "${RELEASE_DIR}/net48"

cp "${BUILD_DIR}/net7.0/Selva.gha" "${RELEASE_DIR}/net7.0/"
cp "${BUILD_DIR}/net48/Selva.gha" "${RELEASE_DIR}/net48/"

# Create Yak package
echo "Creating Yak package..."
cd "${RELEASE_DIR}/net7.0"
yak build ../../manifest.yml
cd ../..

echo ""
echo "✅ Build complete!"
echo "   - Plugin (net7.0): ${RELEASE_DIR}/net7.0/Selva.gha"
echo "   - Plugin (net48): ${RELEASE_DIR}/net48/Selva.gha"
echo "   - Yak package: ${RELEASE_DIR}/net7.0/Selva-${VERSION}.yak"
```

#### 5.2 Create Icon for Plugin

Create a 24x24 pixel PNG icon and place it at:
- `Plugin/Resources/Icon.png`
- `icon.png` (in plugin root for Yak manifest)

Update SelvaInfo.cs to load the icon:

```csharp
public override Bitmap Icon
{
    get
    {
        try
        {
            var assembly = Assembly.GetExecutingAssembly();
            using (var stream = assembly.GetManifestResourceStream("Selva.Resources.Icon.png"))
            {
                return new Bitmap(stream);
            }
        }
        catch
        {
            return null;
        }
    }
}
```

### Phase 6: Distribution Preparation

#### 6.1 Food4Rhino Account Setup

1. Create account at https://food4rhino.com
2. Verify email
3. Create publisher profile
4. Link GitHub repository (recommended)

#### 6.2 Prepare Release Package

```
Selva-1.0.0/
├── Selva-1.0.0.yak                 (Yak package)
├── README.md                        (Installation instructions)
├── CHANGELOG.md                     (Version history)
├── LICENSE.md                       (MIT license)
└── DEVELOPMENT.md                  (For contributors)
```

#### 6.3 Create Comprehensive README

```markdown
# Selva - Web UI Builder for Grasshopper

## Quick Start

1. **Download** the Selva package from Food4Rhino
2. **Install** by dragging the `.yak` file to your Rhino Components folder
3. **Restart** Rhino completely
4. **Add** the "UI Builder" component to any Grasshopper definition
5. **Enable** the component - your browser opens automatically!

## No Additional Setup Required

- ✅ Web server is embedded in the plugin
- ✅ Automatic browser launch on first use
- ✅ Works offline (localhost only)
- ✅ One-click installation

## Features

- Drag-and-drop UI layout editor
- Real-time preview with WebSocket
- 3D geometry viewer
- Support for all Grasshopper data types
- Works on Windows (Rhino 7+) and macOS (Rhino 8+)

## System Requirements

- **Windows:** Rhino 7.0 or later
- **macOS:** Rhino 8.0 or later

## Support

- 📧 Email: support@example.com
- 🐛 Report issues: https://github.com/yourorg/selva/issues
- 📖 Documentation: https://github.com/yourorg/selva/wiki
```

## Deployment Workflow

### For Daily Development

```bash
# Standard development workflow
pnpm dev           # Web dev server
# Plugin in visual studio IDE for debugging
```

### For Production Release

```bash
# One-time setup: Update version in Selva.csproj and package.json
# Then:

./scripts/build-release.sh

# Creates:
# - releases/net7.0/Selva.gha
# - releases/net48/Selva.gha
# - releases/net7.0/Selva-1.0.0.yak
```

### For Food4Rhino Publication

1. Create GitHub release tag (v1.0.0)
2. Attach `.yak` file to GitHub release
3. Go to food4rhino.com > "My Plugins" > "Create New"
4. Upload `.yak` file
5. Fill in metadata (screenshots, description, tags)
6. Set as "Published"

## Key Architectural Changes

### Before
- Requires manual SvelteKit dev server startup
- Plugin connects to separate web server
- Two services must run simultaneously
- Difficult for end users

### After
- Web assets embedded in `.gha` file
- Automatic local HTTP server on plugin load
- Single executable - everything included
- One-click installation and use
- Easy to distribute on Food4Rhino

## Version Management

Version should be updated in two places when releasing:

1. **Plugin:** `Plugin/Selva.csproj` - `<Version>1.0.0</Version>`
2. **Web:** `packages/builder/package.json` - `"version": "1.0.0"`
3. **Manifest:** `manifest.yml` - `version: 1.0.0`

Keep all three synchronized.

## Testing Before Release

```bash
# 1. Run all tests
pnpm test

# 2. Type check
pnpm type-check

# 3. Build release
./scripts/build-release.sh

# 4. Manual testing:
#    - Copy .gha to Grasshopper libraries folder
#    - Restart Rhino
#    - Create test definition with contextual parameters
#    - Enable UI Builder component
#    - Verify browser launches automatically
#    - Test schema builder, preview, and WebSocket communication

# 5. Test on both Windows and macOS if possible

# 6. Verify file sizes are reasonable
#    (should be < 5MB with embedded assets)
```

## Food4Rhino Guidelines

- ✅ Yak package format (.yak)
- ✅ Rhino 7+ compatibility (net48 + net7.0)
- ✅ Clear description and documentation
- ✅ Icon 24x24 PNG
- ✅ MIT/commercial license
- ✅ Support email/contact
- ✅ No external dependencies required
- ✅ Auto-install to correct folder

## Troubleshooting for Users

If the UI Builder doesn't open automatically:

1. Check browser security settings (allow localhost)
2. Ensure no other application is using port 8765 or the assigned web server port
3. Disable browser plugins that block local connections
4. Try opening the URL manually from component's context menu
5. Check that the plugin is enabled (toggle the Enable checkbox)

## Future Enhancements

- [ ] Cloud deployment option
- [ ] Collaborative editing
- [ ] More widget types (chart, table, file upload)
- [ ] Schema sharing/templates
- [ ] Plugin marketplace for custom components
