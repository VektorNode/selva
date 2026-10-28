<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { FileDown } from '@lucide/svelte';
	import type { UISchema, SupportedTypes } from '@selvajs/schemas';
	import AppLayout from '$lib/components/compute/AppLayout.svelte';
	import exampleSchema from '../demo/example-schema.json';
	import AppShell from '$lib/components/layout/AppShell.svelte';
	import { cubeMesh, getParsedMeshes, dummyOutputValues } from '../demo/dummy-output-values';
	import { APP_DEFAULTS } from '$lib/constants';
	import { createSolvingIndicator } from '$lib/compute/solving.svelte';
	import type { ActionButton } from '$lib/types/actionButton';
	import { setLocaleContext } from '$lib/i18n/localeContext.svelte';

	// `?lang=de` switches the chrome; `?preview` swaps the right-hand tabs for one holding only the
	// image output, which stays empty until Calculate, to show the pane closing while it waits.
	setLocaleContext(() => (page.url.searchParams.get('lang') === 'de' ? 'de' : 'en'));
	const previewOnly = page.url.searchParams.has('preview');
	const IMAGE_OUTPUT_ID = 'output-009';

	function withPreviewTab(base: UISchema): UISchema {
		if (base.layout.type !== 'tabbed') return base;
		const image = base.layout.tabs
			.flatMap((tab) => tab.groups.flatMap((group) => group.items))
			.find((item) => item.type === 'output' && item.paramId === IMAGE_OUTPUT_ID);
		if (!image) return base;
		const tabs = base.layout.tabs.filter((tab) => tab.position !== 'right');
		tabs.push({
			id: 'tab-preview',
			label: 'Preview',
			position: 'right',
			groups: [{ id: 'group-preview', label: 'Preview', items: [image] }]
		});
		return { ...base, layout: { ...base.layout, tabs } };
	}

	let schema = $state(
		previewOnly ? withPreviewTab(exampleSchema as UISchema) : (exampleSchema as UISchema)
	);

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
		...dummyOutputValues,
		...(previewOnly ? { [IMAGE_OUTPUT_ID]: null } : {})
	});
	let isSolving = $state(false);
	const solvingIndicator = createSolvingIndicator(() => isSolving);
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
		setTimeout(() => {
			isSolving = false;
			values[IMAGE_OUTPUT_ID] = dummyOutputValues[IMAGE_OUTPUT_ID];
		}, APP_DEFAULTS.TIMEOUTS.SOLVE_STATE_DURATION);
	}

	// A host action: it lands in the footer's ⋯ menu, after saving and loading inputs.
	const panelActions: ActionButton[] = [
		{ id: 'export', label: 'Export drawings…', icon: FileDown, onclick: () => {} }
	];
</script>

<svelte:head>
	<title>@selvajs/ui demo</title>
</svelte:head>

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
			showViewer={!!schema.viewerOptions?.enableRemote}
			{meshes}
			{isSolving}
			showSolvingIndicator={solvingIndicator.show}
			solveIsSlow={solvingIndicator.slow}
			{hasPendingChanges}
			{panelActions}
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
