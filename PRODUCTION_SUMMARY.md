# Selva Production-Ready: Executive Summary

## Current State → Production State

### The Problem
Currently, Selva requires:
1. Building the web app separately
2. Running a dev server on port 5173
3. Manually installing the plugin
4. Two services running simultaneously
5. Complex setup for end users

**Result:** Not suitable for Food4Rhino distribution

### The Solution
Embed the web assets into the plugin:
1. Single `.gha` file includes everything
2. Built-in HTTP server serves web UI
3. Automatic browser launch on component enable
4. Zero external dependencies or setup
5. One-click installation via Food4Rhino

**Result:** Production-ready for distribution

---

## Architecture Change (One Page)

```
BEFORE (Development)
┌─────────────────────┐          ┌──────────────────────┐
│  Selva.gha          │◄──需要──►│  localhost:5173      │
│  (Plugin)           │   两个   │  (Dev Web Server)    │
│  port 8765          │  进程    │  (SvelteKit)         │
└─────────────────────┘          └──────────────────────┘

AFTER (Production)
┌──────────────────────────────────┐
│  Selva.gha (Plugin)              │
│  ├─ Grasshopper Components       │
│  ├─ WebSocket Server (8765)      │
│  ├─ HTTP Server (random port)◄──┐
│  └─ Embedded Web Assets          │
│      ├─ index.html               │
│      ├─ builder/**               │
│      ├─ preview/**               │
│      └─ assets/**                │
│                                  │
│  Single executable file!         │
└──────────────────────────────────┘
         ↑
    Browser connects
    (automatic)
```

---

## Implementation: 5 Core Files to Create/Modify

### 1. **LocalWebServer.cs** (NEW)
```
Location: Plugin/Utilities/Communication/LocalWebServer.cs
Purpose: Embedded HTTP server for serving web assets
Lines: ~300 (see CODE_EXAMPLES.md for full implementation)
```

### 2. **GH_UIBuilderComponent.cs** (MODIFY)
```
Location: Plugin/Components/UI/GH_UIBuilderComponent.cs
Changes: Add _webServer field, StartWebServer(), StopWebServer() methods
Impact: Integrates LocalWebServer into component lifecycle
```

### 3. **Selva.csproj** (MODIFY)
```
Location: Plugin/Selva.csproj
Changes: Add <EmbeddedResource> ItemGroup for web assets
Adds: Metadata (version, description, license for Yak)
```

### 4. **manifest.yml** (NEW)
```
Location: Project root
Purpose: Yak package metadata for Food4Rhino
Lines: ~50 (standard Yak format)
```

### 5. **SelvaInfo.cs** (ENHANCE)
```
Location: Plugin/SelvaInfo.cs
Changes: Fill in all metadata, load icon from embedded resource
```

---

## Build Process: 3 Steps

### Step 1: Build Web Assets
```bash
pnpm build:web
# Creates: packages/builder/build/
# Contains: index.html, _app/, builder/, preview/, assets/
```

### Step 2: Copy to Plugin
```bash
mkdir -p Plugin/EmbeddedAssets/web
cp -r packages/builder/build/* Plugin/EmbeddedAssets/web/
```

### Step 3: Build Plugin
```bash
cd Plugin
dotnet build --configuration Release
# Creates: bin/Release/net7.0/Selva.gha (net48 too)
```

### (Optional) Create Yak Package
```bash
cd releases/net7.0
yak build ../../manifest.yml
# Creates: Selva-1.0.0.yak
```

---

## Distribution Checklist (10 Items)

- [ ] **Code**: LocalWebServer.cs implemented and tested
- [ ] **Plugin**: Web assets embedded, component launches server
- [ ] **Metadata**: SelvaInfo.cs complete with author/description
- [ ] **Configuration**: Selva.csproj updated with version/metadata
- [ ] **Manifest**: manifest.yml created with Yak format
- [ ] **Icon**: 24x24 PNG created and embedded
- [ ] **Documentation**: README.md with install instructions
- [ ] **Testing**: Manual test on Windows and macOS
- [ ] **Build Script**: build-release.sh created for automation
- [ ] **Food4Rhino**: Account setup and ready to publish

---

## Key Metrics & Expectations

### File Sizes
- **Current net7.0/Selva.gha**: ~100KB (plugin only)
- **Production net7.0/Selva.gha**: ~2-4MB (with embedded web)
- **Yak package (.yak)**: ~2-4MB (compressed)
- **Food4Rhino download**: ~2-4MB (single file)

### Performance
- **Plugin load time**: < 500ms
- **Web server startup**: < 100ms
- **Browser open time**: < 2s (depends on browser)
- **First page load**: < 1s
- **Memory usage**: ~50-100MB while running

### User Experience (After Distribution)
```
User Action                     Time
─────────────────────────────────────
1. Download .yak                 30s
2. Drag to Grasshopper folder    2s
3. Restart Rhino                 5s
4. Add UIBuilderComponent        2s
5. Enable component              1s
6. Browser opens automatically   2s
─────────────────────────────────────
Total setup time:               42s
```

---

## Food4Rhino Publishing Steps

### Account & Setup (One-time)
1. Create account at food4rhino.com
2. Complete publisher profile
3. Link GitHub repository (optional)

### Publishing (Per Release)
1. **Prepare Package**
   - Build with `./scripts/build-release.sh`
   - Verify `Selva-1.0.0.yak` created
   - Prepare screenshots (3-4 images)
   - Write description (500 chars max)

2. **Create GitHub Release**
   - Tag: `v1.0.0`
   - Attach `.yak` file
   - Write release notes

3. **Upload to Food4Rhino**
   - My Plugins > Create New
   - Upload `.yak` file
   - Add metadata (screenshots, keywords, etc.)
   - Submit for review (24-72 hours)

4. **Monitor**
   - Check for user feedback
   - Respond to issues
   - Plan updates

---

## Testing Strategy (Before Release)

### Automated
```bash
pnpm test              # Run all tests
pnpm type-check        # TypeScript verification
pnpm lint              # Code quality checks
```

### Manual (Windows)
```
1. Build: ./scripts/build-release.sh
2. Copy: Selva.gha to %APPDATA%\Grasshopper\Libraries\
3. Restart Rhino
4. Test: Add component, enable, verify browser opens
5. Verify: Schema building, preview mode, WebSocket communication
```

### Manual (macOS)
```
1. Build: ./scripts/build-release.sh
2. Copy: Selva.gha to ~/Library/Application\ Support/McNeel/Rhinoceros/8.0/Plug-ins/Grasshopper/Libraries/
3. Restart Rhino
4. Same tests as Windows
```

---

## Version Management

Keep three locations synchronized:

```
Plugin/Selva.csproj:
<Version>1.0.0</Version>

packages/builder/package.json:
"version": "1.0.0"

manifest.yml:
version: 1.0.0
```

When releasing v1.0.1:
1. Update all three files
2. Run `./scripts/build-release.sh`
3. Create GitHub release `v1.0.1`
4. Upload to Food4Rhino

---

## Estimated Effort

| Phase | Time | Priority |
|-------|------|----------|
| Create LocalWebServer.cs | 4-6 hours | CRITICAL |
| Integrate into component | 2-3 hours | CRITICAL |
| Test & debug | 4-6 hours | CRITICAL |
| Metadata & docs | 3-4 hours | HIGH |
| Yak packaging | 2-3 hours | HIGH |
| Food4Rhino setup | 1-2 hours | MEDIUM |
| **TOTAL** | **16-24 hours** | |

**Can be done in 2-3 days of focused work**

---

## Success Criteria (After Release)

✅ Plugin installs with one click (Food4Rhino download)
✅ No external dependencies required
✅ Web server starts automatically
✅ Browser opens without manual steps
✅ Schema builder works in browser
✅ Preview mode updates in real-time
✅ 3D viewer displays geometry
✅ WebSocket communication works
✅ Graceful shutdown (no orphaned processes)
✅ Cross-platform (Windows 7+ and macOS 8+)
✅ Food4Rhino rating > 4 stars
✅ Zero critical bugs in first month

---

## Documentation Provided

1. **PRODUCTION_GUIDE.md** - Complete architecture and implementation guide
2. **IMPLEMENTATION_CHECKLIST.md** - Detailed step-by-step checklist with verification
3. **CODE_EXAMPLES.md** - Full code implementations ready to copy-paste
4. **PRODUCTION_SUMMARY.md** - This file (quick reference)

---

## Quick Start to Production

### If Starting Today:

**Day 1 (8 hours)**
- [ ] Create LocalWebServer.cs (from CODE_EXAMPLES.md)
- [ ] Test LocalWebServer independently
- [ ] Copy web assets to Plugin/EmbeddedAssets/web/
- [ ] Update Selva.csproj

**Day 2 (8 hours)**
- [ ] Integrate LocalWebServer into GH_UIBuilderComponent
- [ ] Test plugin loads and server starts
- [ ] Update SelvaInfo.cs with metadata
- [ ] Create manifest.yml
- [ ] Build and test on Windows

**Day 3 (4-6 hours)**
- [ ] Create build scripts
- [ ] Manual test on macOS (if possible)
- [ ] Write documentation
- [ ] Prepare Food4Rhino materials

**By end of Day 3:** Ready to publish! 🚀

---

## Next Steps

1. **Read** `PRODUCTION_GUIDE.md` for complete details
2. **Review** `CODE_EXAMPLES.md` for implementation details
3. **Follow** `IMPLEMENTATION_CHECKLIST.md` step-by-step
4. **Reference** this file for quick lookups
5. **Execute** build process with provided scripts

---

## Support Resources

- **Yak Documentation**: https://github.com/mcneel/yak
- **Food4Rhino**: https://food4rhino.com
- **Grasshopper SDK**: https://www.grasshopper3d.com
- **SvelteKit Deployment**: https://kit.svelte.dev/docs/adapter-auto

---

## Questions to Ask Yourself

✓ Do I understand embedding assets in .NET assemblies?
✓ Am I comfortable with HttpListener for local servers?
✓ Can I test on both Windows and macOS?
✓ Do I have Food4Rhino account ready?
✓ Am I ready to maintain the plugin after release?

If yes to all → You're ready to start!

---

**Current Status:** Documentation complete, ready for implementation

**Recommendation:** Start with LocalWebServer.cs implementation, follow checklist, and you'll have a production-ready plugin in 2-3 days.

Good luck! 🎉
