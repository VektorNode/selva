# Rhino builder (beta): agents build definitions on a headless Rhino

**Tracked in: unfiled. Status: not built.**

An MCP client (Claude Desktop, Claude Code) connected to Selva's `/mcp` gets the RhinoAI tool set
running on a headless Rhino: place and wire Grasshopper components, solve the canvas, read
viewport images. One Selva tool closes the loop: save that canvas as a draft version of a
definition. The agent can then describe and solve it with the existing `selva_*` tools.

Beta scope: instance admins only, one separate "builder" Compute, external MCP clients only. No
in-app chat.

## What the runtime gives us

Spiked on the fork (`9.x.selva` merged with upstream `9.x`, Rhino 9.1.26300, Linux docker):

- Upstream compute serves `POST /mcp` when `RHINO_MCP_AUTOSTART_PORT` is set. It proxies to the
  RhinoAI plug-in's loopback listener inside a compute.geometry child.
- The RhinoAI plug-in ships in the Linux package (`Plug-ins/RhinoAI/RhinoAI.rhp`) but nothing
  loads it on Linux, so the listener never starts. Loaded by path, it starts and `/mcp` lists
  41 tools (`g1_*`, `g2_*`, `run_csharp`, `run_python`, `save_doc`, `get_viewport_image`, ...).
- Session documents don't work: `_router_spawn_listener` (one fresh headless document per MCP
  session) kills the child with a native `RhinoFailException`. Requests without a session
  header work and all share the child's startup document.

So the beta runs one shared document per builder and serializes sessions in Selva. Session
documents replace that once McNeel fixes the crash.

`run_csharp` and `run_python` execute arbitrary code in the builder process. Anyone with builder
access can run code on that machine. That's why it is admin-only and never the solve pool.

## 1. Compute fork: load RhinoAI on Linux

`src/compute.geometry/Startup.cs`, next to the RhinoCode load in the `#if LINUX` block: when
`RHINO_MCP_AUTOSTART_PORT` is set, `LoadPlugIn(RhinoSystemDirectory + "/Plug-ins/RhinoAI/RhinoAI.rhp")`
and log the result. Tag `// VEKTORNODE: SELVA FIX`, add a `FORK_CHANGES.md` section, and list it
under "For McNeel: candidates for upstream".

_Verify:_ `/mcp` `initialize` without a session header (see below), `tools/list`, `g1_start`,
`g1_place_slider`, `save_doc`, after a cold container start with no manual load.

## 2. A builder Compute

A second Compute next to the solve pool: `RHINO_MCP_AUTOSTART_PORT=10500`,
`RHINO_COMPUTE_CHILD_COUNT=1`, its own API key, idle span short (billing runs while a session
keeps the child busy). Locally a second `docker-launch.sh` container on another port; hosted, a
second container on the compute VM or its own VM. Plugins match the solve pool, or a saved
definition won't solve there.

The session-less path needs one change on the proxy side: upstream's `initialize` without
`Mcp-Session-Id` always tries to spawn a session document. Until the crash is fixed, the fork
answers `initialize` from the startup document instead (env flag, e.g.
`RHINO_COMPUTE_MCP_SHARED_DOCUMENT=true`). Same `VEKTORNODE` + `FORK_CHANGES.md` rule.

## 3. Selva: configuration and access

- Settings, in `APP_SETTINGS` (`$lib/server/config/settings.ts`), documented in `.env.example`:
  `BUILDER_COMPUTE_URL` and `BUILDER_COMPUTE_API_KEY`. Unset means the feature is off and no
  builder tool is listed. The key is a credential: never returned by any endpoint, never logged.
- Who: the token's owner must be an instance admin. Scopes don't express that today. Decide
  between checking the owner's role in the handler, with `write` scope required, or a new
  `build` scope action in `ApiScopeActionSchema`. A new scope is a public schema change in
  `@selvajs/platform`.
- Audit: one event per builder session start/end and per save, identifiers only (`actorId`,
  definition guid). Never the tool arguments: they carry scripts and geometry.

## 4. Selva: `/api/v1/builder/*`

Selva's MCP tools call `/api/v1` with the caller's key, so the builder is an API first. Route
handlers parse, guard, delegate. The proxy logic lives in `$lib/server/builder/`.

- `POST /api/v1/builder/session`: take the builder. One holder at a time: a lease with an idle
  timeout, held in process. A second caller gets 409 with who holds it and until when. Clears
  the canvas (`g1_clear_canvas`) so a session never sees the previous one's document.
- `POST /api/v1/builder/tools/{name}`: forward one tool call to the builder's `/mcp` with the
  builder key, under the caller's lease. Allowlist the tool names. `manage_plugin_commands`,
  `open_doc` (server paths) and `close_doc` stay off in the beta.
- `POST /api/v1/builder/save`: `save_doc` to a temp path in the builder, read the bytes back,
  and create a draft version. That's either a new definition in a project the caller can write
  to, or a new version of an existing one. Same service the upload endpoints use, so the schema
  sync and version rules are the upload rules. Returns guid and version.
- `DELETE /api/v1/builder/session`: release.

Getting the `.gh` bytes back from `save_doc` needs a way to read a file out of the builder. Read
it through `run_csharp` (base64 of the file), or a fork endpoint. Decide during step 1.

## 5. Selva: MCP tools

In `$lib/server/mcp/tools.ts`, listed only when the builder is configured and the caller passes
the access check:

- `selva_builder_start` / `selva_builder_stop`
- `selva_builder_*`: one wrapper per allowlisted RhinoAI tool, with the RhinoAI schema passed
  through. Or a single `selva_builder_call { tool, args }`. Pick by eval: per-tool wrappers give
  the client real schemas.
- `selva_builder_save_definition { project | definition, displayName?, changeNote? }`

`INSTRUCTIONS` gains a paragraph on the loop: start, build, `g1_solve_graph` to check, save,
then `selva_describe_definition` / `selva_solve` on the saved draft. Saving creates a draft and
never makes it live. Making it live stays `selva_publish_definition`, confirmed by the user.

## Out of scope for the beta

- In-app chat panel.
- Non-admin access and per-org enablement.
- Per-session documents (blocked on the RhinoAI crash above).
- Solving the builder's canvas through the solve pool. The builder solves its own canvas; a
  saved draft solves on the normal pool.
