<script lang="ts">
	import type { PageProps } from './$types';
	import type { RhinoModule } from 'rhino3dm';
	import { ComputeApp, type SolveFn } from '@selvajs/ui';
	import { GrasshopperResponseProcessor } from '@selvajs/compute';
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

		const res = await fetch('/api/compute', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				inputs: data.schema.inputs,
				values,
				definitionUrl: data.ghDefinition,
				// An explicit version pick takes precedence over the channel pointer.
				...(data.versionId
					? { versionId: data.versionId }
					: data.channel === 'draft' && { channel: 'draft' })
			}),
			signal
		});

		if (signal.aborted) return { outputs: {} };

		if (!res.ok) {
			if (res.status === 503) {
				throw new Error('Compute server is offline or unreachable. Please try again later.');
			}
			if (res.status === 429) {
				const d = await res.json().catch(() => ({}));
				const retryAfter = Number(res.headers.get('Retry-After')) || Number(d.retryAfter) || 5;
				cooldownUntil = Date.now() + retryAfter * 1000;
				throw new Error(d.message || `Rate limit reached. Try again in ${retryAfter}s.`);
			}
			const d = await res.json().catch(() => ({}));
			throw new Error(d.message || 'Compute error');
		}

		// Headers are in — everything up to here is time-to-first-byte (solve/server).
		const ttfbMs = performance.now() - solveStart;

		// Read the body to completion; this is the transmission time of the payload.
		const downloadStart = performance.now();
		const bodyText = await res.text();
		if (signal.aborted) return { outputs: {} };
		const downloadMs = performance.now() - downloadStart;
		const bytes = bodyText.length;

		// JSON decode of the payload string.
		const jsonStart = performance.now();
		const solved = JSON.parse(bodyText);
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
		const meshes = rhino ? await processor.extractMeshesFromResponse({ rhino }) : [];
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
		console.log(
			`[Compute/browser] total=${totalMs.toFixed(0)}ms | ` +
				`ttfb=${ttfbMs.toFixed(0)}ms (network≈${networkMs.toFixed(0)} + server ${serverTotal.toFixed(0)}) | ` +
				`download=${downloadMs.toFixed(0)}ms (${size} @ ${mbps} MB/s) | ` +
				`json=${jsonMs.toFixed(0)}ms | rhinoInit=${rhinoInitMs.toFixed(0)}ms | ` +
				`mesh=${meshMs.toFixed(0)}ms (${meshes.length}) | outputs=${outputMs.toFixed(0)}ms`
		);
		if (serverTiming.total !== undefined) {
			// Server-side sub-phases (from the response header). solve==0 means a cached
			// compute result — if `total` here is still large the cost is serialize or
			// definition load, not the solve.
			console.log(
				`[Compute/browser]   └─ server: load=${(serverTiming.load ?? 0).toFixed(0)}ms ` +
					`tree=${(serverTiming.tree ?? 0).toFixed(0)}ms solve=${(serverTiming.solve ?? 0).toFixed(0)}ms ` +
					`serialize=${(serverTiming.serialize ?? 0).toFixed(0)}ms`
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
