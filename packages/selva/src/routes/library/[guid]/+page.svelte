<script lang="ts">
	import type { PageProps } from './$types';
	import type { RhinoModule } from 'rhino3dm';
	import { ComputeApp, type SolveFn } from '@selvajs/ui';
	import { GrasshopperResponseProcessor } from '@selvajs/compute';
	import { getThreeMeshesFromComputeResponse } from '@selvajs/visualization/parse';
	import ServerFooter from '$lib/components/ServerFooter.svelte';
	import UserChip from '$lib/components/UserChip.svelte';

	// Pass rhino3dm.wasm via locateFile to avoid 404 on dynamic routes.
	import rhinoWasmUrl from 'rhino3dm/rhino3dm.wasm?url';

	let { data }: PageProps = $props();

	// Lazy-load once; curves skipped without it.
	let rhinoPromise: Promise<RhinoModule> | null = null;
	function getRhino(): Promise<RhinoModule> {
		if (!rhinoPromise) {
			rhinoPromise = import('rhino3dm').then((m) => {
				const init = m.default as (opts?: {
					locateFile?: (path: string) => string;
				}) => Promise<RhinoModule>;
				return init({ locateFile: () => rhinoWasmUrl });
			});
		}
		return rhinoPromise;
	}

	// Short-circuit solves during rate-limit window.
	let cooldownUntil = 0;

	// Parse a `Server-Timing` response header (e.g. "solve;dur=12.3, total;dur=40")
	// into a name->ms map. Only the `dur` param is read; missing/garbled entries are
	// skipped. Powers the server sub-phase line in the [Compute/browser] log.
	function parseServerTiming(header: string | null): Record<string, number> {
		const out: Record<string, number> = {};
		if (!header) return out;
		for (const part of header.split(',')) {
			const [name, ...params] = part.split(';').map((s) => s.trim());
			const dur = params.find((p) => p.startsWith('dur='));
			if (!name || !dur) continue;
			const ms = Number(dur.slice(4));
			if (Number.isFinite(ms)) out[name] = ms;
		}
		return out;
	}

	const onSolve: SolveFn = async (values, signal) => {
		const remainingMs = cooldownUntil - Date.now();
		if (remainingMs > 0) {
			throw new Error(`Rate limit reached. Try again in ${Math.ceil(remainingMs / 1000)}s.`);
		}

		// Browser-side timing. Concise, always on — the server's SELVA_FLAG_COMPUTE_DEBUG
		// covers the server/Rhino segments but can't reach the browser. We split the
		// round-trip into three parts so a slow solve can be told apart from a slow
		// transfer of a big result:
		//   • ttfb     — fetch() resolves when RESPONSE HEADERS arrive: request latency
		//                + server processing + Rhino solve. A cached solve makes this small.
		//   • download — reading the body to completion: TRANSMISSION of the payload over
		//                the wire. This is what balloons when compute is cached (~0ms) but
		//                the browser still waits many seconds — a large mesh/file result.
		//   • parse    — client-side JSON decode + mesh extraction.
		const solveStart = performance.now();

		// `values` arrives input-keyed only: the solve session projects outputs away
		// before dispatch (pickInputValues in @selvajs/ui), so output payloads merged
		// into the session's values map (e.g. dynamic value list options) never reach
		// any transport.
		// Serialized once so the request size can be logged — a large request body
		// (e.g. a geometry/file input in `values`) pays the same slow uplink as the
		// download and shows up server-side as a slow `body` prep mark.
		const payload = JSON.stringify({
			inputs: data.schema.inputs,
			values,
			definitionUrl: data.ghDefinition,
			// An explicit version pick takes precedence over the channel pointer.
			...(data.versionId
				? { versionId: data.versionId }
				: data.channel === 'draft' && { channel: 'draft' })
		});
		const valuesBytes = JSON.stringify(values).length;

		let res: Response;
		try {
			res = await fetch('/api/compute', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: payload,
				signal
			});
		} catch (err) {
			if (signal.aborted) {
				console.debug('[Compute/browser] solve aborted during fetch — empty result discarded');
				return { outputs: {} };
			}
			// A TypeError here means the request never completed. With an SSO proxy in
			// front (e.g. Azure App Proxy), an expired session 302s the fetch to the
			// IdP, which CORS blocks — only an interactive reload can re-authenticate.
			throw new Error(
				'Request blocked — your session may have expired. Reload the page to sign in again.',
				{ cause: err }
			);
		}

		if (signal.aborted) {
			console.debug('[Compute/browser] solve aborted after headers — empty result discarded');
			return { outputs: {} };
		}

		// Session expiry surfaces two ways: our hook answers 401 (possibly with the
		// body stripped by an SSO proxy, so don't rely on it), or a proxy/route
		// redirects the fetch to the login page (200 HTML — would die in JSON.parse).
		const redirectedToLogin = res.redirected && new URL(res.url).pathname === '/login';
		if (res.status === 401 || redirectedToLogin) {
			throw new Error(
				'Your session has expired. Sign in again in a new tab, then re-run — your inputs are preserved.'
			);
		}

		if (!res.ok) {
			if (res.status === 503) {
				throw new Error('Compute server is offline or unreachable. Please try again later.');
			}
			// Read the body as text first so a non-JSON error body (proxy page, HTML
			// error) is logged instead of silently discarded by a failed .json().
			const errorBody = await res.text().catch(() => '');
			let d: { message?: string; retryAfter?: number } = {};
			try {
				d = JSON.parse(errorBody);
			} catch {
				if (errorBody) {
					console.warn(
						`[Compute/browser] non-JSON error body (HTTP ${res.status}):`,
						errorBody.slice(0, 300)
					);
				}
			}
			if (res.status === 429) {
				const retryAfter = Number(res.headers.get('Retry-After')) || Number(d.retryAfter) || 5;
				cooldownUntil = Date.now() + retryAfter * 1000;
				throw new Error(d.message || `Rate limit reached. Try again in ${retryAfter}s.`);
			}
			throw new Error(d.message || `Compute error (HTTP ${res.status})`);
		}

		// Headers are in — everything up to here is time-to-first-byte (solve/server).
		const ttfbMs = performance.now() - solveStart;

		// Read the body to completion; this is the transmission time of the payload.
		const downloadStart = performance.now();
		const bodyText = await res.text();
		if (signal.aborted) {
			console.debug('[Compute/browser] solve aborted mid-download — empty result discarded');
			return { outputs: {} };
		}
		const downloadMs = performance.now() - downloadStart;
		const bytes = bodyText.length;

		// JSON decode of the payload string.
		const jsonStart = performance.now();
		let solved;
		try {
			solved = JSON.parse(bodyText);
		} catch (err) {
			// A 200 with a non-JSON body means something between us and the server
			// (SSO proxy, gateway) replaced the response. Raw SyntaxError is useless
			// to the user — name the likely fix instead.
			throw new Error(
				'Received an invalid response from the server. Reload the page and try again.',
				{
					cause: err
				}
			);
		}
		const processor = new GrasshopperResponseProcessor(solved, false);
		const jsonMs = performance.now() - jsonStart;

		const shouldShowViewer =
			data.schema.viewerOptions?.enableLocal || data.schema.viewerOptions?.enableRemote;

		// rhino3dm wasm init (first solve only — cached after) is separate from mesh
		// decode, so a slow first solve isn't misattributed to geometry.
		const rhinoStart = performance.now();
		const rhino = shouldShowViewer ? await getRhino() : null;
		const rhinoInitMs = performance.now() - rhinoStart;

		const meshStart = performance.now();
		const meshes = rhino
			? await getThreeMeshesFromComputeResponse(processor.response, {
					debug: processor.debug,
					rhino
				})
			: [];
		const meshMs = performance.now() - meshStart;

		// Fall back to name if id missing (VektorNode fork only); stock Compute omits id.
		const outputStart = performance.now();
		const outputs: Record<string, unknown> = {};
		for (const o of data.schema.outputs) {
			const byId = processor.getValue({ byId: o.id }, { parseValues: true });
			const name = (o as { nickname?: string }).nickname;
			outputs[o.id] =
				byId ?? (name ? processor.getValue({ byName: name }, { parseValues: true }) : undefined);
		}
		const outputMs = performance.now() - outputStart;

		// Result health: names outputs that came back empty and surfaces GH
		// errors/warnings — an abnormally fast solve with no meshes usually means an
		// input state (e.g. a stale dynamic value list selection) killed the heavy
		// branch, and the empty result then gets replayed by the solve caches.
		const emptyOutputs = data.schema.outputs.filter((o) => outputs[o.id] == null);
		const errCount = Array.isArray(solved.errors) ? solved.errors.length : 0;
		const warnCount = Array.isArray(solved.warnings) ? solved.warnings.length : 0;
		console.log(
			`[Compute/browser]   └─ result: ${data.schema.outputs.length - emptyOutputs.length}/${data.schema.outputs.length} outputs populated | ` +
				`errors=${errCount} warnings=${warnCount}` +
				(emptyOutputs.length ? ` | EMPTY: ${emptyOutputs.map((o) => o.nickname).join(', ')}` : '') +
				(errCount > 0 ? ` | first error: ${JSON.stringify(solved.errors[0]).slice(0, 200)}` : '')
		);

		// Server's own phase breakdown, piggybacked on the response (Server-Timing).
		// `serverTotal` is the server's headers-to-out wall time, so `ttfb − serverTotal`
		// isolates request-send + network latency from server work.
		const serverTiming = parseServerTiming(res.headers.get('Server-Timing'));
		const serverTotal = serverTiming.total ?? 0;
		const networkMs = Math.max(0, ttfbMs - serverTotal);

		const sizeMB = bytes / (1024 * 1024);
		const size = sizeMB >= 1 ? `${sizeMB.toFixed(2)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
		// Effective transfer rate — makes an actually-slow network obvious vs. a small payload.
		const mbps = downloadMs > 0 ? (sizeMB / (downloadMs / 1000)).toFixed(1) : '∞';
		const totalMs = ttfbMs + downloadMs + jsonMs + rhinoInitMs + meshMs + outputMs;
		// JS heap watermark (Chrome-only, non-standard API): one number per solve. A
		// monotonic climb across a session — independent of payload size — is the
		// signature of a retention leak (undisposed meshes / rhino3dm wasm objects).
		const heapMB = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
			?.usedJSHeapSize;
		const heap = heapMB !== undefined ? ` | heap=${(heapMB / (1024 * 1024)).toFixed(0)} MB` : '';
		const reqKB = payload.length / 1024;
		const reqSize = reqKB >= 1024 ? `${(reqKB / 1024).toFixed(2)} MB` : `${reqKB.toFixed(0)} KB`;
		// When the request is heavy, name the inputs responsible — an embedded
		// geometry/file value pays the slow uplink on every solve.
		if (valuesBytes > 256 * 1024) {
			const inputLabel = (id: string) => {
				const input = data.schema.inputs.find((i) => i.id === id);
				return input ? `${input.nickname} (${input.paramType})` : id;
			};
			const whales = Object.entries(values)
				.map(([id, v]) => [id, JSON.stringify(v)?.length ?? 0] as const)
				.sort((a, b) => b[1] - a[1])
				.slice(0, 3);
			console.log(
				`[Compute/browser]   └─ request whales: ` +
					whales.map(([id, n]) => `${inputLabel(id)}=${(n / 1024).toFixed(0)} KB`).join(' | ')
			);
		}
		console.log(
			`[Compute/browser] req=${reqSize} (values ${(valuesBytes / 1024).toFixed(0)} KB) | ` +
				`total=${totalMs.toFixed(0)}ms | ` +
				`ttfb=${ttfbMs.toFixed(0)}ms (network≈${networkMs.toFixed(0)} + server ${serverTotal.toFixed(0)}) | ` +
				`download=${downloadMs.toFixed(0)}ms (${size} @ ${mbps} MB/s) | ` +
				`json=${jsonMs.toFixed(0)}ms | rhinoInit=${rhinoInitMs.toFixed(0)}ms | ` +
				`mesh=${meshMs.toFixed(0)}ms (${meshes.length}) | outputs=${outputMs.toFixed(0)}ms${heap}`
		);
		if (serverTiming.total !== undefined) {
			// Server-side sub-phases (from the response header). solve==0 means a cached
			// compute result — if `total` here is still large the cost is serialize or
			// definition load, not the solve.
			console.log(
				`[Compute/browser]   └─ server: load=${(serverTiming.load ?? 0).toFixed(0)}ms ` +
					`tree=${(serverTiming.tree ?? 0).toFixed(0)}ms solve=${(serverTiming.solve ?? 0).toFixed(0)}ms ` +
					`serialize=${(serverTiming.serialize ?? 0).toFixed(0)}ms gzip=${(serverTiming.gzip ?? 0).toFixed(0)}ms`
			);
		}
		// Cache verdicts (0/1 flags on Server-Timing): whether Selva's response cache
		// served this solve without calling compute, and whether the .gh definition
		// had to be re-uploaded to the compute server (cold/stale pointer).
		if (serverTiming.selva_cache !== undefined) {
			const cacheMsg = serverTiming.selva_cache
				? 'Selva-cache HIT — served without calling compute'
				: 'miss — solved on Rhino.Compute';
			const reuploadMsg =
				serverTiming.def_reupload === undefined
					? ''
					: serverTiming.def_reupload
						? ' | definition RE-UPLOADED (cold/stale pointer)'
						: ' | definition reused on server (no upload)';
			console.log(`[Compute/browser]   └─ cache: ${cacheMsg}${reuploadMsg}`);
		}
		// Pre-solve prep sub-steps (p_* Server-Timing entries) — names which step a
		// `load` spike hides in (share token, DB reads, blob fetch, server resolve…).
		const prepEntries = Object.entries(serverTiming).filter(([k]) => k.startsWith('p_'));
		if (prepEntries.length > 0) {
			console.log(
				`[Compute/browser]   └─ prep: ` +
					prepEntries.map(([k, v]) => `${k.slice(2)}=${v.toFixed(0)}ms`).join(' ')
			);
		}
		if (serverTiming.rhino_solve !== undefined) {
			// Splits `solve` above into work ON the compute server vs. the traffic
			// between the Selva server and Rhino.Compute (transfer + queue). A large
			// compute_link means the compute↔web-server leg is the cost, not solving.
			console.log(
				`[Compute/browser]   └─ compute server: decode=${(serverTiming.rhino_decode ?? 0).toFixed(0)}ms ` +
					`solve=${(serverTiming.rhino_solve ?? 0).toFixed(0)}ms encode=${(serverTiming.rhino_encode ?? 0).toFixed(0)}ms ` +
					`| compute↔server traffic+queue=${(serverTiming.compute_link ?? 0).toFixed(0)}ms`
			);
		}
		// Network-stack cross-check (Resource Timing): the browser's own measurement
		// of this fetch, independent of our JS-level timers. transferSize = actual
		// bytes on the wire; encoded==decoded body size means the response went out
		// UNCOMPRESSED. startTime filter guards against a stale entry when the
		// resource buffer (default 250) has overflowed.
		const resEntry = (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
			.filter((e) => e.name.includes('/api/compute') && e.startTime >= solveStart)
			.at(-1);
		if (resEntry && resEntry.responseEnd > 0) {
			const wireMB = resEntry.transferSize / (1024 * 1024);
			const compressed =
				resEntry.encodedBodySize > 0 && resEntry.decodedBodySize > resEntry.encodedBodySize * 1.05;
			console.log(
				`[Compute/browser]   └─ wire (network-stack): ${wireMB.toFixed(2)} MB on-wire ` +
					`(${compressed ? `compressed ${(resEntry.decodedBodySize / resEntry.encodedBodySize).toFixed(1)}×` : 'UNCOMPRESSED'}) | ` +
					`headers=${(resEntry.responseStart - resEntry.requestStart).toFixed(0)}ms ` +
					`body=${(resEntry.responseEnd - resEntry.responseStart).toFixed(0)}ms`
			);
		}

		return {
			outputs,
			meshes,
			errors: solved.errors ?? [],
			warnings: solved.warnings ?? []
		};
	};
</script>

<ComputeApp
	schema={data.schema}
	{onSolve}
	definitionKey={data.currentDefinition}
	title={data.schema?.description || data.schema.name}
	logo={data.orgLogoUrl ?? undefined}
	showModeToggle={true}
	solveTimeoutMs={data.solveTimeoutMs}
	footerComponent={ServerFooter}
	footerComponentProps={() => ({ label: data.serverLabel })}
>
	{#snippet headerRight()}
		{#if data.versionId}
			<span
				class="bg-warning/15 text-warning rounded-full px-2.5 py-1 font-mono text-[11px] font-medium tracking-wide uppercase"
			>
				v{data.versionNumber} preview
			</span>
		{:else if data.channel === 'draft'}
			<span
				class="bg-warning/15 text-warning rounded-full px-2.5 py-1 font-mono text-[11px] font-medium tracking-wide uppercase"
			>
				Draft preview
			</span>
		{/if}
		<UserChip />
	{/snippet}
</ComputeApp>
