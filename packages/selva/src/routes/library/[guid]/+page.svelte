<script lang="ts">
	import type { PageProps } from './$types';
	import type { RhinoModule } from 'rhino3dm';
	import { ComputeApp } from '@selvajs/ui';
	import { createComputeFetchSolveFn } from '@selvajs/solve/client';
	import { getThreeMeshesFromComputeResponse } from '@selvajs/visualization/parse';
	import ServerFooter from '$lib/components/ServerFooter.svelte';
	import UserChip from '$lib/components/UserChip.svelte';

	// Pass rhino3dm.wasm via locateFile to avoid 404 on dynamic routes.
	import rhinoWasmUrl from 'rhino3dm/rhino3dm.wasm?url';

	let { data }: PageProps = $props();

	function shouldShowViewer(): boolean {
		return Boolean(
			data.schema.viewerOptions?.enableLocal || data.schema.viewerOptions?.enableRemote
		);
	}

	const onSolve = createComputeFetchSolveFn({
		endpoint: '/api/compute',
		definitionUrl: () => data.ghDefinition,
		inputs: () => data.schema.inputs,
		outputs: () => data.schema.outputs,
		// An explicit version pick takes precedence over the channel pointer.
		channel: () => (data.channel === 'draft' ? 'draft' : undefined),
		versionId: () => data.versionId,
		meshes: shouldShowViewer()
			? {
					loadRhino: () =>
						import('rhino3dm').then((m) => {
							const init = m.default as (opts?: {
								locateFile?: (path: string) => string;
							}) => Promise<RhinoModule>;
							return init({ locateFile: () => rhinoWasmUrl });
						}),
					extract: (response, opts) => getThreeMeshesFromComputeResponse(response, opts)
				}
			: undefined,
		// Preserves the always-on [Compute] console telemetry (timing, cache verdicts).
		debug: true
	});
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
