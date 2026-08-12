# webdisplay

Parses the Grasshopper **Display** component's output into Three.js meshes and objects.

The plugin's `WebDisplay` component serializes mesh geometry into the binary "SLVA" wire format
(see `binary/header.ts`), base64-encoded inside a `DisplayBatch` JSON envelope (`types.ts`).
`webdisplay-parser.ts` is the entry point: it walks a solve response's data trees, finds
`DisplayBatch` payloads, and hands them to `batch-parser.ts` for mesh construction. Requires the
VektorNode Rhino.Compute fork (see repo root CLAUDE.md).
