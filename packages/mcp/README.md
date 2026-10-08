# @selvajs/mcp

MCP server machinery for apps built on Selva. The host writes the tools; this package serves
them over stdio or streamable HTTP, calls the host's `/api/v1` with an API key, and derives
each tool's annotations from the host's OpenAPI document.

The server is a client of `/api/v1`: no store access, no second auth path. The spec must come
from `buildOpenApiDocument` in `@selvajs/server/api`, which emits the `x-scope` every operation
needs.

```ts
import { createMcpServer, fromOperation, inputFrom, tool } from '@selvajs/mcp';
import openapi from './openapi.json'; // the host's own spec, bundled at build time

const server = createMcpServer({
	name: 'parafa',
	version: '1.0.0',
	baseUrl: process.env.PARAFA_URL!,
	apiKey: process.env.PARAFA_API_KEY!,
	openapi,
	tools: [
		fromOperation('getOrdersById', { name: 'parafa_get_order', description, shape }),
		tool({
			name: 'parafa_create_job',
			description,
			input: inputFrom('postJobs', { extend: { angleMode: { enum: ['turn', 'corner'] } } }),
			calls: ['postJobs'],
			run: (api, args) => api.call('postJobs', { body: toTurnAngles(args) })
		})
	]
});

await server.listen({ transport: 'stdio' }); // checks the live spec first
// or, in a route: return server.handle(request);
```

## What it enforces

- **`calls` is the contract.** A tool lists every operationId it may hit. Annotations come from
  those operations (all `read` → read-only, any DELETE → destructive, any `solve` → open-world),
  and `api.call` refuses anything not listed. Internal and multipart operations are refused at
  startup.
- **Errors are tool results**, with the next step for the model. A 403 names the missing scope.
- **429**: a `Retry-After` up to 10 s is waited out (twice at most, same `Idempotency-Key`);
  longer goes back to the model with the wait.
- **Idempotent operations get a generated `Idempotency-Key`**, reused across retries, so a
  timed-out solve replays instead of running twice. The host's idempotency store is in memory:
  a restart mid-solve can still run it twice.
- **The key is redacted** from every tool output.
- **`listen` checks the live spec** at `/api/v1/openapi.json`: every declared call must exist
  with the same scope, or the server refuses to start.

## Typed calls

Pass the `operations` type `openapi-typescript` generates from the spec, and `api.call` checks
params, query and body: `const { tool, fromOperation } = toolkit<operations>()`.
