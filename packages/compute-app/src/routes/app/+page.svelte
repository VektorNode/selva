<script lang="ts">
	import type { PageProps } from './$types';
	import { ComputeApp, type SolveFn } from 'selva-shared';
	import { GrasshopperResponseProcessor } from 'selva-compute';
	import ServerFooter from '$lib/components/ServerFooter.svelte';

	let { data }: PageProps = $props();

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
			if (res.status === 503) {
				throw new Error('Compute server is offline or unreachable. Please try again later.');
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
	footerComponent={ServerFooter}
	footerComponentProps={() => ({ label: data.serverLabel })}
/>
