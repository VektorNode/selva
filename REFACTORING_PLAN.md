# UIBuilderComponent Refactoring Plan

## Current Issues

The `GH_UIBuilderComponent.cs` is **1342 lines** with multiple responsibilities:
- Component lifecycle management
- Value collection and extraction
- Document event handling
- WebSocket communication orchestration
- Schema validation and persistence
- UI state management

## Proposed Refactoring

### Phase 1: Extract Value Collection Logic

**New Class:** `ValueCollector`

**Location:** `Plugin/Utilities/Values/ValueCollector.cs`

**Responsibilities:**
- Collect current input values from parameters
- Collect output values from components
- Extract values from IGH_Goo types
- Extract FileDataGoo objects
- Handle ValueList parameter extraction

**Methods:**
```csharp
public Dictionary<string, object> CollectInputValues(GH_Document document, UISchema schema)
public Dictionary<string, object> CollectOutputValues(GH_Document document, UISchema schema)
public Dictionary<string, object> CollectFileOutputs(GH_Document document, UISchema schema)
private object ExtractValue(IGH_Goo data)
private object ExtractKeyFromValueListData(IGH_Goo data)
private object ExtractFileDataFromGoo(IGH_Goo gooObj)
```

**Impact:** Removes ~200 lines from UIBuilderComponent

---

### Phase 2: Extract Document Event Management

**New Class:** `DocumentEventManager`

**Location:** `Plugin/Utilities/Events/DocumentEventManager.cs`

**Responsibilities:**
- Register/unregister all document events
- Handle ObjectsAdded/ObjectsDeleted events
- Handle UndoStateChanged events
- Handle SolutionStart/SolutionEnd events
- Coordinate metadata change detection

**Key Features:**
- Event-based communication back to component via delegates
- Centralized event registration state tracking
- Clean disposal pattern

**Methods:**
```csharp
public void RegisterEvents(GH_Document document)
public void UnregisterEvents()
public void Dispose()

// Event handlers (private)
private void OnSolutionStart(object sender, GH_SolutionEventArgs e)
private void OnSolutionEnd(object sender, GH_SolutionEventArgs e)
private void OnObjectsChanged(object sender, GH_DocObjectEventArgs e)
private void OnUndoStateChanged(object sender, GH_DocUndoEventArgs e)
private void OnDocumentRemoved(GH_DocumentServer sender, GH_Document doc)

// Callbacks for component
public event EventHandler SolutionStarted
public event EventHandler SolutionEnded
public event EventHandler<ObjectsChangedEventArgs> ObjectsChanged
public event EventHandler<MetadataChangedEventArgs> MetadataChanged
```

**Impact:** Removes ~300 lines from UIBuilderComponent

---

### Phase 3: Extract Lifecycle State Management

**New Class:** `ComponentStateManager`

**Location:** `Plugin/Utilities/State/ComponentStateManager.cs`

**Responsibilities:**
- Track enable/disable state with button vs toggle detection
- Manage component lifecycle transitions
- Handle headless mode detection and logic
- Coordinate startup/shutdown sequences

**Methods:**
```csharp
public void ProcessEnableInput(bool currentEnable)
public bool IsEnabled { get; }
public bool IsHeadlessMode { get; }
public bool ShouldStartCommunication()
public bool ShouldStopCommunication()
public void Reset()
```

**State Properties:**
```csharp
private bool _isEnabled
private bool _lastEnable
private int _enableTrueCount
private bool _isSolving
```

**Impact:** Removes ~100 lines from UIBuilderComponent

---

### Phase 4: Create Guard Helper Methods

**New Static Class:** `DocumentGuards`

**Location:** `Plugin/Utilities/Helpers/DocumentGuards.cs`

**Responsibilities:**
- Centralize common null checks and guard clauses
- Provide fluent validation API

**Methods:**
```csharp
public static bool IsValid(GH_Document document, out string error)
public static bool HasSchema(UISchema schema, out string error)
public static bool IsConnected(CommunicationHandler handler, out string error)
public static bool AllValid(GH_Document document, UISchema schema,
    CommunicationHandler handler, out string error)
```

**Impact:** Reduces repetitive null checks throughout component

---

### Phase 5: Extract Message Creation Logic

**New Class:** `ComponentMessageFormatter`

**Location:** `Plugin/Utilities/UI/ComponentMessageFormatter.cs`

**Responsibilities:**
- Generate status messages for component info output
- Format component display messages (Message property)
- Create consistent error/warning messages

**Methods:**
```csharp
public static string CreateInfoMessage(string sessionId, bool isEnabled,
    UISchema schema, bool isConnected)
public static string CreateDisplayMessage(ComponentState state)
public static string CreateErrorMessage(string context, string error)
```

**Impact:** Removes ~50 lines from UIBuilderComponent, improves consistency

---

## Repetitive Logic Consolidation

### 1. Value Extraction Logic

**Current State:** Similar extraction patterns repeated in:
- `CollectCurrentValues()` (lines 531-598)
- `CollectAndSendOutputs()` (lines 674-803)

**Solution:** Consolidate into `ValueCollector` with reusable extraction methods

### 2. Null/Validation Checks

**Current State:** Repeated patterns like:
```csharp
var document = OnPingDocument();
if (document == null) { ... }

if (_embeddedSchema == null) { ... }

if (!_communicationHandler.IsRunning) { ... }
```

**Solution:** Use guard methods or create validated context objects:
```csharp
if (!TryGetValidContext(out var context, out var error)) {
    AddRuntimeMessage(GH_RuntimeMessageLevel.Error, error);
    return;
}
// context has: document, schema, handler all validated
```

### 3. Broadcast and Wait Pattern

**Current State:** Repeated pattern (lines 1131-1137, 1181-1187):
```csharp
var broadcastTask = _communicationHandler.BroadcastMessage(...);
try { broadcastTask.Wait(10); }
catch { }
```

**Solution:** Add helper method in CommunicationHandler:
```csharp
public void BroadcastAndWait(string messageType, object data, int timeoutMs = 10)
```

### 4. Schema Validation Before Operations

**Current State:** Multiple places validate schema before operations:
- Line 254-257 (headless mode)
- Line 313-316 (enable rising)
- Line 1147-1148 (objects changed)

**Solution:** Create `ValidatedSchema` wrapper or use guard methods consistently

---

## Implementation Order

1. **Start with ValueCollector** - Cleanest extraction, no dependencies
2. **Add DocumentGuards** - Simple helpers that benefit remaining work
3. **Extract ComponentStateManager** - Encapsulates enable/disable complexity
4. **Create DocumentEventManager** - Large reduction in component size
5. **Add ComponentMessageFormatter** - Final polish for UI messages

---

## Expected Benefits

### Before:
- UIBuilderComponent: ~1342 lines
- Multiple intertwined responsibilities
- Difficult to test individual behaviors
- Duplicated logic in multiple places

### After:
- UIBuilderComponent: ~600-700 lines (orchestration only)
- ValueCollector: ~200 lines
- DocumentEventManager: ~300 lines
- ComponentStateManager: ~100 lines
- DocumentGuards: ~50 lines
- ComponentMessageFormatter: ~50 lines

### Benefits:
- **46-52% reduction** in UIBuilderComponent size
- Clear separation of concerns
- Each class testable in isolation
- Reusable components for future features
- Easier to maintain and extend
- Reduced cognitive load when reading code

---

## Migration Strategy

1. Create new classes alongside existing code
2. Gradually migrate methods while keeping tests passing
3. Update UIBuilderComponent to use new classes
4. Remove old code once migration is complete
5. Add unit tests for extracted classes

---

## Non-Breaking Changes

All refactoring will be internal - the component's public API remains unchanged:
- Same inputs/outputs
- Same persistence format
- Same WebSocket protocol
- Same behavior from user perspective
