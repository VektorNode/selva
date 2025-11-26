# Selva Production Implementation Checklist

## Phase 1: Asset Embedding & Local Web Server (Critical)

### Tasks
- [ ] **Create LocalWebServer.cs** in `Plugin/Utilities/Communication/`
  - [ ] Implement HttpListener-based server
  - [ ] Handle embedded resource loading from assembly
  - [ ] Implement SPA routing (fallback to index.html)
  - [ ] Support all MIME types (HTML, CSS, JS, images, fonts)
  - [ ] Add graceful shutdown with timeout
  - [ ] Implement automatic port selection if default unavailable

- [ ] **Create EmbeddedAssets folder structure**
  ```
  Plugin/
  └── EmbeddedAssets/
      └── web/
          ├── index.html
          ├── _app/
          ├── builder/
          ├── preview/
          ├── assets/
          └── ...all other files from packages/builder/build/
  ```

- [ ] **Update Plugin/Selva.csproj**
  - [ ] Add EmbeddedResource ItemGroup for web assets
  - [ ] Verify asset paths are correctly referenced
  - [ ] Test that assets are included in built .gha file

### Verification Steps
```bash
# Build and check asset inclusion
cd Plugin
dotnet build --configuration Release

# Verify .gha file size (should be larger than before, ~2-5MB with web assets)
ls -lh bin/Release/net7.0/Selva.gha
ls -lh bin/Release/net48/Selva.gha

# Use 7z or other tool to inspect .gha file contents
# Should contain EmbeddedAssets folder with all web files
```

---

## Phase 2: Integrate Web Server into Plugin Component (Critical)

### Tasks
- [ ] **Update GH_UIBuilderComponent.cs**
  - [ ] Add `LocalWebServer _webServer` field
  - [ ] Initialize web server in component's enable logic
  - [ ] Update OpenUI() to use embedded server URL
  - [ ] Stop web server in RemovedFromDocument() or disposal
  - [ ] Ensure thread-safe web server lifecycle management

- [ ] **Update CommunicationHandler.cs**
  - [ ] Ensure CommunicationHandler (WebSocket) works alongside LocalWebServer
  - [ ] Update any URLs from hardcoded `localhost:5173` to dynamic port

### Code Structure
```csharp
// In GH_UIBuilderComponent.cs

private LocalWebServer _webServer;
private int _uiPort; // Store the assigned port

public void EnableUI()
{
    if (_webServer == null)
    {
        _webServer = new LocalWebServer();
        _webServer.Start();
        _uiPort = _webServer.Port;
    }
    OpenUI($"http://localhost:{_uiPort}/?session={_sessionId}");
}

public override void RemovedFromDocument(GH_Document doc)
{
    _webServer?.Stop();
    _webServer?.Dispose();
    base.RemovedFromDocument(doc);
}
```

### Verification Steps
```
1. Build plugin
2. Copy .gha to Grasshopper Libraries folder
3. Restart Rhino
4. Add UIBuilderComponent to definition
5. Enable component
6. Verify:
   - [ ] Browser opens automatically (not to localhost:5173)
   - [ ] Page loads and displays UI
   - [ ] No errors in browser console
   - [ ] WebSocket connects (check browser Network tab)
   - [ ] Values can be changed and sent to Grasshopper
```

---

## Phase 3: Plugin Metadata & Branding

### Tasks
- [ ] **Create plugin icon**
  - [ ] Design 24x24 PNG icon
  - [ ] Save to `Plugin/Resources/Icon.png`
  - [ ] Add to `icon.png` (root) for Yak manifest

- [ ] **Update SelvaInfo.cs**
  - [ ] Fill in all metadata fields
  - [ ] Implement Icon loading from embedded resource
  - [ ] Add meaningful description
  - [ ] Update author name and contact

- [ ] **Update Selva.csproj metadata**
  ```xml
  <Version>1.0.0</Version>
  <Title>Selva</Title>
  <Company>Your Organization</Company>
  <Authors>Your Name</Authors>
  <Description>Web-based UI builder for Grasshopper...</Description>
  <RepositoryUrl>https://github.com/yourorg/selva</RepositoryUrl>
  <PackageProjectUrl>https://github.com/yourorg/selva</PackageProjectUrl>
  <PackageLicenseExpression>MIT</PackageLicenseExpression>
  <ReleaseNotes>v1.0.0: Initial release</ReleaseNotes>
  ```

### Verification Steps
```
1. Open Rhino
2. Check Grasshopper > Tools > Show Plug-In Manager
3. Find "Selva" entry
4. Verify:
   - [ ] Icon displays correctly
   - [ ] Name and description show properly
   - [ ] Author/company info visible
```

---

## Phase 4: Build & Package Automation

### Tasks
- [ ] **Create build script** `scripts/build-release.sh`
  - [ ] Build web assets: `pnpm build:web`
  - [ ] Copy to `Plugin/EmbeddedAssets/web/`
  - [ ] Build C# plugin: `dotnet build --configuration Release`
  - [ ] Copy outputs to release directory
  - [ ] Create Yak package (requires yak CLI tool)

- [ ] **Install Yak package manager**
  ```bash
  # Download from https://github.com/mcneel/yak/releases
  # Add to PATH
  yak --version  # Verify installation
  ```

- [ ] **Create manifest.yml**
  - [ ] Define package metadata
  - [ ] Set version number
  - [ ] List authors and contact
  - [ ] Add description and keywords
  - [ ] Specify Rhino version requirements
  - [ ] Add icon path

### Build Script Execution
```bash
chmod +x scripts/build-release.sh
./scripts/build-release.sh

# Expected outputs:
# - releases/net7.0/Selva.gha
# - releases/net48/Selva.gha
# - releases/net7.0/Selva-1.0.0.yak
# - releases/net48/Selva-1.0.0.yak (if building both)
```

---

## Phase 5: Yak Package Configuration

### Tasks
- [ ] **Create manifest.yml** in project root
  ```yaml
  name: Selva
  version: 1.0.0
  title: Selva - Web UI Builder
  description: Web-based UI builder for Grasshopper definitions
  authors:
    - Your Name (your.email@example.com)
  url: https://github.com/yourorg/selva
  icon: icon.png
  min-rhino-version: 7.0
  ```

- [ ] **Generate Yak package**
  ```bash
  cd releases/net7.0
  yak build ../../manifest.yml
  # Creates: Selva-1.0.0.yak
  ```

### Verification Steps
```bash
# List contents of .yak file
yak search Selva

# Test installation
# Create test Grasshopper libraries folder
# Copy .yak file there
# Verify auto-extraction and component availability
```

---

## Phase 6: Documentation & Release Materials

### Tasks
- [ ] **Create comprehensive README.md**
  - [ ] Installation instructions
  - [ ] Feature overview
  - [ ] System requirements
  - [ ] Troubleshooting guide
  - [ ] Support contact information

- [ ] **Create CHANGELOG.md**
  - [ ] Version history
  - [ ] Notable changes per version
  - [ ] Breaking changes (if any)

- [ ] **Create DEVELOPMENT.md** (for contributors)
  - [ ] Development setup
  - [ ] Build instructions
  - [ ] Testing procedures
  - [ ] Contributing guidelines

- [ ] **Create LICENSE.md**
  - [ ] Choose license (recommended: MIT)
  - [ ] Add license text

### Files to Create
```
Project Root
├── README.md         (User-facing installation)
├── CHANGELOG.md      (Version history)
├── DEVELOPMENT.md    (Developer guide)
├── LICENSE           (MIT or chosen license)
├── icon.png          (24x24 plugin icon)
└── manifest.yml      (Yak metadata)
```

---

## Phase 7: Testing & Quality Assurance

### Tasks
- [ ] **Automated Testing**
  ```bash
  pnpm test           # Run all tests
  pnpm type-check     # TypeScript verification
  pnpm lint           # Code quality
  ```

- [ ] **Build Verification**
  ```bash
  # Test C# plugin builds for both targets
  cd Plugin
  dotnet build --configuration Release
  # Verify both net7.0 and net48 .gha files created
  ```

- [ ] **Manual Integration Testing**
  - [ ] Copy .gha to Grasshopper Libraries folder
  - [ ] Restart Rhino completely
  - [ ] Create test Grasshopper definition
  - [ ] Add contextual parameters (sliders, value lists)
  - [ ] Add UIBuilderComponent
  - [ ] Enable component
    - [ ] Verify browser opens automatically
    - [ ] Verify correct localhost URL (not :5173)
    - [ ] Verify web UI loads completely
  - [ ] Test schema builder
    - [ ] Drag parameters
    - [ ] Create layouts
    - [ ] Save schema
  - [ ] Test preview mode
    - [ ] Modify values in web UI
    - [ ] Verify values appear in Grasshopper
    - [ ] Verify Grasshopper updates trigger web UI
  - [ ] Test 3D viewer
    - [ ] Connect geometry output
    - [ ] Verify geometry displays in web view
  - [ ] Disable component
    - [ ] Verify servers stop cleanly
    - [ ] Verify no errors in Grasshopper messages

- [ ] **Cross-Platform Testing**
  - [ ] Windows (Rhino 7 & 8)
  - [ ] macOS (Rhino 8+)
  - [ ] Test both net48 and net7.0 builds

- [ ] **Performance Profiling**
  - [ ] Measure plugin load time
  - [ ] Measure web server startup time
  - [ ] Verify no memory leaks on repeated enable/disable
  - [ ] Check CPU usage with idle definition

---

## Phase 8: Food4Rhino Preparation

### Tasks
- [ ] **Create Food4Rhino Account**
  - [ ] Register at https://food4rhino.com
  - [ ] Verify email
  - [ ] Create publisher profile
  - [ ] Set up payment method (if selling)

- [ ] **Prepare Package**
  ```
  Release Package Contains:
  - [ ] Selva-1.0.0.yak (main package)
  - [ ] README.md (installation guide)
  - [ ] CHANGELOG.md (version history)
  - [ ] icon-large.png (512x512 for store display)
  - [ ] screenshots/ (at least 2-3 usage screenshots)
  - [ ] LICENSE.md
  ```

- [ ] **Create Marketing Materials**
  - [ ] Write compelling description (500 chars max)
  - [ ] Create screenshots showing:
    - [ ] UI Builder interface
    - [ ] Preview mode with values updating
    - [ ] 3D geometry viewer
    - [ ] Grasshopper definition with component
  - [ ] Create short demo GIF (optional but recommended)

### Screenshots to Create
1. **Builder Interface** - Showing drag-and-drop layout editor
2. **Preview Mode** - Showing interactive UI with 3D viewer
3. **Grasshopper Definition** - Showing component in context
4. **Parameter Management** - Showing parameter configuration

---

## Phase 9: GitHub Release & Distribution

### Tasks
- [ ] **Create GitHub Release**
  - [ ] Tag version: `v1.0.0`
  - [ ] Write release notes
  - [ ] Attach .yak file(s) to release
  - [ ] Attach documentation PDFs (optional)

- [ ] **Submit to Food4Rhino**
  - [ ] Go to "My Plugins" > "Create New"
  - [ ] Upload .yak file
  - [ ] Fill in all metadata fields
  - [ ] Upload screenshots
  - [ ] Set pricing (free/paid)
  - [ ] Submit for review
  - [ ] Wait for Food4Rhino approval (24-72 hours typical)

- [ ] **Monitor Initial Release**
  - [ ] Watch for user issues and feedback
  - [ ] Be ready with patch releases if needed
  - [ ] Respond to user comments/questions

---

## Dependency Check (Before Release)

### C# Dependencies
- [ ] Grasshopper (v8.0.23304.9001 or later)
- [ ] Newtonsoft.Json (v13.0.3)
- [ ] System.Drawing.Common (v8.0.0 for net7.0)
- [ ] System.Windows.Forms (v4.0.0)
- [ ] Microsoft.Extensions.Logging (v7.0.0)

### TypeScript/Node Dependencies
- [ ] Node.js >= 18.0.0
- [ ] pnpm >= 9.0.0
- [ ] SvelteKit and all web package dependencies

### System Requirements
- [ ] Windows: .NET Runtime 7.0 or .NET Framework 4.8
- [ ] macOS: .NET Runtime 7.0
- [ ] Rhino 7.0+ (Windows) or Rhino 8.0+ (macOS)

---

## Version Management

### Release Version Updates
When releasing v1.1.0, update in these locations:

1. **Plugin/Selva.csproj**
   ```xml
   <Version>1.1.0</Version>
   ```

2. **packages/builder/package.json**
   ```json
   "version": "1.1.0"
   ```

3. **manifest.yml**
   ```yaml
   version: 1.1.0
   ```

4. **CHANGELOG.md**
   - Add section for v1.1.0
   - List all changes

5. **GitHub Release Tag**
   - Create tag: `v1.1.0`

---

## Pre-Release Checklist (Final)

Before publishing to Food4Rhino:

```
Code Quality
- [ ] All tests pass: pnpm test
- [ ] No TypeScript errors: pnpm type-check
- [ ] Linting passes: pnpm lint
- [ ] Code is formatted: pnpm format

Build Verification
- [ ] Release build succeeds: ./scripts/build-release.sh
- [ ] .gha file size is reasonable (< 10MB)
- [ ] Web assets embedded correctly
- [ ] Both net7.0 and net48 builds created

Manual Testing (on test machine)
- [ ] Plugin installs correctly
- [ ] Component appears in Grasshopper
- [ ] Component enables/disables without errors
- [ ] Web UI loads on enable
- [ ] Schema builder works
- [ ] Preview mode works
- [ ] Values sync bidirectionally
- [ ] 3D viewer displays geometry
- [ ] No memory leaks over extended use
- [ ] Clean shutdown on disable

Documentation
- [ ] README.md is complete and clear
- [ ] CHANGELOG.md lists all changes
- [ ] LICENSE.md is included
- [ ] Installation instructions are accurate

Metadata
- [ ] SelvaInfo.cs is complete
- [ ] Icon displays correctly
- [ ] manifest.yml is valid YAML
- [ ] Package information is accurate

Food4Rhino Preparation
- [ ] Screenshots are professional and clear
- [ ] Description is compelling
- [ ] Tags are appropriate
- [ ] Support contact is valid
- [ ] License is properly declared
```

---

## Post-Release Tasks

After Food4Rhino approval:

1. **Monitor Feedback**
   - Watch for user issues
   - Respond to comments and support requests
   - Track feature requests for future versions

2. **Prepare Patch Releases**
   - v1.0.1 for critical bugs
   - v1.0.2, etc. as needed
   - Follow same build and release process

3. **Plan Future Versions**
   - v1.1.0 for minor features
   - v2.0.0 for major rewrites
   - Keep public road map

4. **Community Engagement**
   - Create GitHub discussions
   - Answer user questions
   - Share tips and tutorials

---

## Troubleshooting Guide

### Build Issues

**Problem:** EmbeddedAssets not found during build
```
Solution:
1. Verify folder structure: Plugin/EmbeddedAssets/web/
2. Check Selva.csproj ItemGroup paths
3. Rebuild: dotnet clean && dotnet build
```

**Problem:** .gha file doesn't include web assets
```
Solution:
1. Verify EmbeddedResource ItemGroup in .csproj
2. Check that files exist before build
3. Rebuild and verify file size increased
4. Use 7z to inspect .gha contents
```

### Runtime Issues

**Problem:** Web server doesn't start
```
Solution:
1. Check port 8765 availability (netstat -an | grep 8765)
2. Check if another instance running
3. Verify HttpListener can access localhost
4. Check Windows Firewall settings
```

**Problem:** Web UI doesn't load
```
Solution:
1. Check browser console for 404 errors
2. Verify resource paths in LocalWebServer
3. Check that web assets were embedded
4. Verify correct MIME types for each file
```

**Problem:** WebSocket connection fails
```
Solution:
1. Verify both servers started (web + WebSocket)
2. Check browser Network tab for ws:// connection
3. Verify port 8765 is accessible
4. Check for firewall/proxy blocking
```

---

## File Size Reference

After embedding web assets, expected .gha file sizes:

- **net7.0 build:** 2-4 MB (with embedded web)
- **net48 build:** 2-4 MB (with embedded web)
- **Yak package:** 2-4 MB (compressed .yak)

If significantly larger, investigate:
- Uncompressed vs. compressed assets
- Duplicate dependencies
- Debug symbols (should be in separate file)

---

## Success Metrics

After release, track:

- ✅ Food4Rhino download count
- ✅ User ratings and reviews
- ✅ GitHub issues and feature requests
- ✅ Cross-platform compatibility reports
- ✅ Performance metrics from user feedback
- ✅ Community engagement (issues, PRs, discussions)

Aim for:
- 4.5+ star rating
- Zero critical bugs in first month
- < 1 hour average issue response time
- Regular updates (v1.0.1, v1.1.0 every 2-3 months)
