<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { getWebSocketState } from '$lib/websocket/websocket.svelte';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import type { UISchema, DiscoveredParameters, SupportedTypes } from 'selva-shared';
	import {
		PageContainer,
		PageHeader,
		StateDisplay,
		Button,
		AppLayout,
		initializeValues,
		processOutputUpdate,
		updateParameterMetadata,
		removeParametersFromValues,
		formatParameterUpdateMessage,
		formatMetadataUpdateMessage,
		createSolvingIndicator,
		useFooterItem
	} from 'selva-shared';
	import {
		initializeWebSocketSession,
		getWebSocketPortFromUrl,
		ensureSchemaLayoutDefaults
	} from '$lib/utils/session';
	import WsStatusFooter from '$lib/components/WsStatusFooter.svelte';
	import { parseMeshBatchObject, SCALE_FACTORS } from 'selva-compute/visualization';
	import type { MeshBatch } from 'selva-compute/visualization';
	import type * as THREE from 'three';

	const sessionId = $derived(page.url.searchParams.get('session') || '');
	let schema = $state<UISchema | null>(null);
	let values = $state<Record<string, unknown>>({});
	let loading = $state(true);
	let error = $state('');

	// Get WebSocket port from URL to ensure we connect to the correct instance
	const wsPort = getWebSocketPortFromUrl();
	const wsState = getWebSocketState(wsPort);

	let schemaUpdateNotification = $state('');
	let notificationTimer: ReturnType<typeof setTimeout> | null = null;
	let solveTimeout: ReturnType<typeof setTimeout> | null = null;

	let syncNeeded = $state(false);

	let displayMeshes = $state<THREE.Mesh[]>([]);

	let modelUnits = $state<string>('Meters');

	let isRemoteUpdate = $state(false);
	let hasPendingChanges = $state(false);
	let isViewerFullscreen = $state(false);
	let initialSolveTriggered = false;

	// UI state for debouncing the "Solving..." indicator
	const solvingIndicator = createSolvingIndicator(() => wsState.isSolving);

	function showNotification(message: string, duration: number = 3000) {
		schemaUpdateNotification = message;
		if (notificationTimer) {
			clearTimeout(notificationTimer);
		}
		notificationTimer = setTimeout(() => {
			schemaUpdateNotification = '';
			notificationTimer = null;
		}, duration);
	}

	/**
	 * Strip file metadata from values before sending to Grasshopper
	 * Only sends back metadata-only file objects (not full file data)
	 */
	function prepareValuesForSend(values: Record<string, unknown>): Record<string, unknown> {
		const prepared: Record<string, unknown> = {};

		for (const [key, value] of Object.entries(values)) {
			// Try to parse if it's a JSON string
			let parsedValue = value;
			if (typeof value === 'string' && value.trim().startsWith('{')) {
				try {
					parsedValue = JSON.parse(value);
				} catch {
					// Not JSON, keep as string
				}
			}

			// Check if this is a file metadata object from backend
			if (
				parsedValue &&
				typeof parsedValue === 'object' &&
				'_isMetadata' in parsedValue &&
				(parsedValue as any)._isMetadata === true
			) {
				// Skip sending metadata back - Grasshopper already has the file
				continue;
			}

			// Send all other values normally
			prepared[key] = value;
		}

		return prepared;
	}

	async function handleValueChange(paramId: string, value: SupportedTypes) {
		if (isRemoteUpdate) {
			return;
		}

		values[paramId] = value;

		if (schema?.instanceSolve === false) {
			hasPendingChanges = true;
			return;
		}

		if (wsState.connected) {
			const preparedValues = prepareValuesForSend($state.snapshot(values));
			wsState.sendValueUpdate(sessionId, preparedValues);
		} else {
			console.warn('[Preview] Cannot send values - WebSocket not connected');
		}
	}

	function handleCalculate() {
		if (!hasPendingChanges) {
			return;
		}
		if (wsState.connected) {
			const preparedValues = prepareValuesForSend($state.snapshot(values));
			wsState.sendValueUpdate(sessionId, preparedValues);
			hasPendingChanges = false;
		} else {
			console.warn('[Preview] Cannot calculate - WebSocket not connected');
		}
	}

	function navigateTo(route: '/' | '/builder') {
		const params = new SvelteURLSearchParams();
		if (sessionId) params.set('session', sessionId);
		const wsPort = page.url.searchParams.get('wsPort');
		if (wsPort) params.set('wsPort', wsPort);

		const url = `${route}?${params.toString()}`;
		goto(url).catch(() => {});
	}

	function syncParameters() {
		syncNeeded = false;
		initialSolveTriggered = false; // Reset to allow solve after sync
		wsState.requestInitialData(sessionId);
		showNotification('Syncing parameters...');
	}

	useFooterItem(
		'ws-status',
		WsStatusFooter,
		() => ({
			connected: wsState.connected,
			sessionId
		}),
		'left',
		10
	);

	async function handleOutputs(message: any) {
		if (message.sessionId === sessionId) {
			if (message.modelUnits) {
				modelUnits = message.modelUnits;
			}

			if (message.displayData) {
				try {
					const dataArray = Array.isArray(message.displayData)
						? message.displayData
						: [message.displayData];

					const scaleFactor = SCALE_FACTORS[modelUnits as keyof typeof SCALE_FACTORS] ?? 1;
					const allMeshes: THREE.Mesh[] = [];

					for (const batchData of dataArray as MeshBatch[]) {
						const meshes = await parseMeshBatchObject(batchData, {
							mergeByMaterial: false,
							applyTransforms: true,
							scaleFactor: scaleFactor,
							debug: false
						});
						allMeshes.push(...meshes);
					}

					displayMeshes = allMeshes;
				} catch (err) {
					console.error('[Preview] Error parsing display data:', err);
				}
			}

			const allUpdates = processOutputUpdate({
				outputs: message.outputs,
				fileOutputs: message.fileOutputs,
				schema
			});

			if (Object.keys(allUpdates).length > 0) {
				try {
					isRemoteUpdate = true;
					Object.assign(values, allUpdates);
				} finally {
					isRemoteUpdate = false;
				}
			}
		}
	}

	function handleInitialData(message: any) {
		if (message.sessionId === sessionId) {
			const receivedSchema = message.schema;
			const availableParams = message.availableParams as DiscoveredParameters;

			if (!receivedSchema) {
				error = 'No schema configured. Please use the Schema Builder to create a UI.';
				loading = false;
				return;
			}

			const processedSchema = ensureSchemaLayoutDefaults(receivedSchema);
			if (!processedSchema) {
				error = 'Failed to process schema.';
				loading = false;
				return;
			}

			const newValues = initializeValues({
				schema: processedSchema,
				availableParams,
				currentValues: message.currentValues
			});

			// console.log('[Preview] Initialized values:', newValues);

			try {
				isRemoteUpdate = true;
				values = newValues;
			} finally {
				isRemoteUpdate = false;
			}

			schema = processedSchema;
			loading = false;

			// Check for initial outputs/display data with proper empty checks
			const hasOutputs = message.outputs && Object.keys(message.outputs).length > 0;
			const hasDisplayData =
				message.displayData &&
				(Array.isArray(message.displayData) ? message.displayData.length > 0 : true);
			const hasInitialOutputs = hasOutputs || hasDisplayData;

			if (hasInitialOutputs) {
				handleOutputs(message);
			}

			// Check if a solution is already running (from backend state)
			const isSolvingOnConnect = message.isSolving === true;

			// Only trigger initial solution if no outputs exist AND no solution is running
			if (!hasInitialOutputs && !isSolvingOnConnect) {
				solveTimeout = setTimeout(() => {
					if (wsState.connected && !initialSolveTriggered) {
						initialSolveTriggered = true;
						const preparedValues = prepareValuesForSend($state.snapshot(newValues));
						wsState.send('valueUpdate', { sessionId, values: preparedValues });
					}
				}, 500);
			} else if (isSolvingOnConnect) {
				// Solve already running - mark to prevent duplicate triggers
				initialSolveTriggered = true;
			}
		}
	}

	function handleCurrentValues(message: any) {
		if (message.sessionId === sessionId) {
			try {
				isRemoteUpdate = true;
				Object.assign(values, message.values);
			} finally {
				isRemoteUpdate = false;
			}
		}
	}

	function handleOutputUpdate(message: any) {
		if (message.sessionId === sessionId) {
			const allUpdates = processOutputUpdate({
				outputs: message.outputs,
				schema
			});

			if (Object.keys(allUpdates).length > 0) {
				try {
					isRemoteUpdate = true;
					Object.assign(values, allUpdates);
				} finally {
					isRemoteUpdate = false;
				}
			}
		}
	}

	function handleSchemaUpdated(message: any) {
		if (message.sessionId === sessionId) {
			const removedCount = message.removedIds?.length || 0;
			// No need to clone - message.schema is already a new object
			const newSchema = ensureSchemaLayoutDefaults(message.schema);

			if (message.removedIds && message.removedIds.length > 0) {
				values = removeParametersFromValues(values, message.removedIds);
			}

			// Update schema directly, {#key schema} in template will handle re-render
			schema = newSchema;

			if (removedCount > 0) {
				const msg = formatParameterUpdateMessage(removedCount);
				showNotification(msg);
			}
		}
	}

	function handleMetadataUpdated(message: any) {
		if (message.sessionId === sessionId && schema) {
			const changedParams = message.changedParams || [];
			if (changedParams.length === 0) return;

			const result = updateParameterMetadata(schema, changedParams);

			if (result.updated > 0) {
				const msg = formatMetadataUpdateMessage(result.names);
				showNotification(msg);
			}
		}
	}

	function handleParametersAdded(message: any) {
		if (message.sessionId === sessionId) {
			syncNeeded = true;
			showNotification('New parameters detected - click Sync to add them to your UI');
		}
	}

	async function initializeSchema(currentSessionId: string) {
		if (!currentSessionId) return;

		const result = await initializeWebSocketSession(currentSessionId);

		if (result.error) {
			error = result.error;
			loading = false;
			return;
		}

		wsState.requestInitialData(currentSessionId);
	}

	$effect(() => {
		if (sessionId) {
			initialSolveTriggered = false;
			// Register handlers
			wsState.on('initialData', handleInitialData);
			wsState.on('currentValues', handleCurrentValues);
			wsState.on('outputs', handleOutputs);
			wsState.on('outputUpdate', handleOutputUpdate);
			wsState.on('schemaUpdated', handleSchemaUpdated);
			wsState.on('metadataUpdated', handleMetadataUpdated);
			wsState.on('parametersAdded', handleParametersAdded);

			initializeSchema(sessionId);

			return () => {
				// Cleanup timeouts
				if (solveTimeout) {
					clearTimeout(solveTimeout);
					solveTimeout = null;
				}
				if (notificationTimer) {
					clearTimeout(notificationTimer);
					notificationTimer = null;
				}

				// Cleanup event handlers
				wsState.off('initialData', handleInitialData);
				wsState.off('currentValues', handleCurrentValues);
				wsState.off('outputs', handleOutputs);
				wsState.off('outputUpdate', handleOutputUpdate);
				wsState.off('schemaUpdated', handleSchemaUpdated);
				wsState.off('metadataUpdated', handleMetadataUpdated);
				wsState.off('parametersAdded', handleParametersAdded);
			};
		}
	});
</script>

<PageContainer background="white">
	<PageHeader title={schema?.name || 'Interactive Preview'} showModeToggle={true}>
		<nav class="flex items-center gap-2">
			{#if syncNeeded}
				<Button
					variant="default"
					size="sm"
					onclick={syncParameters}
					class="animate-pulse bg-amber-500 hover:bg-amber-600"
				>
					⚡ Sync Parameters
				</Button>
			{/if}
			<Button variant="outline" size="sm" onclick={() => navigateTo('/')}>Home</Button>
			<Button variant="outline" size="sm" onclick={() => navigateTo('/builder')}>
				Schema Builder
			</Button>
			<Button variant="default" size="sm">Interactive Preview</Button>
		</nav>
	</PageHeader>

	<div class="relative flex flex-1 flex-col overflow-hidden">
		{#if loading}
			<div class="flex min-h-100 items-center justify-center">
				<StateDisplay type="loading" size="large" message="Loading preview..." />
			</div>
		{:else if error}
			<div class="flex min-h-100 items-center justify-center">
				<StateDisplay type="error" size="large" message={error} />
			</div>
		{:else if schema}
			{#key schema}
				<AppLayout
					{schema}
					meshes={displayMeshes}
					isSolving={wsState.isSolving}
					showSolvingIndicator={schema.instanceSolve !== false && solvingIndicator.show}
					{hasPendingChanges}
					bind:isViewerFullscreen
					bind:values
					onValueChange={handleValueChange}
					oncalculate={handleCalculate}
					onLoadValues={() => {
						if (schema?.instanceSolve !== false) {
							wsState.sendValueUpdate(sessionId, $state.snapshot(values));
						} else {
							hasPendingChanges = true;
						}
					}}
				/>
			{/key}
		{/if}
	</div>

	{#if schemaUpdateNotification}
		<div
			class="bg-info text-info-foreground fixed right-8 bottom-8 z-50 flex animate-[slideInRight_0.3s_ease-out] items-center gap-3 rounded-lg px-6 py-4 shadow-lg"
		>
			<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
				/>
			</svg>
			<span class="font-medium">{schemaUpdateNotification}</span>
		</div>
	{/if}
</PageContainer>

<style>
	@keyframes slideInRight {
		from {
			transform: translateX(100%);
			opacity: 0;
		}
		to {
			transform: translateX(0);
			opacity: 1;
		}
	}
</style>
