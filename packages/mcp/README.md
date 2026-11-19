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
	name: 'acme',
	version: '1.0.0',
	baseUrl: process.env.ACME_URL!,
	apiKey: process.env.ACME_API_KEY!, // stdio only; `handle` uses each request's own
	openapi,
	tools: [
		fromOperation('getOrdersById', { name: 'acme_get_order', description, shape }),
		tool({
			name: 'acme_create_job',
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
  and `api.call` refuses anything not listed. Internal operations are refused at startup.
  `inputFrom` can't derive a multipart operation's input; `api.call` sends one a `FormData` body.
- **A binary body comes back as its size** (`BinaryBody`), unless the call passes
  `bytes: true`, which adds `data` (`BinaryData`).
- **Errors are tool results**, with the next step for the model. A 403 names the missing scope.
- **429**: a `Retry-After` up to 10 s is waited out (twice at most, same `Idempotency-Key`);
  longer goes back to the model with the wait.
- **Idempotent operations get a generated `Idempotency-Key`**, reused across retries, so a
  timed-out solve replays instead of running twice. The host's idempotency store is in memory:
  a restart mid-solve can still run it twice.
- **Over HTTP, each request brings its own key.** `handle` sends the request's
  `Authorization: Bearer` key to `/api/v1` and never the configured `apiKey`; a request without
  one gets 401. `apiKey` is only for `listen` and `verify`.
- **A call waits 30 s by default**, `solveTimeoutMs` (5 min) for a `solve`-scoped operation or
  one marked `longRunning` in the registry (`x-long-running`), which runs Compute without the
  `solve` scope.
- **The key is redacted** from every tool output.
- **`onToolCall` sees every tool call** once it settles: outcome, the `/api/v1` calls with their
  status and duration, and argument names with their sizes, never values. `onCall` sees each
  API call alone. A tool that rewrites an `ApiCallError`'s text throws
  `new Error(text, { cause: err })` so the outcome keeps its code (a timeout stays `timeout`).
- **`listen` checks the live spec** at `/api/v1/openapi.json`: every declared call must exist
  with the same scope, or the server refuses to start.
- **A browser `Origin` must be the host's own** or listed in `allowedOrigins`; anything else gets 403. Native clients send none.
- **`grantedActions` hides what the key can't use.** Given it, `tools/list` drops tools whose
  calls need an action the key lacks, and calling one answers 403 with an `insufficient_scope`
  challenge. `challenge` adds `resource_metadata` and `scope` to the 401 and 403, for OAuth
  clients.

Both protocol eras are served: the current stateless revision per request, and older clients
through the SDK's stateless fallback.

## Output

A tool returns a string, or `{ text, structured?, images? }`. A tool with `output` (Zod or JSON
Schema) lists it as `outputSchema`, and clients may reject a `structured` that doesn't match it.
A tool without `output` sends no `structuredContent`: clients would show it in place of the
text. `images` (`{ data, mimeType }`,
base64) follow the text as MCP image content, for a model that can see. Clients render PNG, JPEG,
GIF and WebP, not SVG.

## Views (MCP Apps)

A client that supports MCP Apps (Claude, ChatGPT) shows an HTML view inside the chat beside a
tool's result. `appResource` serves the view; a tool names it in `ui`; `meta` carries the data
the view draws, as the result's `_meta`, which clients keep out of the model's context. A
client without views shows the text, so the text must stand alone.

```ts
const planView = appResource({
	uri: 'ui://acme/plan.html',
	name: 'Plan',
	html: () => readFile(new URL('./plan.html', import.meta.url), 'utf8'),
	csp: { connectDomains: ['https://acme.example'] } // default: no fetch, no outside script
});

tool({
	name: 'acme_check_plan',
	ui: { resourceUri: planView.uri },
	run: async (api, args) => ({ text: 'Plan builds, 4 runs.', meta: { plan } }),
	...
});
```

`visibility: ['app']` hides a tool from the model and leaves it callable by its view: for data
only the view needs, such as geometry. A tool naming a view no `appResource` serves is refused
at startup.

**3D.** `solveView()` serves a ready-made view (`SOLVE_VIEW_URI`) that draws a solve. The tool
hands it the geometry under `SOLVE_VIEW_KEY`, inline, or as an `['app']` tool to call for it,
so megabytes of meshes stay out of the first result:

```ts
resources: [solveView()],
tools: [
	tool({ name: 'acme_solve', ui: { resourceUri: SOLVE_VIEW_URI },
		run: async () => ({ text, meta: { [SOLVE_VIEW_KEY]: { title, load: { tool: 'acme_geometry', arguments } } } }) }),
	tool({ name: 'acme_geometry', ui: { resourceUri: SOLVE_VIEW_URI, visibility: ['app'] },
		run: async () => ({ text: 'Geometry.', meta: { [SOLVE_VIEW_KEY]: { response } } }) })
]
```

**Your own view** imports `@selvajs/mcp/view` (peers: `@modelcontextprotocol/ext-apps`,
`@selvajs/visualization`, `three`) and is built into one HTML file, e.g. with
`vite-plugin-singlefile`: `connectView` connects it to the host and follows the host's theme
(add listeners in its callback, or the first result arrives before them), `mountSolveViewer`
draws a Rhino.Compute response. A view's CSP allows no `fetch` and no outside script unless the
`appResource` lists them, so the renderer loads no HDR there.

A view's data can carry a `form` (`SolveViewForm`): inputs the view draws beside the
geometry, and the tool it calls with them to solve again. That tool must answer with
`SolveViewData` too; usually it is the tool that made the first result. After such a solve the
view tells the model what the user tried through `updateModelContext`, since the model never saw
that call. `renderViewForm` from `@selvajs/mcp/view` draws the same form in a view of your own.

## Rendering on the server

`captureSolve(response, { view, width, height, grid, look, background, hdr })` from
`@selvajs/mcp/capture` draws a Rhino.Compute response in the same viewer as the 3D view, in a
headless Chromium, and resolves to a base64 PNG for a tool's `images`. `hdr` is the environment
map as a URL; the page loads nothing from an origin, so a `data:` URL is the reliable form. Captures run one at a time on one browser, which closes after
two idle minutes. It needs the optional peer `playwright-core` and a browser
(`npx playwright install --with-deps chromium`, or `executablePath`); without them it throws
`CaptureUnavailableError`, whose message says so. A bundled host passes the page as `html`,
since bundling moves `dist/views/capture.html` away from the module that reads it: with Vite,
`() => import('@selvajs/mcp/views/capture.html?raw').then((m) => m.default)`.

## Evals

`evals/run.ts` runs the tasks in `evals/tasks.json` against a Selva MCP endpoint with Claude as
the agent, and records per task whether it passed, its tool calls, tokens, invalid-argument
errors and wall time. It needs a running instance seeded with `--examples` (see
`scripts/develop/LOCAL.md`), Rhino.Compute behind it, and Anthropic API credit, so it is not in CI.

```bash
SELVA_MCP_URL=http://localhost:5273/mcp SELVA_API_KEY=selva_… pnpm --filter @selvajs/mcp eval
pnpm --filter @selvajs/mcp eval --task kitchen-file --effort high
pnpm --filter @selvajs/mcp eval --held-out   # only when checking, never while tuning
```

A task's `expect` checks which tools it called, what the answer contains, a number, and a rubric
that a second Claude call grades. A `number` with `expected: null` is reported, not graded:
fill it in once the value is checked in the app. Results go to `evals/results/`, which git ignores.

## Typed calls

Pass the `operations` type `openapi-typescript` generates from the spec, and `api.call` checks
params, query and body: `const { tool, fromOperation } = toolkit<operations>()`.
