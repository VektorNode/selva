# ADR 0001: Pre-Step Producers

> **Status: shipped as `InputSource`, not as a producer registry.** An input can declare that
> something other than the person fills it. Selva owns the declaration and the value hand-off; the
> host decides which producer app sits behind a `key`. No server lookup is wired. The proposed
> `@selvajs/producers` package (registry, producer contract, config UI) was never built.

## Context

Some inputs are produced by a tool, not typed: a line drawer, a file uploader, a measurement app.
Their value has to reach the solve without a form field for the person to fill in. Definitions
without such inputs must work unchanged.

## Decision

### Schema

Every input layout item may carry `source`, an `InputSource` in
[ui-schema.json](../../packages/schemas/ui-schema.json):

- `kind`: `user` (default; the person fills it), `client` (a browser app fills it before the solve)
  or `server` (meant for a server-side lookup, which nothing performs: it solves with its schema
  default, and a solve that posts a value for it is refused; never shown in the form).
- `key`: an opaque address the host interprets per `kind`. For `client` it names the producer app,
  for `server` what to fetch. It is an open string, so adding a producer needs no schema change.
  Keys need not be unique.
- `client.presentation`: `hidden` (default; the value is prefilled and the input does not appear) or
  `slot` (Selva keeps the input's grid cell and the host renders its own element there).

`source` is an object, not a boolean, so new kinds and per-kind fields can be added without a
breaking schema change.

### Two-layer rule

A producer is two things, kept strictly separate:

1. **Domain-pure component.** Knows its own data model (lines, files, points) and fires
   `onDone(value)`. Could move into another product unchanged and has no idea Selva exists.
2. **Producer route.** Integration glue. Reads the target input from the URL, hosts the component,
   writes the result with `writeExternalValue` on `onDone` and navigates back. Knows nothing about
   the component's domain.

If a component imports anything Selva-specific, push that up into the route.

### Value hand-off

For `client` inputs the producer route writes the value to `sessionStorage`; the solve session reads
it back when it initialises.

- Storage key: `external:<scopeKey>:<paramId>`. The `paramId` is the Grasshopper instance GUID, so it
  is the same in the schema, the URL and the storage key.
- `scopeKey` is whatever identifies one solver context: the `sessionId` in plugin-ui, the
  `externalScopeKey` (falling back to `definitionKey`, then the schema id) in the compute app.
- The primitives (`readExternalValue`, `writeExternalValue`, `clearExternalValue`,
  `getExternalInputs`) live in [`@selvajs/solve/client`](../../packages/solve/src/client/external-storage.ts),
  beside the session that hydrates from them. `@selvajs/ui` re-exports them, and
  `@selvajs/ui/external` is a shim over the same functions.
- A `client` input with no stored value is left out of the initial values instead of getting its
  default, so a missing value can be told apart from a default one.
- Entries are never cleared. Nothing calls `clearExternalValue`, so a stale entry survives schema
  changes for the life of the tab.

### Reaching Grasshopper

`SolveEngine.solve` builds the data tree through `TreeBuilder.fromValues`, which coerces numbers and
booleans and passes any other value through. For complex data (geometry, curves), use a `text`
input and have the producer write the payload: an object is sent as its JSON string and a script
component in the definition parses it.

### Builder

`BuilderGroupItem.svelte` offers the source kind per input. Choosing `client` or `server` sets
`visible: false`; the author can switch it back on.

## Not built

- A producer registry, producer contract or per-producer config in the schema. The host maps `key`
  to an app.
- A panel or warning for a `client` input with no value.
- Persistence beyond the tab: `sessionStorage` does not cross tabs or devices.
