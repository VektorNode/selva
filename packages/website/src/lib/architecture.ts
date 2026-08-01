// Data model for the /architecture page — the solve cycle as it actually runs
// in code. Every entry carries the file(s) it was read from; when the code
// changes, update the entry AND its file reference.

// ============================================================================
// Types
// ============================================================================

export type Mode = 'cloud' | 'local';

/** Which process a step runs in — drives the spine dot color + band label. */
export type Layer = 'browser' | 'selva-server' | 'compute-client' | 'rhino' | 'grasshopper';

export interface LayerInfo {
	id: Layer;
	label: string;
	sub: string;
	/** Tailwind classes for the spine node dot. */
	dot: string;
	/** Tailwind classes for the layer chip. */
	chip: string;
}

export interface FlowStep {
	id: string;
	layer: Layer;
	title: string;
	/** One-line plain-language summary, always visible. */
	oneliner: string;
	/** Expanded plain-language explanation. */
	detail: string;
	/** Repo-relative file reference(s). */
	files: string[];
	/**
	 * Amber badges for a limiter that decides IF/WHEN work runs but stores no
	 * result — debounce, throttle, rate limit, queue.
	 */
	gates?: string[];
	/**
	 * Violet badges for a cache consulted at this step: `label` names it, `hit`
	 * says what a hit skips. Only where the code actually reads or writes one.
	 */
	caches?: { label: string; hit: string }[];
}

// ============================================================================
// Layers
// ============================================================================

export const LAYERS: Record<Layer, LayerInfo> = {
	browser: {
		id: 'browser',
		label: 'Browser',
		sub: '@selvajs/ui in the user’s tab',
		dot: 'bg-sky-500',
		chip: 'bg-sky-500/10 text-sky-600 dark:text-sky-400'
	},
	'selva-server': {
		id: 'selva-server',
		label: 'Selva server',
		sub: 'SvelteKit route + @selvajs/solve',
		dot: 'bg-emerald-500',
		chip: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
	},
	'compute-client': {
		id: 'compute-client',
		label: 'Compute client',
		sub: '@selvajs/compute — in the Selva server process',
		dot: 'bg-cyan-500',
		chip: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400'
	},
	rhino: {
		id: 'rhino',
		label: 'Rhino.Compute VM',
		sub: 'headless Rhino + Grasshopper, separate machine',
		dot: 'bg-orange-500',
		chip: 'bg-orange-500/10 text-orange-600 dark:text-orange-400'
	},
	grasshopper: {
		id: 'grasshopper',
		label: 'Grasshopper',
		sub: 'the live document in Rhino, via the Selva plugin',
		dot: 'bg-orange-500',
		chip: 'bg-orange-500/10 text-orange-600 dark:text-orange-400'
	}
};

// ============================================================================
// Cloud-mode flow
// ============================================================================

export const CLOUD_STEPS: FlowStep[] = [
	{
		id: 'b-input',
		layer: 'browser',
		title: 'An input changes',
		oneliner: 'Debounced before it becomes a solve — 150 ms for a slider drag, 400 ms for typing.',
		detail:
			'The input component holds the change instead of committing it immediately: a slider commits 150 ms after the last move, a typed field 400 ms. Dragging a slider across a range therefore produces one solve at the end, not one per frame. Leaving the field commits straight away, skipping the wait. If the schema turns instance-solving off, the value is only recorded as pending and nothing below this happens until the user presses Calculate.',
		files: [
			'packages/ui/src/lib/components/preview/inputs/NumberInput.svelte:27-28',
			'packages/solve/src/client/solve-session-core.ts:64-77'
		],
		gates: ['debounce 150 / 400 ms']
	},
	{
		id: 'b-throttle',
		layer: 'browser',
		title: 'Throttle: one solve at a time',
		oneliner:
			'One run in flight; a newer value replaces the single pending slot and the old one is dropped.',
		detail:
			'If nothing is running, the values execute immediately. If a run is in flight, the values go into a single pending slot — a newer trigger overwrites whatever was waiting, so intermediate values are dropped rather than queued. When the running solve settles, the pending values execute. Each run gets an AbortController, and starting a new run aborts the previous signal. Its deadline is the same 100 s the server allows a solve.',
		files: [
			'packages/solve/src/client/async-throttle.ts:46-94',
			'packages/ui/src/lib/components/compute/ComputeApp.svelte:116-117'
		],
		gates: ['1 in flight · latest wins']
	},
	{
		id: 'b-memo',
		layer: 'browser',
		title: 'Client memo check',
		oneliner:
			'Inside the run, before the request: an input set already solved this session is replayed from memory.',
		detail:
			'The driver keys a 16-entry LRU on a stable serialization of the input values (object keys sorted at every level, so ordering differences still collide). A hit reports the stored result straight to the session and no request is made. Because the lookup sits inside the throttled run rather than in front of it, only values that survive latest-wins are ever looked up — a scrub does not produce a hit per frame. Only successful solves are stored, and entries are copied in and out through an injected mesh clone/release policy so the viewer disposing a mesh cannot corrupt the cached copy. The memo is cleared when the definition changes.',
		files: [
			'packages/solve/src/client/drivers/request-response.ts:26-34',
			'packages/solve/src/client/solve-memo.ts:66-122'
		],
		caches: [{ label: 'Client memo · 16 entries', hit: 'no request leaves the browser' }]
	},
	{
		id: 'b-post',
		layer: 'browser',
		title: 'POST /api/compute',
		oneliner: 'Sends the input specs, the values, and an opaque definition reference.',
		detail:
			'The body carries `inputs`, `values`, and `definitionUrl` — for a library definition that is the string `local:<guid>`, a pointer the server resolves, not a downloadable link. A version id or `channel: draft` rides along when the page is running a specific version. The response handler maps 401 (or a redirect to /login) to a session-expired message, 429 to a client-side cooldown that short-circuits later solves, 503 to “compute offline”.',
		files: ['packages/selva/src/routes/library/[guid]/+page.svelte:73-145']
	},
	{
		id: 's-gates',
		layer: 'selva-server',
		title: 'Body cap, identity, rate limit',
		oneliner:
			'Size cap → share token or session → per-key rate limit, all before any data is read.',
		detail:
			'The request is rejected above the body cap (210 MB default) before it is buffered. A share-link token — read from the URL query or an Authorization header, never the body — is resolved for a library definition when no explicit version was requested; otherwise a logged-in session is required, and an explicit version pick always demands an editor. The rate limiter then runs on a per-user or per-share-link key (120 requests / 100 s by default) and answers 429 with Retry-After — deliberately ahead of the record reads so a throttled caller costs nothing. A share link also carries its own solve cap, checked before the solve so an exhausted link never reaches compute.',
		files: [
			'packages/selva/src/routes/api/compute/+server.ts:58-188',
			'packages/server/src/compute/limits.ts:280-285'
		],
		gates: ['rate limit 120 / 100 s']
	},
	{
		id: 's-load',
		layer: 'selva-server',
		title: 'Resolve the definition',
		oneliner: 'Three record reads and a permission check — the .gh bytes are NOT read here.',
		detail:
			'For `local:<guid>` the route reads the definition record, then its project (which supplies the org and any compute-server pin), runs the permission check, then reads the version row named by the channel or the explicit version id. It reads these through the provider interfaces and never names an implementation, so the same three reads happen whether the records are Postgres rows or JSON files on disk. What it does not do is fetch the .gh file: it builds a lazy reference keyed on the immutable version id, whose loader runs only if something later actually needs bytes. A pointer-known re-solve never calls it. A remote https definition takes a separate branch that fetches the file through its own guarded loader.',
		files: ['packages/selva/src/routes/api/compute/+server.ts:190-265', 'packages/platform/src/']
	},
	{
		id: 's-server',
		layer: 'selva-server',
		title: 'Pick the compute server, get a warm client',
		oneliner: 'Definition pin → org default → global default, then a per-server client is reused.',
		detail:
			'The narrowest configured compute server wins. The client cache then hands back the `GrasshopperClient` and its scheduler for that server id, keyed on id rather than URL so a rotated URL or key must explicitly evict. Concurrent first-time requests for the same server share one build instead of racing two handshakes. The cache holds 16 servers.',
		files: [
			'packages/selva/src/routes/api/compute/+server.ts:284-311',
			'packages/solve/src/server/client-cache.ts:152-203'
		],
		caches: [{ label: 'Warm client · 16 servers', hit: 'no reconnect or handshake' }]
	},
	{
		id: 's-tree',
		layer: 'selva-server',
		title: 'Build the input tree',
		oneliner: 'Values plus input specs become the Grasshopper data tree, built once.',
		detail:
			'Only inputs carrying a paramType are sent. Each is transformed to its Grasshopper representation and assembled into the data tree. It is built here rather than inside the pipeline because the coalescing key in the next step has to be derived from the transformed tree.',
		files: [
			'packages/selva/src/routes/api/compute/+server.ts:324',
			'packages/solve/src/server/solve-pipeline.ts:166-175'
		]
	},
	{
		id: 's-singleflight',
		layer: 'selva-server',
		title: 'Single-flight coalescing',
		oneliner: 'Identical solves arriving together run once and share the one result.',
		detail:
			'The key is version id (or the remote URL) + compute server id + the serialized input tree, so two requests that differ only in input ordering still collapse together. The first caller runs the pipeline; anyone arriving while it is in flight awaits the same promise. The key is released as soon as it settles — nothing is retained, so this coalesces concurrent work but never answers a later request. Ownership changes cancellation: a solo run still aborts if its caller disconnects, but once anyone has joined, one caller leaving cannot cancel the shared work.',
		files: [
			'packages/selva/src/routes/api/compute/+server.ts:330-379',
			'packages/solve/src/server/solve-cache-single-flight.ts:45-85'
		],
		gates: ['coalesce concurrent duplicates']
	},
	{
		id: 'c-cache',
		layer: 'compute-client',
		title: 'Scheduler result cache',
		oneliner: 'A hash of definition + input tree; a hit returns instantly without touching Rhino.',
		detail:
			'The scheduler hashes the definition once and combines it with the input tree to form the solve key. A hit resolves immediately and reports fromCache, which is what makes the Server-Timing `selva_cache` flag 1. Size is the only bound: a byte budget (256 MB, COMPUTE_SOLVE_CACHE_MB) evicted LRU, with no entry cap and no TTL — a solve is a pure function of a definition and its inputs, and neither can change under a retained result, so expiring one would only buy a paid re-solve of the same answer. Setting the budget to 0 turns the cache off. It lives per warm client, so each of the 16 possible clients holds its own.',
		files: [
			'packages/compute/src/grasshopper/scheduler/solve-scheduler.ts:342-363',
			'packages/compute/src/grasshopper/scheduler/solve-scheduler.ts:833-856',
			'packages/solve/src/server/client-cache.ts:223-229'
		],
		caches: [{ label: 'Solve cache · 256 MB · LRU', hit: 'Rhino is never called' }]
	},
	{
		id: 'c-queue',
		layer: 'compute-client',
		title: 'Scheduler queue',
		oneliner: 'On a miss the solve queues per compute server — 4 concurrent by default.',
		detail:
			'Cloud solves run in queue mode, so each runs to completion rather than being superseded. Concurrency defaults to 4 per compute server, and a solve gets 100 s before its deadline fires (a 504). Queue-depth and queue-wait limits both default to off, so by default nothing is ever shed — an over-capacity solve simply waits. When an operator does set them, an over-limit solve is rejected before it runs and the route answers 503 with Retry-After rather than hanging.',
		files: [
			'packages/solve/src/server/client-cache.ts:203-214',
			'packages/server/src/compute/limits.ts:304-309'
		],
		gates: ['queue · 4 concurrent']
	},
	{
		id: 'c-pointer',
		layer: 'compute-client',
		title: 'Pointer or upload',
		oneliner:
			'A definition Rhino already holds is sent as a short md5 pointer instead of the whole file.',
		detail:
			'The scheduler keeps a bounded map (100 entries) from definition hash to the cache key Rhino.Compute returned for it. When a key is known the solve is sent as `pointer: <key>` with no file attached — this is the case where the lazy byte reference from earlier is never called and zero definition bytes move. If the server has since dropped it, the error is recognised as a definition-load miss, the bytes are materialized, the definition is uploaded once, and the fresh key is learned. That re-upload is reported as `def_reupload`.',
		files: [
			'packages/compute/src/grasshopper/scheduler/solve-scheduler.ts:621-656',
			'packages/compute/src/grasshopper/solve.ts:176-199'
		],
		caches: [
			{ label: 'Pointer map · 100 entries', hit: 'no .gh bytes uploaded' },
			{ label: 'Definition bytes · 256 MB', hit: 'upload without re-reading storage' }
		]
	},
	{
		id: 'r-solve',
		layer: 'rhino',
		title: 'Rhino.Compute solves',
		oneliner:
			'Headless Grasshopper runs the definition — with its own definition and result caches.',
		detail:
			'One POST to /grasshopper carrying the pointer (or the base64 definition) and the input tree. Retries are off by default — the policy ships with zero attempts, so a transient 502/503/504 fails the solve rather than being retried. On the VM, a definition already parsed under its md5 key skips the parse — visible as a near-zero decode time. Selva also sends cachesolve=true by default, so an identical request can be answered from the VM’s own result cache without re-running the definition, which shows up as a near-zero solve time. (Errored solves are excluded from that VM cache by default.) These VM-side caches are shared by every Selva instance pointed at that server and survive Selva restarts.',
		files: [
			'packages/compute/src/grasshopper/solve.ts:231-258',
			'packages/compute/src/grasshopper/solve.ts:304-314',
			'packages/compute/src/core/compute-fetch/retry.ts:3-8',
			'packages/server/src/compute/limits.ts:301-302'
		],
		caches: [
			{ label: 'VM definition cache', hit: 'no parse (decode ≈ 0)' },
			{ label: 'VM cachesolve', hit: 'no re-solve (solve ≈ 0)' }
		]
	},
	{
		id: 'p-out',
		layer: 'selva-server',
		title: 'Serialize, compress, return',
		oneliner: 'JSON, gzip above 1 KB, and a Server-Timing header describing every phase.',
		detail:
			'The result is stringified once — an oversized file output trips a RangeError or the 300 MB cap and becomes a clean 413 rather than a crash. Bodies over 1 KB are gzipped asynchronously when the client advertised it. The Server-Timing header carries load, tree, solve, serialize, gzip and total, the VM’s own decode/solve/encode when reported, the prep sub-marks as p_*, and the cache verdicts: selva_cache, def_reupload, and def_bytes (skipped, hit or miss). Because a coalesced result is one shared object, a gzip body is decompressed again for any waiter that did not ask for gzip.',
		files: [
			'packages/solve/src/server/solve-pipeline.ts:241-340',
			'packages/solve/src/server/solve-pipeline.ts:362-382',
			'packages/solve/src/server/solve-pipeline.ts:409-451'
		]
	},
	{
		id: 'b-render',
		layer: 'browser',
		title: 'Parse and render',
		oneliner: 'JSON decode, then meshes straight out of a binary blob into the three.js viewer.',
		detail:
			'Meshes do not go through rhino3dm. Each display batch carries them as one binary SLVA blob that is decoded directly into three.js geometry — rhino3dm is only needed to rebuild curves, so it is lazily initialized once per session and simply passed along for those. Both meshes and the curve/point items are scaled by the model-unit factor so they share one frame. Outputs are matched by id, falling back to nickname. Textures referenced by materials are fetched and GPU-decoded as they are encountered. The browser also splits its own round-trip against the Server-Timing header to separate network from server time.',
		files: [
			'packages/selva/src/routes/library/[guid]/+page.svelte:150-206',
			'packages/visualization/src/parse/webdisplay/webdisplay-parser.ts:158-204',
			'packages/visualization/src/parse/webdisplay/batch-parser.ts'
		]
	}
];

// ============================================================================
// Local-mode flow (plugin preview over WebSocket)
// ============================================================================

export const LOCAL_STEPS: FlowStep[] = [
	{
		id: 'l-input',
		layer: 'browser',
		title: 'An input changes',
		oneliner:
			'Updates batch in a 50 ms window; while Grasshopper is solving only the latest is kept.',
		detail:
			'The same 150/400 ms debounce runs first — it belongs to the input widgets, which both modes share. After that the paths diverge: values are merged into a batch and flushed 50 ms after the last one, and if Grasshopper is mid-solve the update is not sent at all but held in a single pending slot that a newer update overwrites, then flushed when the solve completes. There is no client memo and no throttle on this path — local mode builds its own WebSocket driver rather than the request/response one, so a repeated value is sent to Grasshopper again rather than replayed from memory, and there is nothing to cancel.',
		files: [
			'packages/plugin-ui/src/lib/schema-source/grasshopper-source.ts:111',
			'packages/plugin-ui/src/lib/websocket/websocket.svelte.ts:337-356'
		],
		gates: ['debounce 150 / 400 ms', '50 ms batch · latest wins']
	},
	{
		id: 'l-ws',
		layer: 'browser',
		title: 'Over the WebSocket',
		oneliner: 'One socket to the plugin — no HTTP, no auth, no database, no compute server.',
		detail:
			'The browser sends the values over the socket the C# plugin serves on port 8765. File metadata objects are stripped from the values first, since Grasshopper already holds the file. This is a push transport — there is no request/response pairing and no cancel; a newer value simply supersedes. On the plugin side messages are handled off the receive loop but strictly in arrival order, each chained onto the previous one, so two rapid updates cannot race and let the older value win.',
		files: [
			'packages/plugin-ui/src/lib/schema-source/websocket-solve-driver.ts:44-65',
			'Plugin/Selva.GH/Features/UIBuilder/Services/Communication/WebSocketTransport.cs:55-59'
		],
		gates: ['strict arrival order']
	},
	{
		id: 'l-solve',
		layer: 'grasshopper',
		title: 'Grasshopper re-solves',
		oneliner: 'The definition is already open in Rhino — nothing is uploaded or parsed.',
		detail:
			'The plugin coalesces once more before solving: if a solve is already running or merely scheduled, the incoming values are merged into a pending buffer rather than starting a competing solve, and that buffer is drained on a fresh tick after the current solve ends. Otherwise the values are written into the linked parameters and the document is scheduled to re-solve in-process. Every step the cloud path spends moving a definition to a machine that can solve it — resolving records, byte references, pointers, uploads — has no equivalent here.',
		files: [
			'Plugin/Selva.GH/Features/UIBuilder/Services/BridgeOrchestrator.cs:107-129',
			'Plugin/Selva.GH/Features/UIBuilder/Services/BridgeOrchestrator.cs:173-194'
		],
		gates: ['merge while busy · latest wins']
	},
	{
		id: 'l-push',
		layer: 'grasshopper',
		title: 'Results push back',
		oneliner: 'A JSON outputs envelope, then the meshes as separate binary frames.',
		detail:
			'The envelope declares how many binary frames to expect; the frames follow as separate socket messages and carry mesh data directly, with no base64 inflation. That count is a three-way signal: absent means this solve carries no mesh payload and the scene is left alone, zero means clear the scene, and any higher number is how many frames to collect before parsing. Each envelope takes a monotonic token so a slow parse from an earlier solve cannot overwrite newer outputs, and frames arriving ahead of their envelope wait in a buffer capped at 64. Curves in the JSON envelope need rhino3dm, which is lazy-loaded on the first solve that carries them; meshes and points do not.',
		files: ['packages/plugin-ui/src/lib/schema-source/websocket-solve-driver.ts:106-207']
	},
	{
		id: 'l-render',
		layer: 'browser',
		title: 'Parse and render',
		oneliner:
			'Frames are parsed, scaled to model units, and handed to the same viewer as cloud mode.',
		detail:
			'Parsed meshes and display items are scaled by the document’s unit factor so both share one coordinate frame, then reported into the solve session. From here the viewer is the same code the cloud path renders into.',
		files: [
			'packages/plugin-ui/src/lib/schema-source/websocket-solve-driver.ts:127-180',
			'packages/visualization/src/parse/webdisplay/apply-texture.ts'
		]
	}
];
