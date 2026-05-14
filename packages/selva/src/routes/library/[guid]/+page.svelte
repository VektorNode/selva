<script lang="ts">
	import type { PageProps } from './$types';
	import { ComputeApp, type SolveFn } from '@selvajs/ui';
	import { GrasshopperResponseProcessor } from '@selvajs/compute';
	import ServerFooter from '$lib/components/ServerFooter.svelte';
	import UserChip from '$lib/components/UserChip.svelte';

	let { data }: PageProps = $props();

	// Soft cooldown after a 429: until this timestamp elapses, short-circuit
	// new solves so dragging a slider during the rate-limit window doesn't
	// generate a flood of doomed requests. The user-visible error message
	// stays until the next successful solve replaces it.
	let cooldownUntil = 0;

	const onSolve: SolveFn = async (values, signal) => {
		const remainingMs = cooldownUntil - Date.now();
		if (remainingMs > 0) {
			throw new Error(`Rate limit reached. Try again in ${Math.ceil(remainingMs / 1000)}s.`);
		}

		const res = await fetch('/api/compute', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				inputs: data.schema.inputs,
				values,
				definitionUrl: data.ghDefinition,
				...(data.channel === 'draft' && { channel: 'draft' })
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

		const processor = new GrasshopperResponseProcessor(solved, false);

		const shouldShowViewer =
			data.schema.viewerOptions?.enableLocal || data.schema.viewerOptions?.enableRemote;

		const meshes = shouldShowViewer ? await processor.extractMeshesFromResponse() : [];

		const outputs: Record<string, unknown> = {};
		for (const o of data.schema.outputs) {
			outputs[o.id] = processor.getValueByParamId(o.id, { parseValues: true });
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
	showModeToggle={true}
	solveTimeoutMs={data.solveTimeoutMs}
	footerComponent={ServerFooter}
	footerComponentProps={() => ({ label: data.serverLabel })}
>
	{#snippet headerRight()}
		{#if data.channel === 'draft'}
			<span
				class="bg-warning/15 text-warning rounded-full px-2.5 py-1 font-mono text-[11px] font-medium tracking-wide uppercase"
			>
				Draft preview
			</span>
		{/if}
		<UserChip />
	{/snippet}
</ComputeApp>
