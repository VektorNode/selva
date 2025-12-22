<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { getWebSocketState } from '$lib/websocket/websocket.svelte';
	import type { UISchema, DiscoveredParameters, SupportedTypes } from '@selva/shared';
	import {
		TabLayout,
		PageContainer,
		PageHeader,
		StateDisplay,
		Button,
		StateManager,
		ensureSchemaLayoutDefaults,
		initializeValues,
		processOutputUpdate,
		updateParameterMetadata,
		removeParametersFromValues,
		ensureRhinoComputeLoaded as loadRhinoCompute,
		initializeViewerScene,
		updateViewerScene,
		processMeshBatches,
		formatParameterUpdateMessage,
		formatMetadataUpdateMessage,
		type ViewerState
	} from '@selva/shared';
	import { Maximize, Minimize } from '@lucide/svelte';
	import { initializeWebSocketSession, getWebSocketPortFromUrl } from '$lib/utils/session';
	import { type MeshBatch } from '@selva/core/visualization';

	const sessionId = $derived(page.url.searchParams.get('session') || '');
	let schema = $state<UISchema | null>(null);
	let values = $state<Record<string, unknown>>({});
	let loading = $state(true);
	let error = $state('');
	let canvas: HTMLCanvasElement | null = $state(null);

	// Get WebSocket port from URL to ensure we connect to the correct instance
	const wsPort = getWebSocketPortFromUrl();
	const wsState = getWebSocketState(wsPort);

	let schemaUpdateNotification = $state('');
	let notificationTimer: ReturnType<typeof setTimeout> | null = null;

	let syncNeeded = $state(false);

	let displayMeshes = $state<any[]>([]);

	// Non-reactive viewer state to avoid proxying Three.js objects
	let viewerContext: ViewerState = {
		scene: null,
		camera: null,
		controls: null,
		initialized: false
	};
	let viewerInitialized = $state(false);

	let modelUnits = $state<string>('Meters');
	let shouldShowViewer = $state(false);

	let rhinoCompute: any = null;

	let isRemoteUpdate = $state(false);
	let hasPendingChanges = $state(false);
	let isViewerFullscreen = $state(false);
	let initialSolveTriggered = false;

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

	async function ensureViewerModuleLoaded() {
		if (!rhinoCompute) {
			rhinoCompute = await loadRhinoCompute();
		}
	}

	async function initializeViewer() {
		if (!canvas || viewerContext.scene) return;

		await ensureViewerModuleLoaded();

		console.log('[Preview] Initializing viewer scene...');

		const newState = await initializeViewerScene(canvas, rhinoCompute!, schema!);
		Object.assign(viewerContext, newState);
		viewerContext.initialized = false;

		if (displayMeshes.length > 0) {
			await updateViewerScene(rhinoCompute!, viewerContext, displayMeshes);
			viewerContext.initialized = true;
			viewerInitialized = true;
		}
	}

	async function updateViewer() {
		if (!viewerContext.scene || displayMeshes.length === 0) return;

		await ensureViewerModuleLoaded();
		await updateViewerScene(rhinoCompute!, viewerContext, displayMeshes);
	}

	// Manage viewer lifecycle - initialize on first mesh, update on subsequent changes
	$effect(() => {
		if (shouldShowViewer && canvas && displayMeshes.length > 0) {
			if (!viewerContext.scene) {
				initializeViewer();
			} else {
				updateViewer();
			}
		}
	});

	/**
	 * Strip file metadata from values before sending to Grasshopper
	 * Only sends back metadata-only file objects (not full file data)
	 */
	function prepareValuesForSend(values: Record<string, unknown>): Record<string, unknown> {
		const prepared: Record<string, unknown> = {};

		for (const [key, value] of Object.entries(values)) {
			// Debug: log the value type and structure
			const valueType = typeof value;
			let isMetadata = false;

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
				isMetadata = true;
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
		const params = new URLSearchParams();
		if (sessionId) params.set('session', sessionId);
		const wsPort = page.url.searchParams.get('wsPort');
		if (wsPort) params.set('wsPort', wsPort);

		const url = `${route}?${params.toString()}`;
		goto(url);
	}

	function syncParameters() {
		syncNeeded = false;
		wsState.requestInitialData(sessionId);
		showNotification('Syncing parameters...');
	}

	function toggleFullscreen() {
		isViewerFullscreen = !isViewerFullscreen;

		// Notify Three.js of size change after DOM updates
		if (viewerContext.scene && canvas) {
			requestAnimationFrame(() => {
				const width = canvas!.clientWidth;
				const height = canvas!.clientHeight;

				// Update camera aspect ratio if it has the property
				if (
					viewerContext.camera &&
					typeof viewerContext.camera === 'object' &&
					'aspect' in viewerContext.camera
				) {
					(viewerContext.camera as any).aspect = width / height;
					if ('updateProjectionMatrix' in viewerContext.camera) {
						(viewerContext.camera as any).updateProjectionMatrix();
					}
				}

				// Update controls if they have an update method
				if (
					viewerContext.controls &&
					typeof viewerContext.controls === 'object' &&
					'update' in viewerContext.controls
				) {
					(viewerContext.controls as any).update();
				}
			});
		}
	}

	const badgeConfig = $derived(
		wsState.connected
			? { label: 'Connected', variant: 'connected' as const }
			: {
					label: 'Disconnected',
					variant: 'disconnected' as const
				}
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

					const allMeshes = await processMeshBatches(dataArray as MeshBatch[], modelUnits);
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
				isRemoteUpdate = true;
				values = { ...values, ...allUpdates };
				isRemoteUpdate = false;
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

			isRemoteUpdate = true;
			values = newValues;
			isRemoteUpdate = false;

			schema = processedSchema;
			loading = false;

			// Show viewer immediately in local mode if allowed
			if (processedSchema.viewerOptions?.enableLocal) {
				shouldShowViewer = true;
			}

			// Check for initial outputs/display data
			if (message.outputs || message.displayData) {
				console.log('[Preview] Initial data contains outputs, processing...');
				handleOutputs(message);
			}

			// Trigger initial solution with current values
			// Use a small timeout to ensure state is settled and backend is ready
			setTimeout(() => {
				if (wsState.connected && !initialSolveTriggered) {
					console.log('[Preview] Triggering initial solution...');
					initialSolveTriggered = true;
					// Bypass isSolving check to force initial solve
					const preparedValues = prepareValuesForSend($state.snapshot(newValues));
					wsState.send('valueUpdate', { sessionId, values: preparedValues });
				}
			}, 500);
		}
	}

	function handleCurrentValues(message: any) {
		if (message.sessionId === sessionId) {
			isRemoteUpdate = true;
			values = { ...values, ...message.values };
			isRemoteUpdate = false;
		}
	}

	function handleOutputUpdate(message: any) {
		if (message.sessionId === sessionId) {
			const allUpdates = processOutputUpdate({
				outputs: message.outputs,
				schema
			});

			if (Object.keys(allUpdates).length > 0) {
				isRemoteUpdate = true;
				values = { ...values, ...allUpdates };
				isRemoteUpdate = false;
			}
		}
	}

	function handleSchemaUpdated(message: any) {
		if (message.sessionId === sessionId) {
			const removedCount = message.removedIds?.length || 0;
			const newSchema = ensureSchemaLayoutDefaults(JSON.parse(JSON.stringify(message.schema)));

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
	<PageHeader
		title={schema?.name || 'Interactive Preview'}
		badge={badgeConfig}
		showModeToggle={true}
		{sessionId}
	>
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
				<div
					class="flex min-h-0 flex-1 flex-col gap-6 overflow-hidden p-6 lg:flex-row {isViewerFullscreen
						? 'fullscreen-container'
						: ''}"
				>
					<!-- Controls -->
					<div
						class="min-h-0 w-full overflow-y-auto {shouldShowViewer
							? 'lg:w-120 xl:w-130'
							: 'mx-auto max-w-6xl'} {isViewerFullscreen ? 'hidden' : ''}"
					>
						{#if schema.layout.type === 'tabbed' && schema.layout.tabs && schema.layout.tabs.length > 0}
							<TabLayout
								{schema}
								bind:values
								onValueChange={handleValueChange}
								debounceSliders={true}
								environment="local"
							/>
						{/if}

						<!-- State Manager -->
						<div class="mt-6">
							<StateManager
								{schema}
								currentValues={values}
								onLoadValues={(loadedValues) => {
									// Apply loaded values
									values = { ...values, ...loadedValues };

									// Send to Grasshopper
									if (schema?.instanceSolve !== false) {
										wsState.sendValueUpdate(sessionId, $state.snapshot(values));
									} else {
										hasPendingChanges = true;
									}
								}}
							/>
						</div>

						{#if schema.instanceSolve === false}
							<div class="sticky bottom-0 mt-6 flex justify-center">
								<Button
									variant={hasPendingChanges ? 'default' : 'outline'}
									size="lg"
									onclick={handleCalculate}
									disabled={!hasPendingChanges || wsState.isSolving}
									class="shadow-lg"
								>
									{#if wsState.isSolving}
										<div
											class="mr-2 h-4 w-4 animate-spin rounded-full border-2 {hasPendingChanges
												? 'border-primary-foreground'
												: 'border-foreground'} border-t-transparent"
										></div>
										Solving...
									{:else if hasPendingChanges}
										Calculate
									{:else}
										No Changes
									{/if}
								</Button>
							</div>
						{/if}
					</div>

					<!-- 3D Viewer (conditional) -->
					{#if shouldShowViewer}
						<div
							class="relative min-h-0 flex-1 rounded-lg bg-white shadow-lg {isViewerFullscreen
								? 'fullscreen-viewer'
								: ''}"
						>
							<div class="h-full w-full">
								<canvas class="block h-full w-full rounded-lg" bind:this={canvas}></canvas>
							</div>
							<!-- Fullscreen Toggle Button -->
							<button
								class="absolute right-4 bottom-4 z-50 flex h-10 w-10 items-center justify-center rounded-lg bg-white/90 shadow-lg transition-all hover:bg-white hover:shadow-xl active:scale-95"
								onclick={toggleFullscreen}
								title={isViewerFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
							>
								{#if isViewerFullscreen}
									<Minimize class="h-5 w-5 text-gray-700" />
								{:else}
									<Maximize class="h-5 w-5 text-gray-700" />
								{/if}
							</button>
						</div>
					{/if}
				</div>
			{/key}

			{#if wsState.isSolving && schema.instanceSolve !== false}
				<div
					class="bg-primary text-primary-foreground fixed bottom-8 left-8 z-50 flex animate-[slideInLeft_0.3s_ease-out] items-center gap-3 rounded-lg px-4 py-3 shadow-lg"
				>
					<div
						class="border-primary-foreground h-4 w-4 animate-spin rounded-full border-2 border-t-transparent"
					></div>
					<span class="text-sm font-medium">Solving...</span>
				</div>
			{/if}
		{/if}
	</div>

	{#if schemaUpdateNotification}
		<div
			class="fixed right-8 bottom-8 z-50 flex animate-[slideInRight_0.3s_ease-out] items-center gap-3 rounded-lg bg-blue-600 px-6 py-4 text-white shadow-lg"
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

	@keyframes slideInLeft {
		from {
			transform: translateX(-100%);
			opacity: 0;
		}
		to {
			transform: translateX(0);
			opacity: 1;
		}
	}

	.fullscreen-container {
		position: fixed;
		inset: 0;
		z-index: 9999;
		padding: 0 !important;
		background: white;
	}

	.fullscreen-viewer {
		position: fixed;
		inset: 0;
		z-index: 10000;
		border-radius: 0 !important;
		min-height: 100vh;
		width: 100vw;
	}
</style>
