---
'@selvajs/selva': patch
---

Add full per-phase compute timing to pinpoint where solve latency goes. The per-solve `[Compute/browser]` log now breaks the round-trip into: network (request-send + latency), server (via a new `Server-Timing` response header — load / tree / solve / serialize sub-phases), download (payload transmission with size and effective MB/s), JSON decode, rhino3dm init, mesh extraction, and output mapping. This lets a "16s solve with cached compute" be attributed precisely — e.g. large-payload download vs. server serialization vs. mesh decode — instead of being a single opaque number. The server route also sets `Server-Timing` on every `/api/compute` response so the frontend can separate server work from network transfer without enabling server-side debug logging.
