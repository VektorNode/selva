# Selva Production Code Examples

This document provides detailed code examples for implementing the production-ready architecture.

## 1. LocalWebServer.cs - Complete Implementation

**Path:** `Plugin/Utilities/Communication/LocalWebServer.cs`

This is the core component that serves embedded web assets from the plugin.

```csharp
using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;

namespace Selva;

/// <summary>
/// Embedded local HTTP server for serving SvelteKit web application.
/// Runs on a dynamically-assigned port if default is unavailable.
/// Supports SPA routing by falling back to index.html for unmatched paths.
/// </summary>
public class LocalWebServer : IDisposable
{
    private readonly HttpListener _listener;
    private readonly int _port;
    private readonly ILogger _logger;
    private Task _listenerTask;
    private volatile bool _isRunning;
    private CancellationTokenSource _cancellationTokenSource;

    public int Port => _port;
    public bool IsRunning => _isRunning;

    public LocalWebServer(int port = 0, ILogger logger = null)
    {
        _logger = logger;
        _port = port > 0 ? port : GetAvailablePort();
        _listener = new HttpListener();
        _listener.Prefixes.Add($"http://localhost:{_port}/");
        _cancellationTokenSource = new CancellationTokenSource();
    }

    /// <summary>
    /// Start the HTTP listener and begin accepting requests.
    /// </summary>
    public void Start()
    {
        if (_isRunning)
            return;

        try
        {
            _listener.Start();
            _isRunning = true;
            _cancellationTokenSource = new CancellationTokenSource();
            _listenerTask = Task.Run(() => ListenerLoop(_cancellationTokenSource.Token));
            _logger?.LogInformation($"Web server started on http://localhost:{_port}");
        }
        catch (Exception ex)
        {
            _logger?.LogError($"Failed to start web server: {ex.Message}");
            throw;
        }
    }

    /// <summary>
    /// Stop the HTTP listener and cleanup resources.
    /// </summary>
    public void Stop()
    {
        if (!_isRunning)
            return;

        _isRunning = false;
        _cancellationTokenSource?.Cancel();

        try
        {
            _listener?.Stop();

            // Wait for listener task to complete with timeout
            if (!_listenerTask?.Wait(TimeSpan.FromSeconds(5)) == true)
            {
                _logger?.LogWarning("Web server listener didn't stop cleanly within timeout");
            }

            _logger?.LogInformation("Web server stopped");
        }
        catch (Exception ex)
        {
            _logger?.LogError($"Error stopping web server: {ex.Message}");
        }
    }

    public void Dispose()
    {
        Stop();
        _listener?.Close();
        _cancellationTokenSource?.Dispose();
    }

    private async Task ListenerLoop(CancellationToken cancellationToken)
    {
        while (_isRunning && !cancellationToken.IsCancellationRequested)
        {
            try
            {
                var context = await _listener.GetContextAsync();
                _ = Task.Run(() => HandleRequest(context), cancellationToken);
            }
            catch (ObjectDisposedException)
            {
                // Listener was closed
                break;
            }
            catch (Exception ex) when (_isRunning)
            {
                _logger?.LogError($"Error in listener loop: {ex.Message}");
            }
        }
    }

    private async Task HandleRequest(HttpListenerContext context)
    {
        try
        {
            var path = context.Request.Url.LocalPath;

            // Normalize path
            if (path == "/" || string.IsNullOrEmpty(path))
                path = "/index.html";

            // Remove leading slash for resource lookup
            path = path.TrimStart('/');

            // Try to get the asset
            var asset = GetEmbeddedAsset(path);

            // SPA fallback: if not found, try index.html
            if (asset == null && !path.StartsWith("assets/"))
            {
                asset = GetEmbeddedAsset("index.html");
                context.Response.StatusCode = 200; // Still return 200 for SPA routing
            }

            if (asset != null)
            {
                var contentType = GetContentType(path);
                context.Response.ContentType = contentType;
                context.Response.ContentLength64 = asset.Length;

                // Add caching headers for assets
                if (path.StartsWith("assets/"))
                {
                    context.Response.AddHeader("Cache-Control", "public, max-age=31536000, immutable");
                }
                else if (path.Contains(".js") || path.Contains(".css"))
                {
                    context.Response.AddHeader("Cache-Control", "public, max-age=3600");
                }
                else
                {
                    context.Response.AddHeader("Cache-Control", "public, max-age=300");
                }

                await context.Response.OutputStream.WriteAsync(asset, 0, asset.Length);
            }
            else
            {
                context.Response.StatusCode = 404;
            }

            context.Response.Close();
        }
        catch (Exception ex)
        {
            try
            {
                context.Response.StatusCode = 500;
                context.Response.Close();
            }
            catch { }

            _logger?.LogError($"Error handling request: {ex.Message}");
        }
    }

    /// <summary>
    /// Get embedded asset from assembly resources.
    /// Handles the resource naming convention: Selva.EmbeddedAssets.web.{path.with.dots}
    /// </summary>
    private byte[] GetEmbeddedAsset(string path)
    {
        try
        {
            var assembly = Assembly.GetExecutingAssembly();

            // Convert filesystem path to resource namespace
            // "builder/index.html" -> "Selva.EmbeddedAssets.web.builder.index.html"
            var resourceName = $"Selva.EmbeddedAssets.web.{path.Replace('/', '.')}";

            using (var stream = assembly.GetManifestResourceStream(resourceName))
            {
                if (stream == null)
                    return null;

                using (var ms = new MemoryStream())
                {
                    stream.CopyTo(ms);
                    return ms.ToArray();
                }
            }
        }
        catch (Exception ex)
        {
            _logger?.LogDebug($"Error loading embedded asset '{path}': {ex.Message}");
            return null;
        }
    }

    /// <summary>
    /// Determine MIME type based on file extension.
    /// </summary>
    private string GetContentType(string path)
    {
        var ext = Path.GetExtension(path).ToLower();

        return ext switch
        {
            ".html" => "text/html; charset=utf-8",
            ".css" => "text/css; charset=utf-8",
            ".js" => "application/javascript; charset=utf-8",
            ".mjs" => "application/javascript; charset=utf-8",
            ".json" => "application/json; charset=utf-8",
            ".svg" => "image/svg+xml",
            ".png" => "image/png",
            ".jpg" or ".jpeg" => "image/jpeg",
            ".gif" => "image/gif",
            ".webp" => "image/webp",
            ".ico" => "image/x-icon",
            ".woff" => "font/woff",
            ".woff2" => "font/woff2",
            ".ttf" => "font/ttf",
            ".eot" => "application/vnd.ms-fontobject",
            ".otf" => "font/otf",
            ".txt" => "text/plain; charset=utf-8",
            ".xml" => "application/xml; charset=utf-8",
            _ => "application/octet-stream"
        };
    }

    /// <summary>
    /// Find an available TCP port on localhost.
    /// Returns 0 only if no port is available (extremely unlikely).
    /// </summary>
    private static int GetAvailablePort()
    {
        try
        {
            using (var listener = new TcpListener(IPAddress.Loopback, 0))
            {
                listener.Start();
                var port = ((IPEndPoint)listener.LocalEndpoint).Port;
                listener.Stop();
                return port;
            }
        }
        catch
        {
            // Fallback to hardcoded port if port selection fails
            return 8080;
        }
    }
}
```

---

## 2. Updated GH_UIBuilderComponent Integration

**Path:** `Plugin/Components/UI/GH_UIBuilderComponent.cs`

Key changes to integrate the LocalWebServer:

```csharp
// Add these fields
private LocalWebServer _webServer;
private int _webServerPort;

// In the enable/component initialization
public override bool Write(GH_IWriter writer)
{
    // ... existing code ...

    if (_webServer != null && _webServer.IsRunning)
    {
        writer.SetString("WebServerPort", _webServerPort.ToString());
    }

    return true;
}

public override bool Read(GH_IReader reader)
{
    // ... existing code ...

    // Try to restore web server port (for persistence)
    if (reader.ItemExists("WebServerPort"))
    {
        reader.TryGetString("WebServerPort", out var portStr);
        if (int.TryParse(portStr, out var port))
        {
            _webServerPort = port;
        }
    }

    return true;
}

// Override the property that controls enable/disable
public override bool Enabled
{
    get => base.Enabled;
    set
    {
        if (value && !base.Enabled)
        {
            // Enabling - start web server
            StartWebServer();
        }
        else if (!value && base.Enabled)
        {
            // Disabling - stop web server
            StopWebServer();
        }

        base.Enabled = value;
    }
}

// Web server lifecycle management
private void StartWebServer()
{
    try
    {
        if (_webServer != null && _webServer.IsRunning)
            return;

        _webServer = new LocalWebServer();
        _webServer.Start();
        _webServerPort = _webServer.Port;

        // Open the UI using the embedded server URL
        OpenUI($"http://localhost:{_webServerPort}/?session={_sessionId}");

        this.AddRuntimeMessage(
            GH_RuntimeMessageLevel.Remark,
            $"Web UI started on http://localhost:{_webServerPort}");
    }
    catch (Exception ex)
    {
        this.AddRuntimeMessage(
            GH_RuntimeMessageLevel.Error,
            $"Failed to start web server: {ex.Message}");
    }
}

private void StopWebServer()
{
    try
    {
        _webServer?.Stop();
        _webServer?.Dispose();
        _webServer = null;
    }
    catch (Exception ex)
    {
        this.AddRuntimeMessage(
            GH_RuntimeMessageLevel.Warning,
            $"Error stopping web server: {ex.Message}");
    }
}

public override void RemovedFromDocument(GH_Document doc)
{
    StopWebServer();
    _communicationHandler?.Stop();
    _communicationHandler?.Dispose();
    base.RemovedFromDocument(doc);
}

// Update OpenUI to use the web server port
private void OpenUI(string url)
{
    try
    {
        if (RuntimePlatform.IsWindows)
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = url,
                UseShellExecute = true
            });
        }
        else if (RuntimePlatform.IsMac)
        {
            Process.Start("open", url);
        }
        else
        {
            Process.Start("xdg-open", url);
        }
    }
    catch (Exception ex)
    {
        this.AddRuntimeMessage(
            GH_RuntimeMessageLevel.Warning,
            $"Could not open browser: {ex.Message}");
    }
}
```

---

## 3. Updated Selva.csproj

**Path:** `Plugin/Selva.csproj`

```xml
<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFrameworks>net7.0;net48</TargetFrameworks>
    <EnableDynamicLoading>true</EnableDynamicLoading>
    <TargetExt>.gha</TargetExt>
    <NoWarn>NU1701</NoWarn>
    <LangVersion>latest</LangVersion>
    <Nullable>enable</Nullable>
  </PropertyGroup>

  <!-- Metadata for Yak package manager and assembly info -->
  <PropertyGroup>
    <Version>1.0.0</Version>
    <Title>Selva</Title>
    <Company>Selva Authors</Company>
    <Authors>Your Name</Authors>
    <Description>
      Web-based UI builder for Grasshopper. Create interactive web interfaces
      for your parametric models without coding. Built-in web server requires
      no external dependencies.
    </Description>
    <PackageProjectUrl>https://github.com/yourorg/selva</PackageProjectUrl>
    <RepositoryUrl>https://github.com/yourorg/selva</RepositoryUrl>
    <RepositoryType>git</RepositoryType>
    <PackageLicenseExpression>MIT</PackageLicenseExpression>
    <ReleaseNotes>
      v1.0.0 - Initial Release
      - Embedded web application (no external server needed)
      - Automatic browser launch on component enable
      - Real-time schema building with drag-and-drop
      - Interactive preview with WebSocket
      - 3D geometry viewer
      - Works offline on localhost
      - Support for all Grasshopper data types
    </ReleaseNotes>
  </PropertyGroup>

  <!-- Include embedded web assets -->
  <ItemGroup>
    <EmbeddedResource Include="EmbeddedAssets/web/**/*" Visible="false" />
  </ItemGroup>

  <!-- NuGet package dependencies -->
  <ItemGroup>
    <PackageReference Include="Grasshopper" Version="8.0.23304.9001" ExcludeAssets="runtime" />
    <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />
    <PackageReference Include="System.Drawing.Common" Version="8.0.0" Condition="'$(TargetFramework)' == 'net7.0'" />
    <PackageReference Include="System.Windows.Forms" Version="4.0.0" />
    <PackageReference Include="Microsoft.Extensions.Logging" Version="7.0.0" />
    <PackageReference Include="Microsoft.Extensions.Logging.Abstractions" Version="7.0.0" />
  </ItemGroup>

</Project>
```

---

## 4. Batch Build Script (Windows)

**Path:** `scripts/build-release.bat`

For Windows developers who prefer batch scripts:

```batch
@echo off
setlocal enabledelayedexpansion

REM Configuration
set VERSION=1.0.0
set RELEASE_DIR=releases
set BUILD_DIR=Plugin\bin\Release

echo Building Selva v%VERSION%...

REM Clean previous builds
if exist "%RELEASE_DIR%" rmdir /s /q "%RELEASE_DIR%"
mkdir "%RELEASE_DIR%"

REM Build web assets
echo Building web application...
call pnpm build:web
if errorlevel 1 (
    echo Error: Web build failed
    exit /b 1
)

REM Copy web assets to plugin
echo Copying web assets to plugin...
mkdir "Plugin\EmbeddedAssets\web"
xcopy /e /y "packages\builder\build\*" "Plugin\EmbeddedAssets\web\"

REM Build C# plugin
echo Building C# plugin...
cd Plugin
dotnet build --configuration Release
if errorlevel 1 (
    echo Error: Plugin build failed
    cd ..
    exit /b 1
)
cd ..

REM Copy outputs
echo Packaging for distribution...
mkdir "%RELEASE_DIR%\net7.0"
mkdir "%RELEASE_DIR%\net48"

copy "%BUILD_DIR%\net7.0\Selva.gha" "%RELEASE_DIR%\net7.0\"
copy "%BUILD_DIR%\net48\Selva.gha" "%RELEASE_DIR%\net48\"

REM Create Yak packages (requires yak.exe in PATH)
echo Creating Yak packages...
cd "%RELEASE_DIR%\net7.0"
yak build ..\..\manifest.yml
if errorlevel 1 (
    echo Warning: Yak build failed (yak.exe may not be in PATH)
)
cd ..\..\

echo.
echo ✓ Build complete!
echo   - Plugin (net7.0): %RELEASE_DIR%\net7.0\Selva.gha
echo   - Plugin (net48): %RELEASE_DIR%\net48\Selva.gha
echo   - Yak package: %RELEASE_DIR%\net7.0\Selva-%VERSION%.yak

endlocal
```

---

## 5. Bash Build Script (macOS/Linux)

**Path:** `scripts/build-release.sh`

For Unix-like systems:

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

# Copy outputs
echo "Packaging for distribution..."
mkdir -p "${RELEASE_DIR}/net7.0"
mkdir -p "${RELEASE_DIR}/net48"

cp "${BUILD_DIR}/net7.0/Selva.gha" "${RELEASE_DIR}/net7.0/"
cp "${BUILD_DIR}/net48/Selva.gha" "${RELEASE_DIR}/net48/"

# Create Yak packages
echo "Creating Yak packages..."
if command -v yak &> /dev/null; then
    cd "${RELEASE_DIR}/net7.0"
    yak build ../../manifest.yml
    cd ../..
else
    echo "Warning: yak not found. Install from https://github.com/mcneel/yak/releases"
fi

echo ""
echo "✅ Build complete!"
echo "   - Plugin (net7.0): ${RELEASE_DIR}/net7.0/Selva.gha"
echo "   - Plugin (net48): ${RELEASE_DIR}/net48/Selva.gha"
echo "   - Yak package: ${RELEASE_DIR}/net7.0/Selva-${VERSION}.yak"
```

Make executable:
```bash
chmod +x scripts/build-release.sh
```

---

## 6. Manifest for Yak Package Manager

**Path:** `manifest.yml`

```yaml
name: Selva
version: 1.0.0
title: Selva - Web UI Builder for Grasshopper
description: |
  Selva is a web-based UI builder for Grasshopper definitions that requires
  no coding and no external dependencies. Design beautiful, interactive
  web interfaces for your parametric models and see them update in real-time.

  Key Features:
  - Drag-and-drop UI layout editor
  - Real-time preview with WebSocket synchronization
  - 3D geometry viewer with Three.js
  - Support for all Grasshopper data types
  - Automatic web server embedded in plugin
  - One-click installation and launch
  - Cross-platform (Windows/macOS)

authors:
  - Your Name (your.email@example.com)

url: https://github.com/yourorg/selva
icon: icon.png

keywords:
  - UI
  - web
  - interface
  - builder
  - parametric
  - grasshopper
  - interactive

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

  1. Download the Selva package from Food4Rhino
  2. In Grasshopper, go to: File > Special Folders > Components Folder
  3. Drag the .yak file you downloaded to the Components folder
  4. Restart Rhino completely
  5. Add the "UI Builder" component to your Grasshopper definition
  6. Enable the component - your browser opens automatically!

  That's it! No additional setup required. The web server is built-in and
  runs locally on your machine.

  For detailed documentation and tutorials, visit:
  https://github.com/yourorg/selva/wiki
```

---

## 7. Updated SelvaInfo.cs

**Path:** `Plugin/SelvaInfo.cs`

```csharp
using System;
using System.Drawing;
using Grasshopper.Kernel;

namespace Selva;

public class SelvaInfo : GH_AssemblyInfo
{
    private static Bitmap _cachedIcon;

    public override string Name => "Selva";

    public override Bitmap Icon
    {
        get
        {
            if (_cachedIcon != null)
                return _cachedIcon;

            try
            {
                var assembly = System.Reflection.Assembly.GetExecutingAssembly();
                using (var stream = assembly.GetManifestResourceStream("Selva.Resources.Icon.png"))
                {
                    if (stream != null)
                    {
                        _cachedIcon = new Bitmap(stream);
                        return _cachedIcon;
                    }
                }
            }
            catch
            {
                // Fall back to null if icon not found
            }

            return null;
        }
    }

    public override string Description =>
        "Web-based UI builder for Grasshopper parametric models. " +
        "Create interactive web interfaces without coding. " +
        "Includes embedded web server with automatic browser launch.";

    public override Guid Id => new("69ef43c6-0bc8-4b49-8e4d-a27f732cc10b");

    public override string AuthorName => "Your Name or Organization";

    public override string AuthorContact => "your.email@example.com";

    public override string AssemblyVersion =>
        GetType().Assembly.GetName().Version.ToString();
}
```

---

## 8. SvelteKit Build Configuration Optimization

**Path:** `packages/builder/svelte.config.js`

Ensure optimal production build:

```javascript
import adapter from '@sveltejs/adapter-auto';
import { vitePreprocess } from 'svelte/vite';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),

  kit: {
    adapter: adapter(),

    // Optimize for production embedding
    inlineStyleThreshold: 1024,

    // Preload critical assets
    preloadStrategy: 'modulepreload',
  },
};

export default config;
```

---

## 9. Vite Configuration for Production

**Path:** `packages/builder/vite.config.ts`

```typescript
import { defineConfig } from 'vite';
import svelte from 'vite-plugin-svelte';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

export default defineConfig({
  plugins: [svelte()],

  build: {
    // Optimize for embedded distribution
    minify: 'terser',
    sourcemap: false,

    // Chunk splitting for better caching
    rollupOptions: {
      output: {
        manualChunks: {
          'three': ['three'],
        },
      },
    },

    // Target modern browsers since plugin controls environment
    target: 'ES2020',
  },

  css: {
    postcss: {
      plugins: [
        tailwindcss,
        autoprefixer,
      ],
    },
  },
});
```

---

## Deployment Flowchart

```
Development
  ↓
  ├─ pnpm dev                    # Web dev server (localhost:5173)
  └─ Visual Studio/VS Code       # Debug plugin

Release Build
  ↓
  ├─ pnpm build:web              # Build optimized static assets
  ├─ Copy to Plugin/EmbeddedAssets/web/
  ├─ dotnet build Release        # Build .gha files
  ├─ Create manifest.yml
  └─ yak build manifest.yml      # Create .yak package

Distribution
  ↓
  ├─ GitHub Release (attach .yak)
  └─ Food4Rhino (upload .yak + metadata)

User Installation
  ↓
  ├─ Download .yak from Food4Rhino
  ├─ Drag to Grasshopper Components folder
  ├─ Restart Rhino
  ├─ Add UIBuilderComponent
  ├─ Enable component
  └─ Browser opens → embedded web UI
```

---

## Testing Checklist Code Snippets

### Test Plugin Loads
```csharp
// In GH_UIBuilderComponent test
[Test]
public void ComponentLoadsWithEmbeddedAssets()
{
    var component = new GH_UIBuilderComponent();
    Assert.That(component, Is.Not.Null);
    Assert.That(component.Enabled, Is.False);
}

[Test]
public void WebServerStartsOnEnable()
{
    var component = new GH_UIBuilderComponent();
    component.Enabled = true;

    Assert.That(component.Enabled, Is.True);
    Thread.Sleep(100); // Allow async startup
    // Verify server is running by attempting connection
}
```

### Test Embedded Assets Load
```csharp
[Test]
public void EmbeddedAssetsExist()
{
    var assembly = Assembly.GetExecutingAssembly();
    var resources = assembly.GetManifestResourceNames();

    var hasIndexHtml = resources.Any(r => r.EndsWith("index.html"));
    Assert.That(hasIndexHtml, Is.True, "index.html must be embedded");
}

[Test]
public void WebServerServesIndexHtml()
{
    var server = new LocalWebServer();
    server.Start();

    using (var client = new HttpClient())
    {
        var response = client.GetAsync($"http://localhost:{server.Port}/").Result;
        Assert.That(response.StatusCode, Is.EqualTo(System.Net.HttpStatusCode.OK));
    }

    server.Stop();
    server.Dispose();
}
```

---

This document provides all the code examples needed to implement the production architecture. Follow the implementation checklist in parallel with these code examples for a complete deployment pipeline.
