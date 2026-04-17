# Builder-App Exclusive Shared Package Usage

This document identifies all components, utilities, and types exported from the `@selva/shared` package that are **exclusively used by builder-app** and NOT used by compute-app.

## Shared Package Exports Used ONLY by Builder-App

### Components
These UI components are imported and used only in builder-app:

- **Toaster** - `packages/builder-app/src/routes/+layout.svelte`
  - Toast notification system for UI feedback
  - NOT used in compute-app (which uses individual toast calls)

- **ContextMenu** - `packages/builder-app/src/lib/components/builder/DraggableItem.svelte`
  - Right-click context menu for drag-and-drop items
  - Compute-app has no drag-and-drop functionality

### Utilities & Features
These utility functions are imported and used only in builder-app:

#### Schema & File Management
Located in `packages/shared/src/lib/utils/param-exporter.ts` and `packages/shared/src/lib/features/preview/handlers.ts`:
- **exportSchemaAsFile** - Export schema to JSON file
- **importSchemaFromFile** - Import schema from JSON file
- **downloadParametersAsJSON** - Download parameters as JSON
- **downloadParametersAsCSV** - Download parameters as CSV
- **getExportedParametersAsJSON** - Get JSON string of parameters
- **getExportedParametersAsCSV** - Get CSV string of parameters
- **ExportedSchema** (type)

**Files using these:**
- `packages/builder-app/src/lib/utils/schema-exporter.ts` (re-exports + extends)
- `packages/builder-app/src/lib/components/builder/SchemaInfoPanel.svelte`
- `packages/builder-app/src/lib/components/builder/SchemaImportDialog.svelte`

#### WebSocket Communication
Located in `packages/shared/src/lib/app.config.ts` and builder-app internal:
- **DEFAULT_WEBSOCKET_PORT** - Default WebSocket port constant
- **WEBSOCKET_PORT_QUERY_PARAM** - Query parameter for WebSocket port
- **getWebSocketPortFromUrl** - Extract WebSocket port from URL
- **initializeWebSocketSession** - Initialize WebSocket connection to Grasshopper
- **processInitialDataSchema** - Process initial schema from WebSocket

**Files using these:**
- `packages/builder-app/src/lib/utils/session.ts`
- `packages/builder-app/src/routes/+page.svelte` (preview)
- `packages/builder-app/src/routes/builder/+page.svelte`

#### State Management (WebSocket)
Located in builder-app internal (not in shared):
- **getWebSocketState** - Get current WebSocket state
- **useBuilderState** - Composable for builder application state
- **useBuilderActions** - Composable for builder actions
- **SyncDiff** & **SyncChange** (types) - WebSocket sync types

**Files using these:**
- `packages/builder-app/src/lib/composables/useBuilderState.svelte.ts`
- `packages/builder-app/src/lib/composables/useBuilderActions.svelte.ts`
- `packages/builder-app/src/lib/components/builder/SyncDialog.svelte`
- `packages/builder-app/src/routes/preview/+page.svelte`
- `packages/builder-app/src/routes/builder/+page.svelte`

#### Drag & Drop System
Located in builder-app internal (not in shared):
- **dragStore** - Store for managing drag-and-drop state

**Files using this:**
- `packages/builder-app/src/lib/components/builder/DraggableItem.svelte`
- `packages/builder-app/src/lib/components/builder/DropZone.svelte`
- `packages/builder-app/src/lib/components/builder/EditableGroup.svelte`
- `packages/builder-app/src/lib/components/builder/TabEditor.svelte`

#### Builder-Specific Features
Located in builder-app internal (not in shared):
- **validateDefaultValue** - Validate default values for schema items
- **validateRuleValue** - Validate visibility rule values
- **getOperatorsForType** - Get available operators for rule creation
- **ACCEPTED_FILE_FORMATS** (from shared schema)
- **widget-config** - Widget configuration utilities
- **schema-exporter** - Schema export/import utilities
- **useSchemaHistory** - Schema undo/redo history management
- **useBuilderActions** - Builder operation actions

**Files using these:**
- `packages/builder-app/src/lib/utils/validation.ts`
- `packages/builder-app/src/lib/features/builder/widget-config.ts`
- `packages/builder-app/src/lib/utils/schema-exporter.ts`
- `packages/builder-app/src/lib/composables/useSchemaHistory.svelte.ts`
- Multiple builder component files

#### Footer System (Builder-Specific Usage)
- **initializeFooterContext** - Initialize footer context (called in builder-app root layout)
- **useFooterItem** - Register footer items (used by builder components like WsStatusFooter)

**Builder-App Specific Footer Items:**
- `WsStatusFooter` - WebSocket connection status footer item (builder-app only)
  - Shows WebSocket connection status to Grasshopper plugin
  - Located in `packages/builder-app/src/lib/components/WsStatusFooter.svelte`

**Files using these:**
- `packages/builder-app/src/routes/+layout.svelte` (initializes context)
- `packages/builder-app/src/lib/components/WsStatusFooter.svelte` (footer item)
- `packages/builder-app/src/routes/builder/+page.svelte`
- `packages/builder-app/src/routes/preview/+page.svelte`

### Summary by Category

| Category | Component/Utility | Used By | Location |
|----------|------------------|---------|----------|
| **UI** | Toaster | builder-app | Root layout |
| **UI** | ContextMenu | builder-app | Drag items |
| **Export** | exportSchemaAsFile | builder-app | Schema management |
| **Export** | importSchemaFromFile | builder-app | Schema management |
| **Export** | downloadParametersAsJSON/CSV | builder-app | Parameter export |
| **WebSocket** | getWebSocketPortFromUrl | builder-app | Session init |
| **WebSocket** | initializeWebSocketSession | builder-app | Session init |
| **WebSocket** | getWebSocketState | builder-app | Builder state |
| **Validation** | validateDefaultValue | builder-app | Input validation |
| **Validation** | validateRuleValue | builder-app | Rule validation |
| **Drag-Drop** | dragStore | builder-app | Builder UI |
| **Footer** | WsStatusFooter | builder-app | Connection status |

## What is Shared Between Both Apps

Both builder-app and compute-app use these shared exports:

### Shared Components
- **PageContainer** - Layout container
- **PageHeader** - Header bar
- **PageFooter** - Footer bar
- **Card** - Card component
- **Button** - Button component
- **Badge** - Badge component
- **Input** - Input field
- **Label** - Form label
- **Select** - Select dropdown
- **Dialog** - Dialog modal
- **AlertDialog** - Alert dialog
- **Textarea** - Text area
- **Alert** - Alert component

### Shared Utilities
- **toast** - Toast notifications
- **initializeFooterContext** - Footer system initialization
- **StateDisplay** - Display application state
- **ComputeApp** - Compute application component (compute-app main)
- **ErrorScreen** - Error page component
- **ACCEPTED_FILE_FORMATS** - File format constants from schema
- **themeStore** - Theme management

## Recommendations

If the goal is to reduce shared package size or move builder-specific features:

### Can be extracted to builder-app
- All schema export/import utilities (param-exporter related functions)
- WebSocket utilities (if WebSocket is builder-only)
- Drag-and-drop system and related components
- Builder-specific validation functions
- WsStatusFooter component

### Must remain in shared
- UI components (Button, Card, Input, Dialog, etc.)
- Layout components (PageContainer, PageHeader, PageFooter)
- Core utilities (toast, file download, etc.)
- ErrorScreen, theme management
- Type exports from schema

### Compute-App Only Needs
- Layout system (PageContainer, PageHeader, PageFooter)
- Basic UI components (Button, Card, Badge, Input, Label, Dialog, Alert)
- ComputeApp component
- ErrorScreen
- StateDisplay
- toast utility
- Theme management
- Footer system (basic)
