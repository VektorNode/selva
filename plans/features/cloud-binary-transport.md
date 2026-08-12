# Cloud transport — move the geometry blob out of the values JSON

> **Status: NOT STARTED — deliberately deferred, not forgotten.** This is a "when the traffic
> arrives" item: the cost is a coordinated three-sided protocol change, and the benefit scales with
> cloud traffic volume, which does not yet justify it. Revisit when cloud payload size shows up in
> real usage.
>
> **Rehomed 2026-07-31** from
> [display-pipeline-open](../archive/display-pipeline-open.md), where it was filed as "P3". It was
> mis-filed there: every other item on that plan was display-pipeline residue that has now shipped
> and been verified, while this is a **cloud-transport feature** that has never been started. Leaving
> it there meant a finished plan could never retire. Original analysis:
> [archive/display-pipeline-performance-audit.md §P3](../archive/display-pipeline-performance-audit.md).

## The problem

**Local mode already does this correctly.** The WebSocket path ships raw binary frames and the
envelope carries only a count — the client calls `parseMeshBatchBlob` on the frame directly.

**The cloud path does not.** `DisplayBatch.CompressedData` is a `byte[]`
([DisplayBatch.cs:40](../../Plugin/Selva.GH/Features/Display/Services/DisplayBatch.cs)), and
`WebDisplayGoo.ToComputeJson`
([WebDisplayGoo.cs:301](../../Plugin/Selva.GH/Features/Display/Goos/WebDisplayGoo.cs)) hands the whole
`DisplayBatch` to `JsonConvert.SerializeObject`. Newtonsoft renders a `byte[]` as **base64 inside the
values JSON**. The code says so itself, and has since it was written:

> "Travels as base64 inside the values JSON for now; will move to an out-of-band binary transport in
> a later phase." — [DisplayBatch.cs:31-32](../../Plugin/Selva.GH/Features/Display/Services/DisplayBatch.cs)

Costs, in order of size:

1. **~33% wire inflation** — base64's fixed overhead, paid on every cloud solve.
2. **A full transient string of the payload on both ends** — the encoder builds it, the decoder holds
   it. On a multi-megabyte blob that is real allocation pressure on the server and in the browser.
3. **Client-side `JSON.parse` of a huge string, then a base64 decode** before parsing can even start.
   The client already knows this hurts: `parse/webdisplay/types.ts:51` documents `compressedData` as
   "the binary 'SLVA' blob, base64-encoded for transit inside the values JSON".

The blob format itself is already transport-agnostic by design — `MeshBatchSerialization` embeds the
envelope **inside** the binary blob's metadata header specifically "so the format stays
transport-agnostic and the client decoder never branches on transport". So the format is ready for
this change; only the transport is not.

## Why it is deferred rather than done

Not because it is hard to see the win — because the change spans three sides that must move together:

- **Plugin (C#)** — emit the blob out-of-band instead of inlining it into the values JSON.
- **Server** — carry a binary part alongside the values JSON (multipart, or a separate fetch keyed by
  a handle in the JSON).
- **Client (TS)** — accept the blob from the side-channel rather than from `batch.compressedData`.

And it must stay compatible with:

- **`.gh` file persistence.** `CompressedData`'s JSON field name is explicitly "preserved for `.gh`
  file backward compatibility" — saved definitions contain it. A transport change must not become a
  file-format change.
- **The local WebSocket path**, which is already binary and must not regress.
- **Older plugin/app pairs** — see [plugin-compat-gate](./plugin-compat-gate.md); this is exactly the
  kind of wire change that gate exists to negotiate.

The benefit is proportional to cloud traffic volume. Until that traffic exists, a three-sided
protocol change with a file-format compatibility constraint is not the best available use of the
effort.

## Trigger — when to pick this up

Any one of these:

- Cloud payload size or solve latency shows up in real usage or a user report.
- Cloud becomes the primary deployment mode rather than local Grasshopper.
- A separate protocol change opens the wire anyway (e.g. the compat gate lands a version
  negotiation), making this a marginal addition rather than a standalone break.

## Direction, if pursued

Side-channel the blob rather than inlining it: a binary part (multipart) or a separate fetch keyed by
a handle carried in the values JSON. The decision to make first is **which**, and it is mostly a
question of how the Rhino.Compute response path can carry a second part — verify that before
designing anything else.

Note the shape of the good version: the client should end up with the same `Uint8Array` it gets from
a WebSocket frame today, so `parseMeshBatchBlob` is reached by both paths with no branch. If the
design forces the client to branch on transport, it has gone wrong — the format was deliberately
built to avoid that.

## What this is NOT

- **Not a mesh-format change.** The SLVA/SLVZ blob is unchanged; only how it travels changes.
- **Not a `.gh` file change.** Persistence keeps the existing field.
- **Not blocking anything.** No other plan depends on it. The display-pipeline work it was filed
  under has shipped and been verified without it.
