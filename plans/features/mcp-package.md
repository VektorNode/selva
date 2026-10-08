# MCP package (`@selvajs/mcp`)

**Status: built (2026-10-08), steps 1-4 below.** Not yet live-tested against a real client. Parafa adopts the shared builder after the next `@selvajs/server` publish.

Agents should drive a Selva host the way scripts do: through `/api/v1` with a key. Each host has
its own domain (Selva: definitions and solves; a host app: whatever it builds on top), so the
engine ships the machinery and each host writes its tools. The engine never learns a host's
entities.

Research behind the Selva tools: [mcp-from-api-tokens.md](../research/mcp-from-api-tokens.md).
First outside consumer: parafa (`docs/plans/mcp-server.md` there).

## Split

| Engine (`@selvajs/mcp`)                                                      | Host                                                        |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Transports: stdio (local), streamable HTTP mounted at `/mcp` (remote)        | Which operations become tools, and which never do (deletes) |
| Auth: API key, from env (stdio) or the request's bearer (HTTP)               | Tool names, descriptions, examples, input conventions       |
| Typed `api.call` over `/api/v1`, from the host's bundled OpenAPI document    | Tools spanning several calls, input transforms              |
| Error mapping, 429 handling, auto `Idempotency-Key` on idempotent operations | Resolving human identifiers (order number, ERP ref) to ids  |
| Tool annotations from the declared calls' `x-scope` and method               | Resources and prompts with domain content                   |
| Output shaping helpers (truncate, page, text + structured)                   | Evals: the tasks its users actually ask for                 |

The server is a **client of `/api/v1`**: no store access, no second auth path. Remote `/mcp` runs
inside the host app and still calls `/api/v1` over HTTP. It is per instance: one shared MCP
server in front of many instances would hold every operator's keys.

## Prerequisite: one contract shape for every host

Parafa's registry already carries `scope`, emits `x-scope` and serves `GET /api/v1/openapi.json`;
Selva's does none of these. Before the package:

- Move `Endpoint` and `buildOpenApiDocument(endpoints, info)` into `@selvajs/server/api`. Response
  kinds: `collection | object | empty | binary` (parafa's `zip` becomes `binary`), since
  `collection` is the paging contract bounded outputs rely on.
- `Endpoint.scope: ApiScopeAction`, emitted as `x-scope`. The conformance test checks it against
  the scope the route mounts with, as it does `idempotent`.
- Selva serves `/api/v1/openapi.json` next to the YAML docs route.

The engine reads only what that builder emits: `operationId`, `x-scope`, the idempotency
parameter, `x-internal`.

## API sketch

```ts
const server = createMcpServer({
	baseUrl,
	apiKey,
	openapi, // the host's own generated spec, imported at build time
	tools: [
		tool({
			name: 'parafa_create_job',
			description,
			input: inputFrom('postJobs', { extend: { angleMode } }),
			calls: ['postJobs'],
			run: async (api, args) => api.call('postJobs', { body: toTurnAngles(args) })
		}),
		fromOperation('getOrdersById', { name: 'parafa_get_order', description, shape })
	],
	resources,
	prompts
});
server.listen({ transport: 'stdio' });
```

One primitive, `tool`. `inputFrom` derives the input schema from an operation's parameters and
body. `fromOperation` is sugar over `tool` for a 1:1 call. `api.call` is typed from the spec
(`openapi-typescript`) and refuses an operationId missing from the tool's `calls`, so annotations
can't lie.

At startup the server fetches the live `/api/v1/openapi.json` and checks every declared call
exists with the same `x-scope`. A mismatch fails fast: the host is older than the server.

## Rules the package enforces

- **Errors are tool results**, with the next step in the text ("unknown material; call
  `get_catalog`"), never protocol errors.
- **429**: `Retry-After` ≤ 10s retries silently, at most twice, same `Idempotency-Key`. Longer
  returns a tool error naming the wait and telling the model not to retry; a compute budget can
  be hours.
- **Annotations on every tool**, from its declared calls, most permissive wins: all `read` →
  `readOnlyHint`; any DELETE → `destructiveHint`; all idempotent → `idempotentHint`; any `solve` →
  open-world, so clients confirm first.
- **The key never appears in tool arguments or output.**
- **Outputs are bounded**: list tools page with a small default; a `detail: 'full'` switch for the
  rest. Text for the model plus `structuredContent`.
- **Solves are synchronous** on both hosts, and their progress channel is internal. `api.call`
  takes a long timeout for `solve` operations, sends MCP progress only as a heartbeat, and retries
  a dropped connection with the same `Idempotency-Key`. The idempotency store is in-memory, so a
  host restart mid-solve can run it twice.

## Selva's tools

`selva_list_definitions`, `selva_describe_definition` (inputs from the published UI schema: types,
ranges, value-list options), `selva_solve`, maybe `selva_list_projects`. No deletes, share links,
tokens or admin.

`selva_solve` returns scalar outputs by name, a one-line summary per geometry output ("3 meshes,
14k vertices"), solve errors and warnings verbatim, and a link to the definition for a human.
`detail: 'full'` returns the raw response.

## Order

1. Prerequisite above.
2. Package core: stdio + key auth, `tool` / `inputFrom` / `fromOperation`, error mapping,
   annotations, startup check.
3. Selva's own server, as the first consumer. It runs only at `/mcp` inside the app, so it
   needs no stdio binary or bundled spec; its calls stay untyped until a second Selva consumer
   justifies `openapi-typescript` codegen.
4. Streamable HTTP at `/mcp`, API key as bearer.

## Open

- OAuth 2.1, for clients that can't send a header (claude.ai connectors). Its own plan. Leaning:
  an OAuth grant mints a scoped API token, so the principal and scopes match a key by
  construction.
- A public async solve (`202` + `GET /solves/{id}`) would make progress real.
- A declared output schema per definition, replacing the scalar/summary heuristic in
  `selva_solve`.
- Whether multi-call tools stay in the MCP process or become API operations once a host sees
  agents need them.
