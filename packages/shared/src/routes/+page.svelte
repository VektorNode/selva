<script lang="ts">
	import type { UISchema, SupportedTypes } from '$lib/types/generated';
	import AppLayout from '$lib/components/AppLayout.svelte';
	import { initializeValues } from '$lib/features/preview/handlers';
	import exampleSchema from '$lib/example-schema.json';
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import PageContainer from '$lib/components/layout/PageContainer.svelte';
	import ComputeMessages from '$lib/components/ComputeMessages.svelte';

	const schema = exampleSchema as UISchema;

	let values = $state<Record<string, unknown>>(initializeValues({ schema }));
	let isSolving = $state(false);
	let hasPendingChanges = $state(false);
	let isViewerFullscreen = $state(false);

	function handleValueChange(id: string, val: SupportedTypes) {
		values[id] = val;
		if (schema.instanceSolve === false) {
			hasPendingChanges = true;
		}
	}

	function handleCalculate() {
		isSolving = true;
		hasPendingChanges = false;
		setTimeout(() => (isSolving = false), 1500);
	}
</script>

<PageContainer>
	<PageHeader title={schema.title ?? 'Preview'} showModeToggle={true} />

	<div class="flex flex-1 flex-col overflow-hidden bg-background">
		<AppLayout
			{schema}
			meshes={[]}
			{isSolving}
			showSolvingIndicator={schema.instanceSolve !== false}
			{hasPendingChanges}
			bind:isViewerFullscreen
			bind:values
			onValueChange={handleValueChange}
			environment="compute"
			oncalculate={handleCalculate}
			onLoadValues={async () => {
				if (schema?.instanceSolve !== false) {
					console.log('Performing solve on load values...');
				} else {
					hasPendingChanges = true;
				}
			}}
		/>
	</div>

	<ComputeMessages errors={[]} warnings={[]} />
</PageContainer>
