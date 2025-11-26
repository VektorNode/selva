# Selva Production Architecture - Visual Diagrams

## 1. Complete System Architecture (Production)

```
┌─────────────────────────────────────────────────────────────────────┐
│                          WINDOWS/MAC                                 │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │                  Rhino 7/8 Application                      │    │
│  │                                                             │    │
│  │  ┌──────────────────────────────────────────────────────┐  │    │
│  │  │        Grasshopper Canvas                            │  │    │
│  │  │                                                       │  │    │
│  │  │  [Param] [Param] [UI Builder] [Param]               │  │    │
│  │  │                                                       │  │    │
│  │  └──────────────────────────────────────────────────────┘  │    │
│  │                         │                                    │    │
│  │                    (Enable = true)                           │    │
│  │                         │                                    │    │
│  └────────────────────────┼────────────────────────────────────┘    │
│                           │                                         │
│                           ▼                                         │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │           Selva.gha Plugin (In-Memory)                     │    │
│  │                                                             │    │
│  │  ┌─────────────────────────────────────────────────────┐   │    │
│  │  │ LocalWebServer (HTTP)                               │   │    │
│  │  │ ├─ Port: auto-assigned (8080, 8081, etc.)          │   │    │
│  │  │ ├─ Serves: index.html                              │   │    │
│  │  │ ├─ Serves: /builder/**                             │   │    │
│  │  │ ├─ Serves: /preview/**                             │   │    │
│  │  │ ├─ Serves: /assets/**                              │   │    │
│  │  │ └─ Feature: SPA routing (fall back to index.html)  │   │    │
│  │  └─────────────────────────────────────────────────────┘   │    │
│  │                                                             │    │
│  │  ┌─────────────────────────────────────────────────────┐   │    │
│  │  │ CommunicationHandler (WebSocket)                    │   │    │
│  │  │ ├─ Port: 8765 (fixed)                              │   │    │
│  │  │ ├─ Protocol: ws://localhost:8765                   │   │    │
│  │  │ ├─ Message: ValueUpdateMessage                     │   │    │
│  │  │ ├─ Message: OutputUpdateMessage                    │   │    │
│  │  │ └─ Broadcasting: real-time to web UI               │   │    │
│  │  └─────────────────────────────────────────────────────┘   │    │
│  │                                                             │    │
│  │  ┌─────────────────────────────────────────────────────┐   │    │
│  │  │ Embedded Web Assets (Binary Resources)              │   │    │
│  │  │ ├─ index.html (embedded as resource)               │   │    │
│  │  │ ├─ _app/ (SvelteKit build output)                  │   │    │
│  │  │ ├─ builder/ (Schema editor files)                  │   │    │
│  │  │ ├─ preview/ (Interactive preview files)            │   │    │
│  │  │ ├─ assets/ (CSS, fonts, images)                    │   │    │
│  │  │ └─ Size: ~3-4 MB when compiled                     │   │    │
│  │  └─────────────────────────────────────────────────────┘   │    │
│  │                                                             │    │
│  │  ┌─────────────────────────────────────────────────────┐   │    │
│  │  │ SchemaManager (Parameter Scanning)                  │   │    │
│  │  │ ├─ Scans Grasshopper document                       │   │    │
│  │  │ ├─ Detects IGH_ContextualParameter instances       │   │    │
│  │  │ └─ Validates parameter types & GUID uniqueness      │   │    │
│  │  └─────────────────────────────────────────────────────┘   │    │
│  │                                                             │    │
│  │  ┌─────────────────────────────────────────────────────┐   │    │
│  │  │ ValueApplicator (Parameter Updates)                 │   │    │
│  │  │ ├─ Uses reflection to apply values                  │   │    │
│  │  │ ├─ Calls: AssignContextualDataTree()               │   │    │
│  │  │ ├─ Triggers: Grasshopper recompute                 │   │    │
│  │  │ └─ Collects: Output results for web UI             │   │    │
│  │  └─────────────────────────────────────────────────────┘   │    │
│  │                                                             │    │
│  └────────────────────────────────────────────────────────────┘    │
│                           │                                         │
│      (HTTP:8080)         │          (WS:8765)                      │
│      (SPA Router)        │          (Real-time)                    │
└───────────────┬──────────┼──────────────────┬─────────────────────┘
                │          │                  │
                │          │                  │
┌───────────────┴──────────┴──────────────────┴─────────────────────┐
│                                                                     │
│                     WEB BROWSER (localhost)                        │
│                                                                     │
│  http://localhost:8080/?session=abc123def45                        │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  SvelteKit Application (Svelte 5)                           │ │
│  │                                                              │ │
│  │  Routes:                                                     │ │
│  │  ├─ / (root redirect)                                       │ │
│  │  ├─ /builder (schema design with drag-drop)               │ │
│  │  ├─ /preview (interactive UI preview with WS updates)     │ │
│  │  └─ /app (Rhino Compute demo)                             │ │
│  │                                                              │ │
│  │  Components:                                                │ │
│  │  ├─ ParameterBuilder (drag-drop layout)                   │ │
│  │  ├─ InputControl (value sliders, text inputs)             │ │
│  │  ├─ OutputDisplay (text, numbers, 3D viewer)              │ │
│  │  ├─ ThreeViewer (3D geometry with Three.js)               │ │
│  │  └─ LayoutEditor (tabs, groups, grid arrangement)         │ │
│  │                                                              │ │
│  │  WebSocket Client (websocket.svelte.ts):                   │ │
│  │  ├─ Connects to: ws://localhost:8765                       │ │
│  │  ├─ Auto-reconnect with exponential backoff               │ │
│  │  ├─ Sends: ValueUpdateMessage on input change            │ │
│  │  └─ Receives: OutputUpdateMessage from Grasshopper       │ │
│  │                                                              │ │
│  │  State Management (Svelte 5 Runes):                        │ │
│  │  ├─ $state - UI schema                                     │ │
│  │  ├─ $state - current values                                │ │
│  │  ├─ $state - WebSocket connection status                  │ │
│  │  └─ $derived - computed displays                           │ │
│  │                                                              │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Data Flow: User Interaction

```
                    USER ACTION
                        │
                        ▼
        ┌───────────────────────────────┐
        │  User enables component       │
        │  (Toggle checkbox in GH)       │
        └──────────────┬────────────────┘
                       │
                       ▼
        ┌───────────────────────────────┐
        │  GH_UIBuilderComponent        │
        │  StartWebServer()             │
        └──────────────┬────────────────┘
                       │
         ┌─────────────┴─────────────┐
         │                           │
         ▼                           ▼
    LocalWebServer             Process.Start()
    starts on port 8080        opens browser
         │                           │
         │                           ▼
         │               http://localhost:8080/?session=ID
         │                           │
         │                           ▼
         │               ┌───────────────────────────┐
         │               │  Browser Loads /builder   │
         │               │  (SPA, served from assets)│
         │               └──────────────┬────────────┘
         │                              │
         │                              ▼
         │               ┌───────────────────────────┐
         │               │  User Designs UI Schema   │
         │               │  (Drag-drop parameters)   │
         │               └──────────────┬────────────┘
         │                              │
         │                              ▼
         │               ┌───────────────────────────┐
         │               │  WebSocket Connect        │
         │               │  ws://localhost:8765      │
         ├──────────────►│  (connects to plugin)     │
         │               └──────────────┬────────────┘
         │                              │
         │                ┌─────────────┴──────────┐
         │                │                        │
         │    ┌───────────▼────────────┐   ┌──────▼──────────────┐
         │    │ Listen for changes     │   │ Send schema         │
         │    │ in Grasshopper         │   │ to CommunicationH.  │
         │    └───────────┬────────────┘   └──────┬──────────────┘
         │                │                       │
         │    ┌───────────▼──────────────────────────────┐
         │    │  CommunicationHandler                    │
         │    │  Receives: SchemaSaveMessage             │
         │    │  Action: Persist schema to file          │
         │    │  Action: Broadcast to preview mode       │
         │    └────────────────────────────────────────┘
         │
         ▼
    Serves assets
    (index.html,
     CSS, JS, etc)
```

---

## 3. Real-Time Data Sync (Preview Mode)

```
WEB UI                          WebSocket                    PLUGIN
┌──────────────┐               (port 8765)              ┌──────────────┐
│              │                                         │              │
│ Slider: 50   │  ValueUpdateMessage                   │              │
│              │◄─────────────────────────────────────►│ Set Param    │
│              │  { values: {guid1: 50} }              │ to 50        │
│              │                                         │              │
│              │                                         │ Trigger      │
│              │                                         │ Recompute    │
│              │                                         │ │            │
│              │  OutputUpdateMessage                   │ ▼            │
│              │◄─────────────────────────────────────│ Collect      │
│              │  { outputs: {guid2: geometry} }       │ Results      │
│              │                                         │              │
│ 3D Viewer    │                                         │              │
│ updates      │                                         │              │
│              │                                         │              │
│ Text Output  │                                         │              │
│ updates      │                                         │              │
│              │                                         │              │
└──────────────┘                                         └──────────────┘

Latency: ~50-100ms (real-time feeling)
Direction: Bidirectional
Protocol: Binary WebSocket frames
Threading: Async on both sides
```

---

## 4. Session Lifecycle

```
TIMELINE                        STATE
───────────────────────────────────────────────────────────

User starts Rhino
│
▼
Rhino loads Selva.gha plugin
├─ Assembly loaded in memory
├─ Embedded web assets available
├─ Components registered
│
▼
User adds UIBuilderComponent to definition
│
├─ Component instance created
├─ Default state: Enabled = false
│
▼
User enables component (toggle checkbox)
│
├─ Enabled = true (triggers StartWebServer)
├─ LocalWebServer created
├─ LocalWebServer starts listening on port 8080
├─ CommunicationHandler starts listening on port 8765
├─ Session ID generated (8 random chars)
├─ Browser opened: http://localhost:8080/?session=ID
│
├─ WebSocket server ready to accept connection
├─ Web UI loads from embedded assets
├─ Web UI connects via WebSocket (port 8765)
├─ Both servers fully operational
│
▼
User designs schema (in /builder route)
│
├─ Drag parameters into layout
├─ Configure groups and tabs
├─ Save schema (sent via WebSocket)
├─ Plugin persists schema to session file
│
▼
User switches to preview mode (or /preview route)
│
├─ Web UI shows interactive UI
├─ Displays current parameter values
├─ Listens for WebSocket OutputUpdateMessage
├─ 3D viewer displays geometry (if available)
│
▼
User modifies value in web UI
│
├─ ValueUpdateMessage sent via WebSocket
├─ Plugin receives message
├─ ValueApplicator applies to Grasshopper params
├─ Grasshopper recomputes
├─ Plugin collects outputs
├─ OutputUpdateMessage sent back
├─ Web UI updates display in real-time
│
▼
User disables component (toggle checkbox)
│
├─ Enabled = false (triggers StopWebServer)
├─ LocalWebServer stops listening
├─ CommunicationHandler stops listening
├─ WebSocket connection closes
├─ Browser loses connection
├─ Graceful cleanup complete
│
▼
User closes Rhino
│
├─ All servers shut down
├─ Memory released
├─ Plugin unloaded from assembly
```

---

## 5. File Embedding Process

```
BUILD PHASE 1: Build Web Assets
──────────────────────────────────
pnpm build:web
    │
    └─► SvelteKit compilation
         │
         └─► packages/builder/build/
              ├─ index.html
              ├─ _app/
              │  ├─ immutable/
              │  │  └─ chunks/
              │  │     ├─ index-abc123.js
              │  │     ├─ builder-def456.js
              │  │     └─ ...
              │  └─ version.json
              ├─ builder/
              │  └─ +page.svelte.server.js (etc)
              ├─ preview/
              │  └─ +page.svelte.server.js (etc)
              ├─ assets/
              │  ├─ fonts/
              │  └─ images/
              └─ ... (all SvelteKit build output)

BUILD PHASE 2: Copy to Plugin Resources
────────────────────────────────────────
mkdir -p Plugin/EmbeddedAssets/web
cp -r packages/builder/build/* Plugin/EmbeddedAssets/web/

Plugin/
└─ EmbeddedAssets/
   └─ web/
      ├─ index.html
      ├─ _app/
      ├─ builder/
      ├─ preview/
      ├─ assets/
      └─ ...

BUILD PHASE 3: Compile .gha File
─────────────────────────────────
dotnet build --configuration Release
    │
    ├─ C# compilation
    ├─ EmbeddedResource inclusion
    │  (files in EmbeddedAssets/web become assembly resources)
    │
    └─► bin/Release/net7.0/Selva.gha
         └─ Compressed binary with:
            ├─ Plugin code (.NET IL)
            ├─ Dependencies (assemblies)
            └─ Embedded Resources (web assets)

BUILD PHASE 4: Create Yak Package
──────────────────────────────────
yak build manifest.yml
    │
    ├─ Read: manifest.yml metadata
    ├─ Include: Selva.gha
    ├─ Compress: ZIP format
    │
    └─► Selva-1.0.0.yak
        (Same as .gha, just in Yak format for distribution)

RUNTIME: Extract and Use
──────────────────────────
1. User downloads .yak from Food4Rhino
2. Grasshopper auto-extracts to libraries folder
3. Rhino restarts, loads Selva.gha
4. Assembly loads in memory, embedded resources available
5. LocalWebServer accesses embedded resources via:
   Assembly.GetManifestResourceStream("Selva.EmbeddedAssets.web.index.html")
6. Serves to browser from memory (fast!)
```

---

## 6. Port Assignment Strategy

```
BEFORE (Current Development)
────────────────────────────
Web Dev Server:  localhost:5173   (fixed SvelteKit default)
WebSocket:       localhost:8765   (fixed, from AppConfig)
Problem: Hard to remember, can conflict with other services


AFTER (Production)
──────────────────
HTTP Server:
  ├─ Preferred: localhost:8080
  ├─ Fallback: localhost:8081
  ├─ Fallback: localhost:8082
  ├─ ... (auto-finds available port)
  └─ Assignment: Dynamic at startup

WebSocket:       localhost:8765   (fixed, still from AppConfig)
  ├─ Used only when in preview mode
  └─ Both servers must start together


PORT CONFLICT RESOLUTION
────────────────────────
TcpListener tcpListener = new(IPAddress.Loopback, 0);
  // Port 0 = let OS choose available port

tcpListener.Start();
int availablePort = ((IPEndPoint)tcpListener.LocalEndpoint).Port;
tcpListener.Stop();
  // Returns first available port (usually 8080+)


BROWSER URL
───────────
http://localhost:{DYNAMIC_PORT}/?session={SESSION_ID}

Example:
  First session:  http://localhost:8080/?session=abc123
  Second session: http://localhost:8081/?session=def456
  (Multiple Rhino instances can run simultaneously!)
```

---

## 7. Component Enable/Disable State Machine

```
                    ┌──────────────────────────────┐
                    │   COMPONENT CREATED           │
                    │   (Enabled = false)           │
                    │   No servers running          │
                    └──────────────┬─────────────────┘
                                   │
                                   │ User enables
                                   │ Enabled = true
                                   ▼
                    ┌──────────────────────────────┐
                    │   STARTING                    │
                    │                              │
                    │   ├─ SessionId generated     │
                    │   ├─ LocalWebServer.Start()  │
                    │   ├─ Port assigned          │
                    │   ├─ CommunicationHandler    │
                    │   │  .Start()                │
                    │   └─ Browser opened         │
                    │                              │
                    └──────────────┬─────────────────┘
                                   │
                                   ▼
                    ┌──────────────────────────────┐
                    │   RUNNING                     │
                    │                              │
                    │   ├─ HTTP server active     │
                    │   ├─ WebSocket server ready │
                    │   ├─ Schema designer works  │
                    │   ├─ Preview syncs with WS  │
                    │   └─ Browser connected      │
                    │                              │
                    └──────────────┬─────────────────┘
                                   │
                                   │ User disables
                                   │ Enabled = false
                                   ▼
                    ┌──────────────────────────────┐
                    │   STOPPING                    │
                    │                              │
                    │   ├─ LocalWebServer.Stop()  │
                    │   ├─ Browser disconnects    │
                    │   ├─ CommunicationHandler   │
                    │   │  .Stop()                 │
                    │   ├─ Port released          │
                    │   └─ Session cleanup        │
                    │                              │
                    └──────────────┬─────────────────┘
                                   │
                                   ▼
                    ┌──────────────────────────────┐
                    │   STOPPED                     │
                    │   (Enabled = false)          │
                    │   No servers running         │
                    │   Ready to enable again      │
                    └──────────────────────────────┘
```

---

## 8. Error Handling & Recovery

```
ERROR SCENARIO                  HANDLING
─────────────────────────────────────────────────────────────

Port 8765 in use               Try ports 8766, 8767, ... (ConfigManager)
(WebSocket)

Port 8080+ all busy            Log error, component fails gracefully
(HTTP)                         User can retry by disabling/enabling

Browser doesn't open           Log warning, user can open URL manually
                               from component context menu

WebSocket connection lost      Auto-reconnect with exponential backoff
                               (web UI: websocket.svelte.ts)

Asset file not found           LocalWebServer returns 404
(missing in build)             SPA fallback: serve index.html instead

Bad JSON in message            CommunicationHandler logs, continues
(malformed WebSocket)          Message dropped, no crash

Grasshopper recompute fails    Status shown in browser
                               WebSocket still connected

Plugin unloads unexpected      RemovedFromDocument() cleanup
                               Servers stop gracefully

Memory leak (long sessions)    Periodic session cleanup (24h timeout)
                               Value cache cleared on disable

RECOVERY STRATEGIES
───────────────────
1. Auto-reconnect (Web UI)
2. Graceful fallback (SPA routing)
3. Clear error messages (browser console + Grasshopper)
4. Manual retry (disable/enable component)
5. Cleanup on exit (RemovedFromDocument)
```

---

## 9. Deployment Timeline (User Perspective)

```
TIME    USER ACTION                      SYSTEM STATE
────────────────────────────────────────────────────────────────

T0      Downloads .yak from Food4Rhino   File on disk (2-4 MB)

T0+10s  Drags .yak to Components folder  Auto-extraction starts

T0+15s  Sees "Selva" in plugin list     Assembly loads ready

T0+30s  Restarts Rhino                  Rhino initializes

T0+35s  Rhino fully loaded               Plugin registered

T0+40s  Adds UIBuilderComponent          Component instance ready

T0+45s  Enables component                Servers start (< 1 sec)
        (toggles checkbox)               Browser opens immediately

T0+50s  Sees UI Designer in browser      Web app fully loaded

T0+55s  Starts designing schema          Schema builder responsive

T1m30s  Clicks "Preview"                 WebSocket connects

T1m35s  Modifies slider                  Value updates via WS (~50ms)

T2m00s  Sees geometry in 3D viewer       Real-time sync working

        >>> Production workflow complete!
```

---

## 10. Distribution Pipeline

```
DEVELOPMENT                GIT                 FOOD4RHINO
─────────────────────────────────────────────────────────────

Local edits
    │
    ├─ pnpm build:web
    ├─ plugin edits
    ├─ Tests pass
    │
    ▼
git commit + push
    │
    ▼ GitHub
    ├─ CI runs (optional)
    ├─ Tests pass
    │
    ▼
git tag v1.0.0
    │
    ▼ GitHub Release
    ├─ Write release notes
    ├─ Upload Selva-1.0.0.yak
    │
    ├─────────────────────────────────────────────────┐
    │                                                  │
    ▼                                                  │
Food4Rhino Plugin Page                                │
├─ New plugin entry                                   │
├─ Upload .yak file ◄─────────────────────────────────┘
├─ Fill metadata:
│  ├─ Description
│  ├─ Screenshots (3-4)
│  ├─ Keywords
│  ├─ Author info
│  ├─ Support URL
│  └─ License
│
├─ Review (24-72 hours)
│
▼
PUBLISHED
├─ Searchable on Food4Rhino
├─ One-click download
├─ Appears in plugin manager
└─ Ready for end users!
```

These diagrams provide a complete visual understanding of the production architecture and workflow.
