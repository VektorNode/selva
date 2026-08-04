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

/**
 * One piece of expanded content. `prose` carries the explanation; the others exist
 * because some behaviour is far cheaper to show than to describe — an eviction
 * order, a debounce window, a shape.
 *
 * `demo` names a component in `architecture/demos/`, resolved through the registry
 * in `DetailBlocks.svelte`. The name must exist there or the block renders nothing.
 */
export type DetailBlock =
	| { kind: 'prose'; text: string }
	| { kind: 'facts'; rows: [string, string][] }
	| { kind: 'code'; lang: string; text: string }
	| { kind: 'mapping'; from: string; to: string; rows: [string, string][] }
	| { kind: 'warning'; title: string; text: string }
	| { kind: 'demo'; component: string; caption?: string }
	| { kind: 'pipeline'; stages: { label: string; sub: string; terminal?: boolean }[] };

export interface FlowStep {
	id: string;
	layer: Layer;
	title: string;
	/** One-line plain-language summary, always visible. */
	oneliner: string;
	/** Expanded content, rendered in order. */
	detail: DetailBlock[];
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
		detail: [
			{
				kind: 'prose',
				text: 'The input component holds the change instead of committing it immediately: a slider commits 150 ms after the last move, a typed field 400 ms. Dragging a slider across a range therefore produces one solve at the end, not one per frame.'
			},
			{
				kind: 'demo',
				component: 'DebounceDemo',
				caption: 'Drag the slider. Every move is a tick; only the last one survives the window.'
			},
			{
				kind: 'prose',
				text: 'Leaving the field commits straight away, skipping the wait. If the schema turns instance-solving off, the value is only recorded as pending and nothing below this happens until the user presses Calculate.'
			}
		],
		files: [
			'packages/ui/src/lib/components/preview/inputs/NumberInput.svelte',
			'packages/solve/src/client/solve-session-core.ts'
		],
		gates: ['debounce 150 / 400 ms']
	},
	{
		id: 'b-throttle',
		layer: 'browser',
		title: 'Throttle: one solve at a time',
		oneliner:
			'One run in flight; a newer value replaces the single pending slot and the old one is dropped.',
		detail: [
			{
				kind: 'prose',
				text: 'If nothing is running, the values execute immediately. If a run is in flight, the values go into a single pending slot — a newer trigger overwrites whatever was waiting, so intermediate values are dropped rather than queued. When the running solve settles, the pending values execute.'
			},
			{
				kind: 'demo',
				component: 'ThrottleDemo',
				caption:
					'Fire several values while one is running — the slot holds one, and it is always the newest.'
			},
			{
				kind: 'prose',
				text: 'Each run gets an AbortController, and starting a new run aborts the previous signal. Its deadline is the same 100 s the server allows a solve: the page passes the server’s value down, and the client carries no default of its own — there is one deadline in the system, not a client copy that can drift from it.'
			}
		],
		files: [
			'packages/solve/src/client/async-throttle.ts',
			'packages/ui/src/lib/components/compute/ComputeApp.svelte'
		],
		gates: ['1 in flight · latest wins']
	},
	{
		id: 'b-memo',
		layer: 'browser',
		title: 'Client memo check',
		oneliner:
			'Inside the run, before the request: an input set already solved this session is replayed from memory.',
		detail: [
			{
				kind: 'prose',
				text: 'Each entry is one whole solve result — the output values plus the meshes the viewer draws — held in memory in the tab, not on disk. It is gone on reload.'
			},
			{
				kind: 'facts',
				rows: [
					['Holds', '16 entries, evicted least-recently-used'],
					['Keyed on', 'the input values, object keys sorted at every level'],
					['Lifetime', 'the browser tab — never written to disk'],
					['A hit skips', 'the entire request; nothing leaves the browser'],
					['Cleared when', 'the definition changes']
				]
			},
			{
				kind: 'demo',
				component: 'LruDemo',
				caption: 'Solve some values, then repeat one. Watch what falls off the end.'
			},
			{
				kind: 'prose',
				text: 'Sorting the keys means two inputs that differ only in ordering still land on the same entry. Because the lookup sits inside the throttled run rather than in front of it, only values that survive latest-wins are ever looked up — a scrub does not produce a hit per frame. Only successful solves are stored, and entries are copied in and out through an injected mesh clone/release policy so the viewer disposing a mesh cannot corrupt the cached copy.'
			}
		],
		files: [
			'packages/solve/src/client/drivers/request-response.ts',
			'packages/solve/src/client/solve-memo.ts'
		],
		caches: [{ label: 'Client memo · 16 entries', hit: 'no request leaves the browser' }]
	},
	{
		id: 'b-post',
		layer: 'browser',
		title: 'POST /api/compute',
		oneliner: 'Sends the input specs, the values, and an opaque definition reference.',
		detail: [
			{
				kind: 'prose',
				text: 'The body carries the input specs, the values, and a definition reference. For a library definition that reference is the string `local:<guid>` — a pointer the server resolves, not a downloadable link. A version id or `channel: draft` rides along when the page is running a specific version.'
			},
			{
				kind: 'code',
				lang: 'json',
				text: '{\n  "inputs": [ { "id": "radius", "paramType": "number" } ],\n  "values": { "radius": 12.5 },\n  "definitionUrl": "local:9f3c…",\n  "channel": "draft"\n}'
			},
			{
				kind: 'facts',
				rows: [
					['401 or /login redirect', 'session expired'],
					['429', 'client-side cooldown short-circuits later solves'],
					['503', 'compute offline']
				]
			}
		],
		files: ['packages/selva/src/routes/library/[guid]/+page.svelte']
	},
	{
		id: 's-gates',
		layer: 'selva-server',
		title: 'Body cap, identity, rate limit',
		oneliner:
			'Three doors before the work starts: too big, who are you, and how often are you asking.',
		detail: [
			{
				kind: 'prose',
				text: 'Three doors, cheapest first, so a request that will be turned away costs as little as possible.'
			},
			{
				kind: 'facts',
				rows: [
					['1 · Too big?', 'over 210 MB, refused before the body is read'],
					['2 · Who is asking?', 'a share-link token, or a logged-in session'],
					['3 · Too often?', '120 per 100 s, then 429 with Retry-After']
				]
			},
			{
				kind: 'prose',
				text: 'A share-link token rides in the URL or an Authorization header, never the body, and is tied to one definition and one channel; a view-only link is refused here. Everyone else needs a session — and picking a specific version rather than whatever is published requires an editor. The rate limiter then runs before the solve does any real work, so a throttled caller costs a counter check.'
			},
			{
				kind: 'facts',
				rows: [
					['COMPUTE_REQUEST_MAX_BYTES', 'body cap, default 210 MB'],
					['COMPUTE_RATE_LIMIT_MAX', 'requests per window, default 120'],
					['COMPUTE_RATE_LIMIT_WINDOW_MS', 'window length ms, default 100000']
				]
			}
		],
		files: [
			'packages/selva/src/routes/api/compute/+server.ts',
			'packages/server/src/compute/limits.ts'
		],
		gates: ['rate limit 120 / 100 s']
	},
	{
		id: 's-load',
		layer: 'selva-server',
		title: 'Resolve the definition',
		oneliner: 'Four quick lookups turn the id into a solvable job. The file itself never moves.',
		detail: [
			{
				kind: 'prose',
				text: 'All the browser sent was an id — `local:9f3c…`. The server has to turn that into something it can actually solve.'
			},
			{
				kind: 'facts',
				rows: [
					['Does it exist?', 'and which project owns it'],
					['Which machine solves it?', 'this project may pin its own compute server'],
					['Are you allowed?', 'viewing a draft is not the same as solving one'],
					['Which version?', 'the published one, unless you asked for another']
				]
			},
			{
				kind: 'prose',
				text: 'Four answers, four quick lookups — and notably not the Grasshopper file, which never moves. The server passes down instructions for fetching it, and most of the time they go unused: Rhino usually still has the file from an earlier solve and only needs to be told which one.'
			}
		],
		files: ['packages/selva/src/routes/api/compute/+server.ts', 'packages/platform/src/']
	},
	{
		id: 's-server',
		layer: 'selva-server',
		title: 'Pick the compute server, get a warm client',
		oneliner: 'Which Rhino machine solves this — and its connection is usually already open.',
		detail: [
			{
				kind: 'prose',
				text: 'A deployment can have several Rhino machines. The most specific setting wins:'
			},
			{
				kind: 'facts',
				rows: [
					['This definition has a server pinned', 'use it'],
					['Otherwise, the org has one set', 'use that'],
					['Otherwise', 'the deployment-wide default']
				]
			},
			{
				kind: 'prose',
				text: 'Talking to a Rhino machine means a connection and a handshake, so Selva keeps up to 16 of them open and reuses whichever matches. If several requests arrive for the same machine before it is ready, they wait on one connection rather than each opening their own.'
			},
			{
				kind: 'prose',
				text: 'The open connection is filed under the server id, not its address — so changing a machine’s URL or key does not swap the live connection on its own; that entry has to be dropped for the new settings to take effect.'
			}
		],
		files: [
			'packages/selva/src/routes/api/compute/+server.ts',
			'packages/solve/src/server/client-cache.ts'
		],
		caches: [{ label: 'Warm client · 16 servers', hit: 'no reconnect or handshake' }]
	},
	{
		id: 's-tree',
		layer: 'selva-server',
		title: 'Build the input tree',
		oneliner: 'The values are translated into the typed tree Grasshopper actually reads.',
		detail: [
			{
				kind: 'prose',
				text: 'Rhino is a .NET application, but Selva does not spell out the .NET type on the way in — it sends a bare value, addressed to a named parameter rather than sitting loose in an object, and lets Rhino infer the type from the parameter itself. The type only shows up later, on the way back (see the next layer down): Rhino tags every output value with the .NET type it actually produced.'
			},
			{
				kind: 'mapping',
				from: 'the browser sent',
				to: 'goes on the wire as',
				rows: [
					['radius: 12.5', '{ "ParamName": "radius", "InnerTree": { "{0}": [{ "data": 12.5 }] } }'],
					[
						'style: "ribbed"',
						'{ "ParamName": "style", "InnerTree": { "{0}": [{ "data": "ribbed" }] } }'
					]
				]
			},
			{
				kind: 'prose',
				text: 'Each one is wrapped as its parameter name plus a tree of branches — Grasshopper is built around trees, so even a single value travels as a one-item branch. A value whose type is missing is dropped, since there is no parameter for it to land in.'
			},
			{
				kind: 'prose',
				text: 'One side effect matters: that tree doubles as a fingerprint. Same slider, same value, same tree — which is how the next step spots two people asking for the identical thing.'
			}
		],
		files: [
			'packages/selva/src/routes/api/compute/+server.ts',
			'packages/solve/src/server/solve-pipeline.ts'
		]
	},
	{
		id: 's-singleflight',
		layer: 'selva-server',
		title: 'Single-flight coalescing',
		oneliner: 'Identical solves arriving together run once and share the one result.',
		detail: [
			{
				kind: 'prose',
				text: 'Two requests count as the same if they name the same definition version, the same compute server, and the same input tree — so ordering differences in the inputs still collapse together. The first to arrive does the work; everyone after it waits on that same run instead of starting their own.'
			},
			{
				kind: 'prose',
				text: 'There is no window to configure, because the window is simply however long the solve takes: a few milliseconds for a light definition, up to the 100-second deadline for a heavy one. Arrive while it is running and you ride along; arrive a moment after it finishes and you start a fresh solve. A slow definition therefore coalesces far more traffic than a fast one — the busier and slower it is, the more this saves.'
			},
			{
				kind: 'demo',
				component: 'SingleFlightDemo',
				caption: 'Send several identical solves at once — one runs, the rest ride along.'
			},
			{
				kind: 'prose',
				text: 'The key is released as soon as it settles. Nothing is retained, so this coalesces concurrent work but never answers a later request — that is what separates it from a cache. Ownership changes cancellation: a solo run still aborts if its caller disconnects, but once anyone has joined, one caller leaving cannot cancel the shared work.'
			}
		],
		files: [
			'packages/selva/src/routes/api/compute/+server.ts',
			'packages/solve/src/server/solve-cache-single-flight.ts'
		],
		gates: ['coalesce concurrent duplicates']
	},
	{
		id: 'c-cache',
		layer: 'compute-client',
		title: 'Scheduler result cache',
		oneliner: 'A hash of definition + input tree; a hit returns instantly without touching Rhino.',
		detail: [
			{
				kind: 'prose',
				text: 'This definition, these inputs — has it been solved before? The answer decides everything that follows.'
			},
			{
				kind: 'mapping',
				from: 'answer',
				to: 'what it costs',
				rows: [
					['seen it before', '0 ms — Rhino is never called'],
					['never seen it', 'a full solve, queued and run']
				]
			},
			{
				kind: 'prose',
				text: 'A hit is not "fast", it is free: the stored answer is handed back and the request ends there. You can see which one happened from the browser — a hit sets the `selva_cache` flag in the response timing header.'
			},
			{
				kind: 'facts',
				rows: [
					['Holds', 'finished solve results'],
					['Full at', '256 MB, then the least recently used is dropped'],
					['Expires', 'never, on any timer'],
					['Lives in', 'the Selva server, one per compute machine'],
					['Turn it off', 'set the budget to 0']
				]
			},
			{
				kind: 'prose',
				text: 'TTL expiry exists in the cache but ships off by default — deliberately. The same definition with the same inputs always produces the same geometry, and neither can change underneath a stored result — so discarding one on a schedule would only buy a paid re-solve of an answer already in hand. Running out of memory is the only reason an entry leaves.'
			},
			{
				kind: 'warning',
				title: 'Unless the definition is not repeatable',
				text: 'A definition that reads the clock, fetches a live URL, or picks a random number gives a different answer each run. Store one of those and it is not merely stale but wrong — and nothing here notices. The budget is deployment-wide, so the only lever is turning the cache off entirely.'
			},
			{
				kind: 'facts',
				rows: [
					['COMPUTE_SOLVE_CACHE_MB', 'budget in MB, default 256, PER warm client'],
					['COMPUTE_SERVER_CACHESOLVE', 'also ask Rhino.Compute to cache, default true'],
					['COMPUTE_CACHE_ERRORED_SOLVES', 'also cache Grasshopper-error results, default false']
				]
			}
		],
		files: [
			'packages/compute/src/grasshopper/scheduler/solve-scheduler.ts',
			'packages/solve/src/server/client-cache.ts'
		],
		caches: [{ label: 'Solve cache · 256 MB · LRU', hit: 'Rhino is never called' }]
	},
	{
		id: 'c-queue',
		layer: 'compute-client',
		title: 'Scheduler queue',
		oneliner: 'As many solves in flight as the machine has workers; the rest wait their turn.',
		detail: [
			{
				kind: 'prose',
				text: 'A Rhino machine runs a pool of worker processes — four by default. Selva keeps that many solves in flight and no more; the next one does not fail and is not dropped, it waits here in the Selva server until a worker frees up.'
			},
			{
				kind: 'prose',
				text: 'The two numbers have to agree, and nothing forces them to. The machine hands out workers in strict rotation and never says "busy", so if Selva sends more than the pool has, the extras simply double up on a worker and everything gets slower. So Selva asks the machine how many workers it has rather than assuming — once when it connects, then again after a solve whenever the last answer is more than five minutes old. The check never blocks a solve, so a resized pool takes effect on the next one.'
			},
			{
				kind: 'demo',
				component: 'QueueDemo',
				caption:
					'Send eight, then change the worker count mid-flight. Selva keeps sending its old number until the next solve finishes and it re-reads — that lag is the amber state.'
			},
			{
				kind: 'facts',
				rows: [
					['In flight at once', 'the machine’s worker count, always auto-read, never hardcoded'],
					['To change it', 'resize --childcount on the compute server — Selva just follows'],
					['A solve may take', 'up to 100 s, then it is given up on'],
					['Queue length', 'unlimited by default — nothing is turned away'],
					['If an operator caps it', 'over-capacity requests are refused up front, told to retry']
				]
			},
			{
				kind: 'facts',
				rows: [
					[
						'Worker count',
						'auto-detected from the server, re-probed periodically; falls back to 1 if unreadable'
					],
					['COMPUTE_MAX_QUEUE_DEPTH', 'max solves waiting, default 0 = unbounded'],
					['COMPUTE_QUEUE_WAIT_MS', 'max wait before rejecting, default 0 = no deadline'],
					['COMPUTE_SOLVE_DEADLINE_MS', 'per-solve deadline, default 100000']
				]
			},
			{
				kind: 'prose',
				text: 'This is the opposite of the throttle back in the browser. There, a newer value replaces a waiting one and the old value is thrown away — nobody is waiting on it. Here every request has someone waiting for an answer, so none can be discarded; a burst costs time rather than losing work.'
			}
		],
		files: [
			'packages/solve/src/server/client-cache.ts',
			'packages/compute/src/grasshopper/scheduler/solve-scheduler.ts',
			'packages/server/src/compute/limits.ts'
		],
		gates: ['queue · workers in flight']
	},
	{
		id: 'c-pointer',
		layer: 'compute-client',
		title: 'Pointer or upload',
		oneliner:
			'A definition Rhino already holds is sent as a short md5 pointer instead of the whole file.',
		detail: [
			{
				kind: 'prose',
				text: 'The first time gear.gh is solved, the whole file rides along, and Rhino.Compute hands back a short id for it. Selva writes that id down — up to 100 definitions, oldest dropped first — and every solve after that sends the id instead of the file.'
			},
			{
				kind: 'code',
				lang: 'json',
				text: '// Selva has the id on file — send it, not the .gh bytes\n{ "pointer": "md5:7ab3…", "values": [ … ] }\n\n// no id on file yet — send the whole definition\n{ "algo": "<base64 .gh bytes>", "values": [ … ] }'
			},
			{
				kind: 'prose',
				text: 'Selva having the id written down is not the same as Rhino.Compute still recognising it. If that machine restarts, it forgets which id points to which file — so a solve sent with a now-meaningless id comes back rejected, not silently wrong. Selva reads that rejection as "resend the file," does so once, gets a fresh id back, and writes that one down instead. The user just sees one slightly slower solve, no error.'
			},
			{
				kind: 'facts',
				rows: [
					['COMPUTE_REUSE_DEFINITION_CACHE', 'send pointer instead of bytes, default true'],
					['COMPUTE_DEFINITION_CACHE_MB', 'definition-bytes budget in MB, default 256']
				]
			}
		],
		files: [
			'packages/compute/src/grasshopper/scheduler/solve-scheduler.ts',
			'packages/compute/src/grasshopper/solve.ts'
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
		detail: [
			{
				kind: 'prose',
				text: 'One POST to /grasshopper carrying the pointer (or the base64 definition) and the input tree. Retries are off by default — the policy ships with zero attempts, so a transient 502/503/504 fails the solve rather than being retried.'
			},
			{
				kind: 'facts',
				rows: [
					['VM definition cache', 'already-parsed definition → decode ≈ 0'],
					['VM cachesolve', 'identical request → solve ≈ 0, sent on by default'],
					['Errored solves', 'excluded from the VM cache by default'],
					['Shared by', 'every Selva instance pointed at that server'],
					['Survives', 'a Selva restart — these live on the VM']
				]
			}
		],
		files: [
			'packages/compute/src/grasshopper/solve.ts',
			'packages/compute/src/core/compute-fetch/retry.ts',
			'packages/server/src/compute/limits.ts'
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
		detail: [
			{
				kind: 'prose',
				text: 'The result becomes JSON, gzipped if it is over 1 KB and the browser accepts it. A result too large to turn into JSON — over 300 MB — is refused with a clean 413 instead of crashing the server.'
			},
			{
				kind: 'prose',
				text: 'Every step above leaves a timestamp, and they all ride back on one response header — so the browser can show a full breakdown without a separate request:'
			},
			{
				kind: 'code',
				lang: 'http',
				text: 'Server-Timing: load;dur=0, tree;dur=2, solve;dur=0,\n  serialize;dur=14, gzip;dur=6, total;dur=23,\n  selva_cache;desc=1, def_bytes;desc=skipped'
			},
			{
				kind: 'prose',
				text: 'One edge case: when several requests were coalesced into one solve, they share a single compressed result — so any of them that did not ask for gzip gets it decompressed again just for them.'
			}
		],
		files: ['packages/solve/src/server/solve-pipeline.ts']
	},
	{
		id: 'b-decode',
		layer: 'browser',
		title: 'The page reads the response',
		oneliner:
			'The library page — not a package — decodes the JSON and matches outputs to the schema.',
		detail: [
			{
				kind: 'pipeline',
				stages: [
					{ label: 'The page', sub: 'decodes JSON, matches outputs' },
					{ label: '@selvajs/visualization', sub: 'response → three.js meshes' },
					{ label: '@selvajs/ui', sub: 'owns the scene, draws it', terminal: true }
				]
			},
			{
				kind: 'prose',
				text: 'This part is just the page: parse the JSON body, then for each output the schema defines, find its value. No package owns this step — it is what the library route does with a solve result once it has one.'
			},
			{
				kind: 'mapping',
				from: 'the schema defines',
				to: 'found in the response by',
				rows: [
					['output "area", id 3f2a', 'byId 3f2a'],
					['output "area", id missing', "byName 'area' (its Grasshopper nickname)"]
				]
			},
			{
				kind: 'prose',
				text: 'Id is tried first and used whenever Compute returns one; the nickname is only a fallback for a stock Rhino.Compute server that omits it. The page also measures itself against the Server-Timing header from the earlier step, so it can show network time separately from server time.'
			}
		],
		files: ['packages/selva/src/routes/library/[guid]/+page.svelte']
	},
	{
		id: 'b-render',
		layer: 'browser',
		title: '@selvajs/visualization turns it into geometry',
		oneliner:
			'Meshes straight out of a binary blob into three.js — no other package is involved yet.',
		detail: [
			{
				kind: 'prose',
				text: 'The page hands the raw solve response to this package and gets back three.js meshes. Nothing is decoded from Rhino geometry in the browser: each display batch carries meshes as one binary SLVA blob, and curves arrive already tessellated as plain points. No WASM, no Rhino dependency on the frontend at all.'
			},
			{
				kind: 'prose',
				text: 'Meshes and curve/point items are scaled by the model-unit factor so they share one frame, and textures referenced by materials are fetched and GPU-decoded as they are encountered. What this package does not do: put anything on screen. That is the next step.'
			}
		],
		files: [
			'packages/visualization/src/parse/webdisplay/webdisplay-parser.ts',
			'packages/visualization/src/parse/webdisplay/batch-parser.ts'
		]
	},
	{
		id: 'b-viewer',
		layer: 'browser',
		title: '@selvajs/ui draws it',
		oneliner:
			'The Svelte viewer owns the solve session and the scene — the two packages before it only hand back data.',
		detail: [
			{
				kind: 'prose',
				text: "Everything so far — the page, the compute client, the visualization package — only produces data: JSON, meshes, timings. Nothing has appeared on screen yet. That is this package's job: Viewer.svelte holds the three.js scene, and useSolveSession is what actually calls the earlier steps and feeds their result in."
			},
			{
				kind: 'prose',
				text: 'After each solve, the viewer builds the scene outliner — the thing the sidebar panel reads to show visibility and layers — and applies it. The panel itself never talks to the scene directly, only to what the viewer already computed.'
			}
		],
		files: [
			'packages/ui/src/lib/components/viewer/Viewer.svelte',
			'packages/ui/src/lib/compute/useSolveSession.svelte.ts'
		]
	}
];

// ============================================================================
// Configuration — every compute env var, resolved in `resolveComputeLimits`
// (packages/server/src/compute/limits.ts). Grouped by what they tune, in the
// order a solve actually meets them.
// ============================================================================

export interface EnvVarGroup {
	title: string;
	vars: { name: string; default: string; text: string }[];
}

export const ENV_VAR_GROUPS: EnvVarGroup[] = [
	{
		title: 'Doors before the work starts',
		vars: [
			{
				name: 'COMPUTE_REQUEST_MAX_BYTES',
				default: '210 MB',
				text: 'JSON request body cap for /api/compute (inputs + values, not the .gh file). Must stay under adapter-node’s global BODY_SIZE_LIMIT or that rejects first.'
			},
			{
				name: 'COMPUTE_RESPONSE_MAX_BYTES',
				default: '300 MB',
				text: 'JSON response cap. Above this the result is refused with a clean 413 instead of crashing on V8’s string-size wall.'
			},
			{
				name: 'COMPUTE_RATE_LIMIT_MAX',
				default: '120',
				text: 'Requests allowed per window on /api/compute before a 429 with Retry-After.'
			},
			{
				name: 'COMPUTE_RATE_LIMIT_WINDOW_MS',
				default: '100000',
				text: 'Length of the fixed rate-limit window, in ms.'
			},
			{
				name: 'MAX_GH_FILE_SIZE_BYTES',
				default: '50 MB',
				text: 'Largest .gh definition accepted on upload, and the largest remote definition fetched — kept in lockstep so a remote URL can’t smuggle a bigger file past the upload cap. Matches Rhino.Compute’s own request-size default.'
			},
			{
				name: 'MAX_IMAGE_FILE_SIZE_BYTES',
				default: '10 MB',
				text: 'Largest image upload accepted for an image-typed input.'
			},
			{
				name: 'REMOTE_DEFINITION_FETCH_TIMEOUT_MS',
				default: '30000',
				text: 'Deadline for fetching a remote .gh URL — slow-loris protection.'
			},
			{
				name: 'REMOTE_DEFINITION_CACHE_TTL_MS',
				default: '300000',
				text: 'How long a fetched remote .gh’s bytes stay cached before being re-fetched. Only the remote path expires on a timer — the version-id-keyed definition cache below never does, because that key can’t go stale.'
			}
		]
	},
	{
		title: 'How many solves run at once',
		vars: [
			{
				name: 'COMPUTE_MAX_QUEUE_DEPTH',
				default: '0 (unbounded)',
				text: 'Backpressure: how many solves may wait in the FIFO queue once the in-flight cap is full. A solve arriving to a full queue is rejected immediately (503 + Retry-After) instead of piling up. Size to roughly 2–3× the concurrency cap. The in-flight cap itself is not an env var — Selva auto-detects it from the compute server’s active worker count, re-probing as the pool resizes, and falls back to 1 if that count can’t be read. Resize --childcount on the compute server to change it.'
			},
			{
				name: 'COMPUTE_QUEUE_WAIT_MS',
				default: '0 (no deadline)',
				text: 'Backpressure: longest a solve may sit queued before it’s rejected rather than run stale. A sensible tuned value is close to COMPUTE_SOLVE_DEADLINE_MS.'
			},
			{
				name: 'COMPUTE_SOLVE_DEADLINE_MS',
				default: '100000',
				text: 'Longest one solve is allowed to run before it’s aborted — propagated into the upstream Compute call, so it actually cancels the work rather than merely timing out client-side. A reverse proxy or serverless platform can still cap it lower.'
			}
		]
	},
	{
		title: 'What gets cached, and how big',
		vars: [
			{
				name: 'COMPUTE_DEFINITION_CACHE_MB',
				default: '256',
				text: 'Byte budget for the in-process cache of .gh bytes, keyed on immutable version id. A warm entry skips the storage read entirely. 0 disables it.'
			},
			{
				name: 'COMPUTE_SOLVE_CACHE_MB',
				default: '256',
				text: 'Byte budget for the solve-result cache — but PER warm compute-client. Up to 16 servers are kept warm, so the real ceiling is this × 16. 0 disables it.'
			},
			{
				name: 'COMPUTE_REUSE_DEFINITION_CACHE',
				default: 'true',
				text: 'Send a short pointer instead of re-uploading the .gh bytes each solve. Only safe against a compute server that signals a stale-pointer miss instead of silently returning empty geometry (the VektorNode fork does); leave off for an unknown/standard rhino.compute.'
			},
			{
				name: 'COMPUTE_SERVER_CACHESOLVE',
				default: 'true',
				text: 'Ask Rhino.Compute itself to cache solve results keyed on the full request, so an identical repeat skips solving. Server-wide — survives Selva restarts.'
			},
			{
				name: 'COMPUTE_CACHE_ERRORED_SOLVES',
				default: 'false',
				text: 'Also cache solves that reported a Grasshopper error. Correct for definitions that error-by-design (guarded Python, pruned branches) but still return valid geometry — off by default because most errors aren’t that.'
			}
		]
	},
	{
		title: 'Diagnostics',
		vars: [
			{
				name: 'SELVA_FLAG_COMPUTE_DEBUG',
				default: 'off',
				text: 'Three-way, not a boolean: off, on (concise cache/timing logs for every step above), or verbose (also dumps full request/response payloads, including base64 geometry — never enable on a deployment holding real data).'
			}
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
		detail: [
			{
				kind: 'prose',
				text: 'The same 150/400 ms debounce runs first — it belongs to the input widgets, which both modes share. After that the paths diverge: values are merged into a batch and flushed 50 ms after the last one, and if Grasshopper is mid-solve the update is not sent at all but held in a single pending slot that a newer update overwrites, then flushed when the solve completes.'
			},
			{
				kind: 'prose',
				text: 'There is no client memo and no throttle on this path. Local mode builds its own WebSocket driver rather than the request/response one, so a repeated value is sent to Grasshopper again rather than replayed from memory — and there is nothing to cancel.'
			}
		],
		files: ['packages/plugin-ui/src/lib/websocket/websocket.svelte.ts'],
		gates: ['debounce 150 / 400 ms', '50 ms batch · latest wins']
	},
	{
		id: 'l-ws',
		layer: 'browser',
		title: 'Over the WebSocket',
		oneliner: 'One socket to the plugin — no HTTP, no auth, no database, no compute server.',
		detail: [
			{
				kind: 'prose',
				text: 'The browser sends the values over the socket the C# plugin serves on port 8765. File metadata objects are stripped from the values first, since Grasshopper already holds the file.'
			},
			{
				kind: 'prose',
				text: 'This is a push transport — there is no request/response pairing and no cancel; a newer value simply supersedes. On the plugin side messages are handled off the receive loop but strictly in arrival order, each chained onto the previous one, so two rapid updates cannot race and let the older value win.'
			}
		],
		files: [
			'packages/plugin-ui/src/lib/schema-source/websocket-solve-driver.ts',
			'Plugin/Selva.GH/Features/UIBuilder/Services/Communication/WebSocketTransport.cs'
		],
		gates: ['strict arrival order']
	},
	{
		id: 'l-solve',
		layer: 'grasshopper',
		title: 'Grasshopper re-solves',
		oneliner: 'The definition is already open in Rhino — nothing is uploaded or parsed.',
		detail: [
			{
				kind: 'prose',
				text: 'The plugin coalesces once more before solving: if a solve is already running or merely scheduled, the incoming values are merged into a pending buffer rather than starting a competing solve, and that buffer is drained on a fresh tick after the current solve ends. Otherwise the values are written into the linked parameters and the document is scheduled to re-solve in-process.'
			},
			{
				kind: 'prose',
				text: 'Every step the cloud path spends moving a definition to a machine that can solve it — resolving records, byte references, pointers, uploads — has no equivalent here. The definition is already open.'
			}
		],
		files: ['Plugin/Selva.GH/Features/UIBuilder/Services/BridgeOrchestrator.cs'],
		gates: ['merge while busy · latest wins']
	},
	{
		id: 'l-push',
		layer: 'grasshopper',
		title: 'Results push back',
		oneliner: 'A JSON outputs envelope, then the meshes as separate binary frames.',
		detail: [
			{
				kind: 'prose',
				text: 'The envelope declares how many binary frames to expect; the frames follow as separate socket messages and carry mesh data directly, with no base64 inflation.'
			},
			{
				kind: 'facts',
				rows: [
					['Frame count absent', 'no mesh payload — the scene is left alone'],
					['Frame count zero', 'clear the scene'],
					['Frame count n', 'collect n frames, then parse'],
					['Out-of-order frames', 'buffered ahead of their envelope, capped at 64'],
					['Stale parses', 'a monotonic token per envelope discards them']
				]
			},
			{
				kind: 'prose',
				text: 'Curves ride the JSON envelope already tessellated by the plugin, so the browser builds lines straight from their points — nothing here decodes Rhino geometry.'
			}
		],
		files: ['packages/plugin-ui/src/lib/schema-source/websocket-solve-driver.ts']
	},
	{
		id: 'l-render',
		layer: 'browser',
		title: 'Parse and render',
		oneliner:
			'Frames are parsed, scaled to model units, and handed to the same viewer as cloud mode.',
		detail: [
			{
				kind: 'prose',
				text: 'Parsed meshes and display items are scaled by the document’s unit factor so both share one coordinate frame, then reported into the solve session. From here the viewer is the same code the cloud path renders into.'
			}
		],
		files: [
			'packages/plugin-ui/src/lib/schema-source/websocket-solve-driver.ts',
			'packages/visualization/src/parse/webdisplay/apply-texture.ts'
		]
	}
];
