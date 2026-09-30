---
'@selvajs/selva': minor
---

Live solve events in cloud mode. The browser subscribes to `GET /api/v1/solve-events` (SSE); the plugin inside Rhino.Compute POSTs to `/api/v1/solve-events/{solveId}` with a per-solve bearer, and the reply carries an abort flag. `POST /api/v1/solve/{solveId}/cancel` asks a running solve to stop at the next component.

Set `SELVA_EVENT_CALLBACK_ORIGIN` when Compute must reach the server on a different address than the browser does; see `.env.example`. A non-loopback host must also be listed in Compute's `RHINO_COMPUTE_EVENT_SINK_HOSTS`, or events are dropped and solves still complete. Needs the VektorNode Compute fork and a plugin with the Message and Report Progress components.
