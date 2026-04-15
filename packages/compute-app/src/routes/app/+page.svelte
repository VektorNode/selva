<script lang="ts">
	import type { PageProps } from './$types';
	import { ComputeApp, type SolveFn } from 'selva-shared';
	import { GrasshopperResponseProcessor } from 'selva-compute';
	import { useComputeHealth } from '$lib/composables/useComputeHealth.svelte';
	import ComputeHealthFooter from '$lib/components/ComputeHealthFooter.svelte';

	let { data }: PageProps = $props();

	const computeHealth = useComputeHealth();

	const onSolve: SolveFn = async (values, signal) => {
		const res = await fetch('/api/compute', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				inputs: data.schema.inputs,
				values,
				definitionUrl: data.ghDefinition
			}),
			signal
		});

		if (signal.aborted) return { outputs: {} };

		if (!res.ok) {
			if (res.status === 503) computeHealth.notifyFailure();
			const d = await res.json();
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
	footerComponent={ComputeHealthFooter}
	footerComponentProps={() => ({ health: computeHealth.health, compute: computeHealth.compute })}
	showModeToggle={true}
	showLoadButton={false}
	showSaveButton={false}
	stateManagerActions={[
		{
			id: 'reset',
			label: 'Reset',
			onclick: () => {
				console.warn('Resetting app state');
			}
		}
	]}
/>
