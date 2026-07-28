# Display pipeline performance — remaining open items

> **Status: P2/P4/P5(most)/P6 + P1-client SHIPPED (2026-07-22).** Full audit + implementation notes
> archived at [archive/display-pipeline-performance-audit.md](./archive/display-pipeline-performance-audit.md).
> This file is the open residue only. The shipped client-side parse files (`batch-parser`,
> assembly worker, `mesh-assembly`, geometry cache, webdisplay) **move to `@selvajs/visualization`
> in [the visualization-package plan](./visualization-package.md)** — the open items below touch C# and cloud transport,
> not those TS files, so they don't collide.

## Open (each its own effort)

1. **P1 — C# half.** Skip re-mesh/weld/quantize/deflate for unchanged inputs in `ComputeBatch`
   (hash mesh + material per item → reuse the previous blob). Needs a design for input identity +
   memory policy inside Rhino. Plugin-side (.NET).
2. **P3 — cloud transport binary side-channel.** Move the geometry blob out of the values JSON
   (multipart / side-channel) to kill the base64 inflation. Protocol change across plugin + server
   - client. Do when cloud traffic volume justifies it.
3. **P5 (deferred item) — intra-branch parallelism.** So a single fat branch doesn't quantize +
   deflate serially. Plugin-side (.NET).

## Verification still owed

- Real-browser check of worker paths + on-demand repaint feel (measure tool, gizmo, label overlays)
  - AO/edge passes — shared with [the edge-overlay residue](./edge-overlay-open.md) GPU verify.
- `dotnet test` on a net8 runtime (this machine had only .NET 10; BlobCompressor wire-format was
  checked by inspection). Run before release.
