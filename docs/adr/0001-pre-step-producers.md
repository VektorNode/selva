# ADR 0001 — Pre-Step Producers

> **Frozen decision record.** V1 shipped 2026-05-08. The "Recommended architecture" and later sections describe future-state design that informed V1 — they are _not_ a roadmap. Treat anything below "V1 status: shipped" as historical context for _why_ V1 looks the way it does. For current behavior, the "V1 status" and "Getting started" sections below are authoritative.

## V1 status: shipped (2026-05-08)

The minimum-viable slice is live in both apps. The example JSON-paste producer and the "external inputs needed" warning panel were removed after smoke-testing — the underlying mechanism stays so values flow through whenever sessionStorage is populated, but there's no user-facing scaffolding until a real producer is built.

### Schema

`LayoutItemBase.source?: { kind: 'user' | 'external' }` — added at schema 2.8.0 with C# migration registered. Both TS and C# round-trip the field cleanly.

```jsonc
// In ui-schema.json
"source": {
  "type": "object",
  "properties": { "kind": { "enum": ["user", "external"] } },
  "required": ["kind"],
  "additionalProperties": false
}
```

Object form (not boolean) so future kinds (`pre-step`, `linked`, `computed`, `platform`) can carry their own fields without a breaking schema change.

### Keying

By **`paramId`** (Grasshopper instance GUID). Flows unchanged through every layer:

- Schema: input has `paramId`.
- Producer URL: `?for=<paramId>`.
- sessionStorage key: `external:<scopeKey>:<paramId>`.
- Solver lookup: `readExternalValue({ scopeKey, inputId: paramId })`.

The `scopeKey` is whatever uniquely identifies the solver context: `sessionId` in plugin-ui/preview, `definitionKey` in selva-app/library.

### Code that shipped

| Layer                   | File / Symbol                                                                                                                                        | Role                                                                                                                               |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Schema                  | [packages/schemas/ui-schema.json](../../packages/schemas/ui-schema.json)                                                                             | `InputSource` definition                                                                                                           |
| Migration               | [Plugin/Selva.Schema/Services/SchemaMigrator.cs](../../Plugin/Selva.Schema/Services/SchemaMigrator.cs)                                               | `MigrateTo_2_8_0`                                                                                                                  |
| Storage primitives      | [packages/ui/src/lib/external/storage.ts](../../packages/ui/src/lib/external/storage.ts)                                                             | `readExternalValue`, `writeExternalValue`, `clearExternalValue`, `getExternalInputs`. Re-exported from `@selvajs/ui`.              |
| Visibility fix          | [packages/ui/src/lib/schema/visibility-rules.ts](../../packages/ui/src/lib/schema/visibility-rules.ts)                                               | `evaluateVisibility` now honors static `item.visible === false` (was previously ignored — pre-existing bug uncovered by this work) |
| Builder UI toggle       | [packages/plugin-ui/src/lib/components/builder/BuilderGroupItem.svelte](../../packages/plugin-ui/src/lib/components/builder/BuilderGroupItem.svelte) | "External value" switch in the input editor; defaults `visible: false` when toggled on                                             |
| Plugin-UI solver        | [packages/plugin-ui/src/routes/preview/+page.svelte](../../packages/plugin-ui/src/routes/preview/+page.svelte)                                       | Reads sessionStorage on schema load and seeds external inputs into `state.values`. No warning UI.                                  |
| Plugin-UI initial solve | [packages/plugin-ui/src/lib/composables/usePreviewState.svelte.ts](../../packages/plugin-ui/src/lib/composables/usePreviewState.svelte.ts)           | Initial-solve timeout reads live `state.values` (was using stale snapshot — race condition fix)                                    |
| Compute-app             | [packages/ui/src/lib/components/compute/ComputeApp.svelte](../../packages/ui/src/lib/components/compute/ComputeApp.svelte)                           | Skips externals in `createInitialValues`, seeds from sessionStorage. No warning UI.                                                |

### How values reach Grasshopper

`values[paramId]` is set from sessionStorage → `transformInputParameter` wraps it per `paramType` (text/number/boolean) → `TreeBuilder.fromInputParams` builds the GH data tree server-side in [api/compute/+server.ts](../../packages/selva/src/routes/api/compute/+server.ts). For complex types (geometry, curves, etc.), use a **text** input on the schema and have the producer write a JSON-stringified payload — the GH definition parses it via a script component (parapet's pattern).

### What's intentionally absent in v1

- **No producer routes at all** — example was removed. Build a real one when ready (see "Getting started" below).
- **No warning UI** — the "external inputs needed" amber panel was removed in both apps. Add it back as a snippet/prop on `ComputeApp` (was a `missingExternalAction` snippet) or directly in `/preview` when you have a producer to point at.
- `source.producer` field — schema doesn't name producers yet. The "which producer fills which input" binding will live in the link the solver renders, hand-coded per-route until the registry is built.
- Producer registry / contract / `@selvajs/producers` package — full design captured below as future state.
- Lifetime/cleanup semantics for sessionStorage entries — currently never auto-clear.
- "Block solve when external missing" — values get sent to GH regardless of whether external is populated. GH falls back to its own defaults.
- Multiple external inputs ordering — each is independently fillable, no wizard flow.
- Inline producer (rendered in-place inside the solver) — only standalone routes today.

---

## Getting started: building your first concrete producer

When you're ready to replace the JSON-paste stub with a real one (line drawer, file uploader, sketch tool, etc.), follow this recipe. Most of the plumbing already exists.

### The two-layer rule (don't skip this)

A producer is **two things**, kept strictly separate:

1. **Domain-pure component** — knows about its own data model (lines, polylines, files, points). Fires `onDone(value)`. Could be lifted into another product unchanged. _Has no idea Selva exists._
2. **Producer route** — integration glue. Reads `?for=` from URL, hosts the component, on `onDone` calls `writeExternalValue(...)` and navigates back. _Knows nothing about the component's domain._

If your component imports anything Selva-specific, you've crossed the boundary. Push it up to the route.

### Recipe: "Line Drawer" producer (concrete walkthrough)

Pick this as the first one because it's representative of complex data and you have parapet's drawing logic to port from.

#### Step 1 — extract the domain-pure component

Take [parapet/.../service/segment-draw/parametric-line-app.svelte.ts](../../../parapet/packages/app/src/lib/services/segment-draw/parametric-line-app.svelte.ts) and the canvas component. Strip everything that touches Firebase, navigation, `objectState`, or any parapet-specific cache. The component should accept config props and fire `onDone(payload: LineData)`.

Land it in `packages/plugin-ui/src/lib/producers/line-drawer/LineDrawerApp.svelte` (or `packages/ui/...` if you want it usable across apps from day one).

#### Step 2 — create the producer route in each app

**Plugin-UI** — `packages/plugin-ui/src/routes/preview/producer/line-drawer/+page.svelte`:

```svelte
<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { writeExternalValue } from '@selvajs/ui';
	import LineDrawerApp from '$lib/producers/line-drawer/LineDrawerApp.svelte';

	const sessionId = $derived(page.url.searchParams.get('session') ?? '');
	const targetInputId = $derived(page.url.searchParams.get('for') ?? '');

	function handleDone(payload: unknown) {
		// For text inputs that hold JSON, stringify here so values[paramId] is a string
		// when ComputeApp's transformInputParameter casts to text.
		writeExternalValue({
			scopeKey: sessionId,
			inputId: targetInputId,
			value: JSON.stringify(payload)
		});
		goto(`/preview?session=${encodeURIComponent(sessionId)}`);
	}
</script>

<LineDrawerApp onDone={handleDone} />
```

**Compute-app** — same file at `packages/selva/src/routes/library/[guid]/producer/line-drawer/+page.svelte`. Difference: `scopeKey` comes from `page.params.guid`, navigates back to `/library/[guid]`.

#### Step 3 — wire the link in the solver

**Plugin-UI** — already done generically; just add a route to the URL. Edit `packages/plugin-ui/src/routes/preview/+page.svelte` where the missing-inputs panel renders the link, and pick the producer based on whatever logic you want (today it's hardcoded to `json-paste`):

```svelte
<a
	href={`/preview/producer/line-drawer?session=${encodeURIComponent(sessionId)}&for=${encodeURIComponent(ext.paramId)}`}
>
	Provide value →
</a>
```

If you want different inputs to route to different producers, branch here.

**Compute-app** — pass `missingExternalAction` to `ComputeApp`:

```svelte
<ComputeApp ... externalScopeKey={data.currentDefinition}>
	{#snippet missingExternalAction(ext)}
		<a
			href={`/library/${page.params.guid}/producer/line-drawer?for=${encodeURIComponent(ext.paramId)}`}
		>
			Provide value →
		</a>
	{/snippet}
</ComputeApp>
```

#### Step 4 — build a test schema

In the schema builder, add a text input, toggle "External value" on. Save. The schema should now have `source: { kind: 'external' }` on that input. Test in `/preview` first (faster iteration), then verify it works in selva-app once you have a definition uploaded.

#### Step 5 — verify end-to-end

1. Open the solver route → external panel appears.
2. Click "Provide value →" → land in line drawer.
3. Draw lines → click Done.
4. Land back on solver → panel gone, GH solves with the JSON payload as text → script component in the GH definition parses the JSON → output reflects the lines.

### Things to remember

- **For text inputs holding JSON**, the producer should `writeExternalValue({ value: JSON.stringify(payload) })` — keep `values[paramId]` a string so the selva-app's `transformInputParameter` doesn't fight you. (Or improve `transformInputParameter` to stringify objects when `paramType === 'text'` — see "future improvements" below.)
- **Persistence across reloads**: sessionStorage scope is per-tab. Want survival across tabs/devices? Add a backend store. The storage helpers in `@selvajs/ui` are pluggable — swap `sessionStorage` for an `IPlatformDataStore` call without changing callers.
- **The component should default to "no saved state"** unless you explicitly load it. Parapet's drawing app loaded from `curveDataCache`; for a clean start, skip that. You can re-add saved-state loading later.
- **One producer route, many entry points.** The solver renders a link, but a "Tools" menu, an external link, an email — anyone can deep-link to `/preview/producer/line-drawer?session=X&for=Y`. The producer doesn't care where the user came from.

### Future improvements worth knowing about

When you have the line drawer working, these become natural next steps:

1. **Smarter `transformInputParameter`**: cast to JSON.stringify when paramType is text and value is an object. Removes the "remember to stringify" footgun for producer authors.
2. **`source.producer` field**: schema declares which producer fills the input. Solver can render links generically without per-route hardcoding. This is the bridge to the full producer-registry design below.
3. **Lifetime semantics**: when a schema changes (an input gets removed), the orphaned sessionStorage entry leaks. Add a cleanup pass in `ComputeApp` / `usePreviewState`.
4. **"Edit" affordance**: today the panel only shows when the value is missing. After a value is provided, you can't get back to the producer to change it. Add an "Edit" link next to filled external inputs.

## Problem

Today, when a user lands on a solver route, the definition is solved immediately using whatever inputs are declared in the UI schema (sliders, text fields, file uploads, etc.).

We want to support **pre-steps** before the solve: tools that _generate_ input data the solver then consumes. Examples:

- Upload a STEP file → produces geometry → fed into a hidden `Geometry` input
- Run a line-drawer app → produces JSON of lines+metadata → fed into a hidden `text` input
- Future: point cloud uploader, sketch tool, etc.

Constraints:

1. Definitions without pre-steps must keep working with zero added complexity.
2. The pre-step input may not be visible to the end user (it's filled by the producer, not by them).
3. Should be flexible enough to grow — adding a 5th producer shouldn't ripple through the codebase.
4. Needs to work in both `plugin-ui` (designer picks producers) and `selva-app` (runtime renders + runs them).
5. Different deployments may want different producer subsets.

## Recommended architecture

### Schema side: keep it open, not a closed enum

Add an optional `source` field to input items in `ui-schema.json`:

```jsonc
"source": {
  "kind": "user" | "pre-step",        // optional; absent = "user" (default behavior unchanged)
  "producer": "string",                // OPEN string — NOT a discriminated union
  "config": { /* producer-specific, validated at runtime against producer.configSchema */ }
}
```

Why open string instead of discriminated union: keeps the producer set decoupled from schema regeneration. Adding a producer = no schema change = no type churn = true plugin system. Validation lives in the registry layer.

Plugin-UI convention: when a designer picks a producer for an input, default `visible: false` automatically (but allow override — e.g., for "show the user what they uploaded" cases).

### Producer contract — one module, multiple facets

```ts
interface PreStepProducer<TConfig, TOutput> {
	id: string; // e.g. "line-builder", later "@vendor/line-builder"
	displayName: string;
	outputDataType: GhDataType; // 'json' | 'geometry' | 'curves' | 'points' | ...
	acceptableInputs: WidgetType[]; // which input widgets this can attach to
	configSchema: ZodSchema<TConfig>; // drives the config UI in plugin-ui
	outputSchema: ZodSchema<TOutput>; // validates produced data at runtime
	ConfigEditor?: Component; // optional; falls back to auto-form from configSchema
	RunnerComponent: () => Promise<Component>; // lazy-loaded; rendered in selva-app pre-step phase
	toDataTree(output: TOutput, param: ParamMeta): DataTree; // serializer at solve time
	displayMode: 'inline' | 'fullscreen'; // inline panel vs. full-screen replacement
	persist?: 'session' | 'platform'; // where to persist user output across reloads
}
```

One module per producer. Self-contained. Adding a producer = one folder, one export, register it.

### Compatibility model

Each producer declares `acceptableInputs: WidgetType[]`. The plugin-ui dropdown filters producers by the current input's widget type:

```ts
const compatible = registry
	.all()
	.filter((p) => p.acceptableInputs.includes(currentInput.widgetType));
```

If a future widget needs different handling, the producer adds the new widget type to `acceptableInputs` and branches in `toDataTree` on `param.widgetType`. Growth happens at the producer level, not the schema level.

### Package layout

New workspace package consumed by both apps:

```
packages/producers/
  package.json         # private workspace package, like @selvajs/schemas
  src/
    contract.ts        # PreStepProducer interface, GhDataType enum, WidgetType union
    registry.ts        # ProducerRegistry interface + createRegistry factory
    builtin/
      line-builder/
        index.ts       # producer definition (metadata + toDataTree)
        Runner.svelte  # the drawing UI (lazy-loaded)
      file-upload/
        index.ts
        Runner.svelte
    index.ts           # exports defaultRegistry with all builtins
```

Both apps import:

```ts
import { defaultRegistry } from '@selvajs/producers';
```

Plugin-UI uses metadata + `configSchema` + `acceptableInputs`. Compute-app uses `RunnerComponent` + `toDataTree` + `outputSchema`. Tree-shaking + lazy `import()` for `RunnerComponent` keeps bundles tight.

### Platform integration

`@selvajs/platform` gets a producer policy interface:

```ts
interface IPlatformProducerPolicy {
	enabledProducerIds(): string[] | 'all'; // filter applied in selva-app
}
```

- Plugin-UI sees **all** producers (designers can target any deployment).
- Compute-app filters at load time; shows a clear error if a definition references a producer the current platform disables.

### Render filter (the simple part)

The schema already has `visible: boolean` on `LayoutItemBase` ([ui-schema.json:234-238](../../packages/schemas/ui-schema.json#L234-L238)). Today the plugin-ui only exposes the dynamic `visibilityCondition`; we add a static visibility toggle.

Renderer filter (in `AppLayout`):

```ts
function partitionInputs(schema) {
	return {
		userInputs: schema.inputs.filter((i) => !i.source || i.source.kind === 'user'),
		preStepInputs: schema.inputs.filter((i) => i.source?.kind === 'pre-step'),
		hidden: schema.inputs.filter((i) => i.visible === false)
	};
}
```

`AppLayout` consumes `userInputs`. The pre-step phase consumes `preStepInputs`. The solver merge consumes both.

### Runtime flow in selva-app

Replaces parapet's hand-written `buildLineValues` switch (see [parapet/.../compute/[slug]/+page.svelte:79-118](../../../parapet/packages/app/src/routes/compute/[slug]/+page.svelte#L79-L118)):

```ts
async function gatherPreStepValues(
	schema: Schema,
	preStepOutputs: Record<string, unknown> // collected from RunnerComponents
): Promise<Record<string, unknown>> {
	const merged: Record<string, unknown> = {};
	for (const input of schema.inputs) {
		if (input.source?.kind !== 'pre-step') continue;
		const producer = registry.get(input.source.producer);
		if (!producer) throw new Error(`Producer not available: ${input.source.producer}`);
		merged[input.id] = producer.toDataTree(preStepOutputs[input.id], input);
	}
	return merged;
}
```

Zero hardcoded nicknames, zero `inputType` switches, zero per-producer branches. Adding a producer touches _only_ `packages/producers/`.

## Plugin-UI UI changes (BuilderGroupItem & input editor)

Two concerns at different levels:

| Concern                                   | Lives on                           | Change                                                                                                                                                 |
| ----------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Static visibility toggle (`item.visible`) | All layout items (groups + inputs) | Add eye-icon toggle in [BuilderGroupItem.svelte:522-528](../../packages/plugin-ui/src/lib/components/builder/BuilderGroupItem.svelte#L522-L528) header |
| Pre-step producer dropdown                | Input items only                   | Add to input config editor; populated from registry, filtered by `acceptableInputs`                                                                    |

When the user picks a producer, default `visible: false` (with override).

## Where producers live: build-time vs. runtime

### Default (now): static workspace package, lazy-loaded runners

- All producers defined in `packages/producers/src/builtin/`.
- Both apps import `defaultRegistry` statically.
- `RunnerComponent` is a lazy `() => import('./Runner.svelte')` — keeps initial bundle small even with many producers.
- Adding a producer = new folder + redeploy.

**This is the only sane default for a pre-release product.** Don't build a plugin system without justification.

### Future options (design for the upgrade, don't build it)

| Option                       | Adds producer at runtime? | Type safety          | Security                     | Complexity           |
| ---------------------------- | ------------------------- | -------------------- | ---------------------------- | -------------------- |
| Lazy-loaded built-ins        | No (redeploy)             | Full                 | N/A                          | Low — **start here** |
| Remote ESM modules           | Yes (URL import)          | Lost                 | Code signing, CSP, allowlist | High                 |
| Iframe sandbox + postMessage | Yes (URL manifest)        | Lost across boundary | Strong (origin isolation)    | Medium-High          |

### Two design choices that keep the upgrade additive

**1. Registry as a factory, not a constant.** Today both apps use `defaultRegistry`. When runtime producers are needed, call `defaultRegistry.register(remoteProducer)` after loading. Contract, schema, runtime flow — all unchanged.

```ts
export interface ProducerRegistry {
  get(id: string): PreStepProducer | undefined;
  all(): PreStepProducer[];
  register(p: PreStepProducer): void;  // <-- the seam
}
export function createRegistry(initial: PreStepProducer[]): ProducerRegistry { ... }
export const defaultRegistry = createRegistry([lineBuilderProducer, fileUploadProducer]);
```

**2. Namespaced producer ids from day one.** Builtins are bare (`line-builder`); future remote producers use `@vendor/line-builder` or `vendor.line-builder`. Bake into docs now even though only builtins ship today.

**3. Schema never references components or URLs.** Only `producer: string` (id) + `config`. The resolution layer is what swaps.

## Concrete walkthrough — line-builder

Producer definition (full):

```ts
// packages/producers/src/builtin/line-builder/index.ts
import { z } from 'zod';
import type { PreStepProducer } from '../../contract';

const ConfigSchema = z.object({
	baseLength: z.number().default(1500),
	baseHeight: z.number().default(100),
	allowHeights: z.boolean().default(true),
	requireClosed: z.boolean().default(false)
});

const OutputSchema = z.object({
	lines: z.array(
		z.object({
			v1: z.object({ x: z.number(), y: z.number() }),
			v2: z.object({ x: z.number(), y: z.number() }),
			heightStart: z.number(),
			heightEnd: z.number(),
			metadata: z.record(z.unknown()).optional()
		})
	)
});

export const lineBuilderProducer: PreStepProducer<
	z.infer<typeof ConfigSchema>,
	z.infer<typeof OutputSchema>
> = {
	id: 'line-builder',
	displayName: 'Line Builder',
	outputDataType: 'json',
	acceptableInputs: ['text'], // GH side parses JSON via a script component
	configSchema: ConfigSchema,
	outputSchema: OutputSchema,
	RunnerComponent: () => import('./Runner.svelte').then((m) => m.default),
	displayMode: 'fullscreen',
	persist: 'platform', // line drawings worth persisting beyond session
	toDataTree: (output, param) =>
		TreeBuilder.replaceTreeValue([], param.nickname, JSON.stringify(output))
};
```

Schema using it:

```jsonc
{
	"id": "polyline-input",
	"type": "input",
	"widgetType": "text",
	"paramId": "...",
	"visible": false,
	"source": {
		"kind": "pre-step",
		"producer": "line-builder",
		"config": { "baseLength": 1500, "requireClosed": true }
	}
}
```

Runtime: route loads schema → `partitionInputs` → finds 1 pre-step input → renders `LineBuilder.Runner` (fullscreen) → user draws → output collected → `toDataTree` wraps as JSON string → merged into values map at `input.id` → solver receives complete inputs map and runs.

## What this fixes vs. the parapet pattern

| Concern                          | Parapet today                                          | Selva with this design                          |
| -------------------------------- | ------------------------------------------------------ | ----------------------------------------------- |
| Producer binding                 | Top-level `inputType: 'polyline-draw'` per route       | Per-input `source.producer` in schema           |
| Input matching                   | Nickname string match (`findId('line-data')`)          | Direct match by `input.id`                      |
| Multiple pre-step inputs per def | Awkward (one `inputType` per route)                    | Free (each input declares its own producer)     |
| Adding a producer                | New `inputType` branch + new route                     | New module in `packages/producers/src/builtin/` |
| Restricting attachable inputs    | Implicit (always means the line input)                 | Explicit `acceptableInputs`                     |
| Routing                          | Separate routes (`/polyline-draw` → `/compute/[slug]`) | Same route, internal phase state                |

What we should _keep_ from parapet:

1. **Persistence across reloads.** Parapet's `curveDataCache` (localStorage + Firebase fallback) means a user drawing 40 lines doesn't lose them on refresh. Bake into the producer contract via `persist?: 'session' | 'platform'`.
2. **Presets.** Parapet's `DataTreePreset` lets users save/load prior compute settings. If pre-step outputs are JSON-serializable (they are by contract), they fit into the same preset mechanism.

## Open questions / next decisions

- [ ] **Config versioning.** When `lineBuilder` v1 ships, then v2 changes its config shape, existing schemas break the config UI. Two options:
  - Bake `configVersion` into stored config + provide migration in producer.
  - Treat each major change as new id (`line-builder-v2`) and keep v1 around.
  - Recommendation: latter unless real reason not to.
- [ ] **Validation/required-check semantics.** A pre-step input that has no value yet shouldn't say "fill in this field" — it should route the user to the pre-step UI. Need a unified "input not ready" predicate that knows which kind.
- [ ] **Plugin-UI schema designer treatment.** Pre-step inputs likely want a different visual in the canvas (greyed, badged with producer name) so the designer remembers what fills them. Don't paint into a corner where the builder assumes every input renders a control.
- [ ] **Persistence storage contract.** When `persist: 'platform'`, what does the producer call? Probably a generic `IPlatformDataStore` keyed by `(sessionId, inputId)`. Needs to be defined.
- [ ] **Concrete `contract.ts` and `registry.ts` files.** Mock these up to pressure-test against line-builder + a hypothetical STEP-file uploader before committing.
- [ ] **Pre-step phase UI shell.** Inline producers render as a panel; fullscreen producers temporarily replace the route. Owned by one shared `<PreStepPhase>` component reading `displayMode`.
- [ ] **Multiple pre-step inputs ordering.** If a schema has 3 pre-step inputs, what order does the user fill them? Schema order? An explicit `preStepOrder` field? Wizard-style "Next" between each?
- [ ] **Skip behavior.** If a pre-step input has a saved value (from `persist: 'platform'`), should the runner be auto-skipped or shown for review? Probably show with "looks good, continue" affordance.

## TL;DR

- Add optional `source: { kind, producer, config }` to input schema items. Open string for `producer`.
- New workspace package `@selvajs/producers` exporting `defaultRegistry` + builtins.
- Each producer is a self-contained module: metadata, schemas, lazy `RunnerComponent`, `toDataTree`.
- Plugin-UI: visibility toggle on all items, producer dropdown on inputs (filtered by `acceptableInputs`).
- Compute-app: generic `gatherPreStepValues` replaces all per-producer glue.
- Platform decides which producers are enabled per deployment.
- Build-time only for now; design seams (factory registry, namespaced ids, no components in schema) so runtime loading is an additive upgrade.
