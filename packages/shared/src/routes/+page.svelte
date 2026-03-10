<script lang="ts">
	import type { UISchema, SupportedTypes } from '$lib/types/generated';
	import AppLayout from '$lib/components/AppLayout.svelte';
	import { initializeValues } from '$lib/features/preview/handlers';
	import exampleSchema from '$lib/example-schema.json';
	import exampleSchemaLeftOnly from '$lib/example-schema-left-only.json';
	import exampleSchemaRightOnly from '$lib/example-schema-right-only.json';
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import PageContainer from '$lib/components/layout/PageContainer.svelte';
	import * as THREE from 'three';

	let schema = exampleSchema as UISchema;
	const schemaLeft = exampleSchemaLeftOnly as UISchema;
	const schemaRight = exampleSchemaRightOnly as UISchema;

	const dummyErrors = [
		'Error: Something went wrong with the calculation. Please check your input values and try again.',
		'Error: Unable to connect to the server. Please check your internet connection and try again.'
	];

	const dummyWarnings = [
		'Warning: The value for "Parameter X" is approaching the maximum limit. Consider adjusting it to avoid potential issues.',
		'Warning: The calculation may take longer than expected due to the complexity of the input values.'
	];

	const cubeMesh = new THREE.Mesh(
		new THREE.BoxGeometry(1, 1, 1, 4, 4, 4),
		new THREE.MeshStandardMaterial({
			color: 0x4a90d9,
			metalness: 0.3,
			roughness: 0.4
		})
	);

	const dummyOutputValues: Record<string, unknown> = {
		'output-001': 'Computation completed successfully. All 12 parameters are within bounds.',
		'output-002': 4827.63,
		'output-003': [
			{
				fileName: 'result_geometry_SZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ',
				fileType: '.obj',
				data: btoa('# Wavefront OBJ\nv 0.0 0.0 0.0\nv 1.0 0.0 0.0\nv 0.0 1.0 0.0\nf 1 2 3'),
				isBase64Encoded: true
			}
		],
		'output-004':
			'[INFO]  Step 1: Parameter validation ............. OK\n[INFO]  Step 2: Mesh generation .................. OK\n[INFO]  Step 3: Geometry export .................. OK\n[WARN]  High vertex count detected (12 480 faces).',
		'output-005': 892,
		'output-006': [
			{
				fileName: 'panel_A',
				fileType: '.3dm',
				subFolder: 'panels',
				data: btoa('3dm-binary-content-panel-A'),
				isBase64Encoded: true
			},
			{
				fileName: 'panel_B',
				fileType: '.3dm',
				subFolder: 'panels',
				data: btoa('3dm-binary-content-panel-B'),
				isBase64Encoded: true
			},
			{
				fileName: 'main_frame',
				fileType: '.3dm',
				subFolder: 'structure',
				data: btoa('3dm-binary-content-frame'),
				isBase64Encoded: true
			},
			{
				fileName: 'metadata',
				fileType: '.json',
				data: btoa(JSON.stringify({ version: '1.0', panelCount: 2, generatedAt: '2026-03-10' })),
				isBase64Encoded: true
			}
		]
	};

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
		setTimeout(() => (isSolving = false), 3500);
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
			meshes={[cubeMesh]}
			{isSolving}
			showSolvingIndicator={schema.instanceSolve !== false}
			{hasPendingChanges}
			bind:isViewerFullscreen
			bind:values
			onValueChange={handleValueChange}
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
</PageContainer>
