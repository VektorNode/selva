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

	const onSolve: SolveFn = async (values, signal) => {
		const remainingMs = cooldownUntil - Date.now();
		if (remainingMs > 0) {
			throw new Error(`Rate limit reached. Try again in ${Math.ceil(remainingMs / 1000)}s.`);
		}

		// Browser-side timing. Concise, always on — the server's SELVA_FLAG_COMPUTE_DEBUG
		// covers the server/Rhino segments but can't reach the browser. `fetch` here is
		// the full round-trip (server processing + Rhino solve + network); `parse` is the
		// client-side response decode + mesh extraction. Their difference vs. the server's
		// [Compute/selva-cache] "(Nms)" line is the request's own overhead + network time.
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

		const solved = await res.json();
		if (signal.aborted) return { outputs: {} };
		const fetchMs = performance.now() - solveStart;

		const parseStart = performance.now();
		const processor = new GrasshopperResponseProcessor(solved, false);

		const shouldShowViewer =
			data.schema.viewerOptions?.enableLocal || data.schema.viewerOptions?.enableRemote;

		const meshes = shouldShowViewer
			? await processor.extractMeshesFromResponse({ rhino: await getRhino() })
			: [];

		// Fall back to name if id missing (VektorNode fork only); stock Compute omits id.
		const outputs: Record<string, unknown> = {};
		for (const o of data.schema.outputs) {
			const byId = processor.getValue({ byId: o.id }, { parseValues: true });
			const name = (o as { nickname?: string }).nickname;
			outputs[o.id] =
				byId ?? (name ? processor.getValue({ byName: name }, { parseValues: true }) : undefined);
		}

		const parseMs = performance.now() - parseStart;
		console.log(
			`[Compute/browser] round-trip=${fetchMs.toFixed(0)}ms (server+rhino+network) | ` +
				`parse=${parseMs.toFixed(0)}ms (${meshes.length} mesh${meshes.length === 1 ? '' : 'es'}) | ` +
				`total=${(fetchMs + parseMs).toFixed(0)}ms`
		);

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
