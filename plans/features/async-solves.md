# Solves that outlive the request

A Cloud solve is one HTTP request held open until Compute answers. Every hop on that path has its
own timeout, and the shortest one wins:

| Hop                     | Timeout                                 | Who sets it             |
| ----------------------- | --------------------------------------- | ----------------------- |
| Browser                 | `solveDeadlineMs`, from Selva           | Selva, derived          |
| Customer proxy          | Entra App Proxy: 85 s; nginx, ALB: 60 s | the customer's IT       |
| Caddy in front of Selva | none by default                         | the operator            |
| Selva → Compute         | Compute's timeout + 5 s slack           | Selva, derived          |
| Compute                 | `RHINO_COMPUTE_TIMEOUT`, default 100 s  | the operator, in `.env` |

To run one heavy definition, an operator has to raise Compute's timeout and also every proxy in
front of Selva, some of which they don't control. Get one wrong and the solve fails with a bare 504. Herding's funnel generator needs about 190 s:

- On the test server it ran to 187 s and Selva gave up at 185 s, throwing away a finished result.
- Behind selva.herding.de's Entra proxy it can never finish, whatever Compute allows.

The goal is to make Compute's timeout the only setting, and to have it mean one thing: how much
compute a single solve may spend.

## Design

**The solve detaches from the request.** `POST /api/v1/definitions/{guid}/solve` and
`POST /api/v1/compute` take `Prefer: respond-async`. With it, they validate, start the solve, and
answer `202 { solveId }` at once. Without it, nothing changes, so the CLI, MCP and scripts keep
working.

**The solve takes its own signal.** `runSolve` aborted on `request.signal`, which fires as soon as
the `202` goes out. It now takes a `signal` (default `request.signal`), and a detached solve passes
one the store owns. Everything else it reads from the request (headers, URL) stays valid after the
response, so the rest of the core is unchanged. The [trigger runs](./triggers.md#execution) still
need a fully transport-free core; this doesn't build that.

**Results wait in memory for a short while.** A finished solve stays in an in-process store, keyed
by `solveId` and owner, until it is read or about 10 minutes pass. The store is capped by bytes,
because a result can be megabytes of mesh.

- `GET /api/v1/solves/{solveId}?wait=25` long-polls. It answers as soon as the solve ends, or after
  25 s with `202` and the status. 25 s stays under every proxy timeout we know of.
- The terminal answer is the body the sync route returns today, with the same gzip and binary
  handling. The browser's decode path doesn't change.
- The live-event stream keeps reporting progress, but nothing waits on it: the poll already answers
  the moment the solve ends, and a share-link viewer has no stream.

**Nobody is watching, so the solve stops.** A solve with no poll waiting and none for 60 s is
cancelled, so a closed tab doesn't burn compute. An aborted solve in the browser sends
`DELETE /api/v1/solves/{solveId}`. Coalescing keeps its rule, "abort when the last caller leaves";
leaving now means stopping to poll.

**The solve id is the capability.** It is a random UUID. One a signed-in user started is readable by
that user only. One started under a share link has no user behind it, so the id alone reads it.
Another caller reads `404`. The poll route is self-gating for that reason.

## What goes away

- **Proxy timeouts stop mattering.** No request lives longer than one 25 s poll.
- **The tight slack.** Selva's deadline was Compute's timeout plus 5 s, so that Compute's error
  arrived before the browser's request was cut. With no long request left, it is now 60 s: Compute
  ends a solve, not Selva. Compute's timeout isn't exact; a 180 s server returned a finished result at
  187 s. The browser keeps the same deadline as a backstop. `MAX_SOLVE_DEADLINE_MS` stays as a hard
  cap.

## Constraints

- **One Selva process per deployment.** The result store lives in memory, like the solve-event bus.
  This adds no new constraint, but running several instances would need sticky routing or a shared
  store for both.
- **A restart loses solves in flight.** The browser sees the solve vanish (`404`) and solves again.
  That's acceptable for interactive solves. Triggers keep their durable runs, because a webhook
  sender can't just retry.

## Rejected

- **Document the timeouts and have operators align them.** That's the problem itself. Customer
  proxies like Entra aren't the operator's to change.
- **Keep-alive filler bytes alone.** `POST /api/v1/compute` already supports `Prefer:
selva-keepalive`: a `200` at once, a space every 15 s, then the real status and body. It beats an
  idle read timeout, but one request still lives as long as the solve, so a proxy that caps the whole
  response or buffers it still cuts it. It stays for other clients; the web app now asks for
  `respond-async`.
- **Deliver the result over SSE.** Results are megabytes of binary mesh, and SSE is text. A
  share-link viewer has no stream either.
- **A durable job table for every solve.** It costs a write per solve to save a result the browser
  can recompute. Triggers need durability; interactive solves don't.

## Related settings, separate work

The same Herding incident turned up two more ways to get a setting wrong. Neither needs this plan:

- **The fork's `docker-launch.sh` only reads an allowlist from `.env`.** `RHINO_COMPUTE_TIMEOUT`
  silently did nothing until it was added to the allowlist. Passing every `RHINO_COMPUTE_*`
  variable through removes the trap.
- **`RHINO_COMPUTE_EVENT_SINK_HOSTS` has to name Selva's host,** or live progress is dropped
  without an error. Selva already signs each callback with a per-solve token. Compute could accept
  callbacks to the host of a request authenticated with its API key, leaving the allowlist for
  extra hosts only. That needs a security review in the compute fork first.

The event stream this builds on was designed in [live-solve-channel](../archive/live-solve-channel.md).
