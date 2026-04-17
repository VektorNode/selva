<script lang="ts">
	import type { UISchema, SupportedTypes } from '$lib/types/generated';
	import AppLayout from '$lib/components/AppLayout.svelte';
	import { initializeValues } from '$lib/features/preview/handlers';
	import exampleSchema from '$lib/example-schema.json';
	import exampleSchemaLeftOnly from '$lib/example-schema-left-only.json';
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import PageContainer from '$lib/components/layout/PageContainer.svelte';
	import { cubeMesh, getParsedMeshes, dummyOutputValues } from '$lib/dummy-output-values';
	import { APP_DEFAULTS } from '$lib/constants';

	// Switch between left-only, right-only and full schema
	let schema = $state(exampleSchema as UISchema);
	const _schemaLeft = exampleSchemaLeftOnly as UISchema;
	const _schemaFull = exampleSchema as UISchema;

	// Meshes state - starts with fallback cube
	let meshes = $state([cubeMesh]);

	const dummyErrors = [
		'Error: Something went wrong with the calculation. Please check your input values and try again.',
		'Error: Unable to connect to the server. Please check your internet connection and try again.'
	];

	const dummyWarnings = [
		'Warning: The value for "Parameter X" is approaching the maximum limit. Consider adjusting it to avoid potential issues.',
		'Warning: The calculation may take longer than expected due to the complexity of the input values.'
	];

	// Load parsed meshes on mount
	$effect(() => {
		// This effect runs once on mount
		getParsedMeshes()
			.then((parsedMeshes: any[]) => {
				if (parsedMeshes && parsedMeshes.length > 0) {
					meshes = parsedMeshes;
				}
			})
			.catch((err) => {
				console.error('✗ Failed to parse meshes:', err);
			});
	});

	let values = $state<Record<string, unknown>>({
		...initializeValues({ schema }),
		...dummyOutputValues
	});
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
		setTimeout(() => (isSolving = false), APP_DEFAULTS.TIMEOUTS.SOLVE_STATE_DURATION);
	}
</script>

<PageContainer errors={dummyErrors} warnings={dummyWarnings}>
	<PageHeader
		title="Test"
		showModeToggle={true}
		logo="https://static.food4rhino.com/cdn/farfuture/-8kBLLz1EsmzigoTR71h78u38ce2X1pkplK7Xhz-nXg/mtime:1766995049/sites/default/files/public/styles/thumbnail/public/users-files/thevessen/app/asset2.png?itok=Om5jrCuE"
	/>

	<div class="flex flex-1 flex-col overflow-hidden bg-background">
		<AppLayout
			{schema}
			{meshes}
			{isSolving}
			showSolvingIndicator={schema.instanceSolve !== false}
			{hasPendingChanges}
			bind:isViewerFullscreen
			bind:values
			onValueChange={handleValueChange}
			oncalculate={handleCalculate}
			onLoadValues={async () => {
				if (schema?.instanceSolve !== false) {
					console.error('Performing solve on load values...');
				} else {
					hasPendingChanges = true;
				}
			}}
		/>
	</div>
</PageContainer>
