<script lang="ts">
	import { onMount } from 'svelte';
	import type { UISchema, SupportedTypes } from '@selvajs/schemas';
	import AppLayout from '$lib/components/compute/AppLayout.svelte';
	import exampleSchema from '../demo/example-schema.json';
	import AppShell from '$lib/components/layout/AppShell.svelte';
	import { cubeMesh, getParsedMeshes, dummyOutputValues } from '../demo/dummy-output-values';
	import { APP_DEFAULTS } from '$lib/constants';

	let schema = $state(exampleSchema as UISchema);

	// The cube stands in until the async parse of the example batch resolves.
	let meshes = $state([cubeMesh]);

	const dummyErrors = [
		'Error: Something went wrong with the calculation. Please check your input values and try again.',
		'Error: Unable to connect to the server. Please check your internet connection and try again.'
	];

	const dummyWarnings = [
		'Warning: The value for "Parameter X" is approaching the maximum limit. Consider adjusting it to avoid potential issues.',
		'Warning: The calculation may take longer than expected due to the complexity of the input values.'
	];

	onMount(() => {
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

	const initialValues = Object.fromEntries([
		...exampleSchema.inputs.map((i) => [i.id, null]),
		...exampleSchema.outputs.map((o) => [o.id, null])
	]);
	let values = $state<Record<string, unknown>>({
		...initialValues,
		...dummyOutputValues
	});
	let isSolving = $state(false);
	let hasPendingChanges = $state(false);
	let isViewerFullscreen = $state(false);

	function handleValueChange(id: string, val: SupportedTypes, forceSolve = false) {
		values[id] = val;
		if (schema.instanceSolve === false && !forceSolve) {
			hasPendingChanges = true;
		}
	}

	function handleCalculate() {
		isSolving = true;
		hasPendingChanges = false;
		setTimeout(() => (isSolving = false), APP_DEFAULTS.TIMEOUTS.SOLVE_STATE_DURATION);
	}
</script>

<AppShell
	mode="fixed"
	showFooter
	title="Test"
	showModeToggle
	logo="https://static.food4rhino.com/cdn/farfuture/-8kBLLz1EsmzigoTR71h78u38ce2X1pkplK7Xhz-nXg/mtime:1766995049/sites/default/files/public/styles/thumbnail/public/users-files/thevessen/app/asset2.png?itok=Om5jrCuE"
	errors={dummyErrors}
	warnings={dummyWarnings}
>
	<div class="flex flex-1 flex-col overflow-hidden bg-background">
		<AppLayout
			{schema}
			{meshes}
			{isSolving}
			showSolvingIndicator={schema.instanceSolve !== false}
			{hasPendingChanges}
			bind:isViewerFullscreen
			{values}
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
</AppShell>
