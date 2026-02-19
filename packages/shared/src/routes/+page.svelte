<script lang="ts">
	import type { UISchema, SupportedTypes } from '$lib/types/generated';
	import AppLayout from '$lib/components/AppLayout.svelte';
	import { initializeValues } from '$lib/features/preview/handlers';
	import exampleSchema from '$lib/example-schema.json';

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

<div class="flex h-screen flex-col overflow-hidden">
	<div class="border-b px-4 py-1.5 flex items-center justify-between shrink-0">
		<h1 class="text-sm font-semibold">{schema.name}</h1>
		<span class="text-xs text-muted-foreground">Preview</span>
	</div>
	<AppLayout
		{schema}
		meshes={[]}
		{isSolving}
		showSolvingIndicator={schema.instanceSolve !== false && isSolving}
		{hasPendingChanges}
		bind:isViewerFullscreen
		bind:values
		onValueChange={handleValueChange}
		oncalculate={handleCalculate}
		environment="local"
	/>
</div>
