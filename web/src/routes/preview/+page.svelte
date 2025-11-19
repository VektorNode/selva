<script lang="ts">
	import { page } from '$app/state';
	import { getWebSocketClient } from '$lib/api/websocket';
	import type { UISchema, AvailableParameters, SupportedTypes } from '$lib/types/generated';
	import { TabLayout, Layout as LegacyLayout } from '$lib/components/preview';
	import { PageContainer, PageHeader } from '$lib/components/layout';
	import { StateDisplay, Button } from '$lib/components/ui';
	import {
		createNavigateTo,
		initializeWebSocketSession,
		ensureSchemaLayoutDefaults,
		getDefaultValue
	} from '$lib/utils/session';
	import { onMount } from 'svelte';

	// Runtime mode: 'local' uses WebSocket, 'compute' uses Rhino Compute
	type RuntimeMode = 'local' | 'compute';

	let sessionId = $state('');
	let schema = $state<UISchema | null>(null);
	// Values stored by GUID (stable across parameter name changes)
	let values = $state<Record<string, unknown>>({});
	let loading = $state(true);
	let error = $state('');
	let wsClient = getWebSocketClient();
	let wsConnected = $state(false);
	let schemaUpdateNotification = $state('');
	let notificationTimer: ReturnType<typeof setTimeout> | null = null;

	// Determine runtime mode from URL parameter
	let runtimeMode = $state<RuntimeMode>('local');
	let solving = $state(false);

	const navigateTo = $derived(createNavigateTo(sessionId));

	// Track if we're updating values from remote (to avoid feedback loop)
	let isRemoteUpdate = $state(false);

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
	 * Handle value changes from UI
	 * Only send to Grasshopper if change came from user (not from remote)
	 */
	async function handleValueChange(paramId: string, value: SupportedTypes) {
		// Skip sending if this is a remote update
		if (isRemoteUpdate) {
			console.log('[Preview] Skipping send for remote update on paramId:', paramId);
			return;
		}

		// Update local values (using GUID as key)
		values[paramId] = value;

		if (runtimeMode === 'local' && wsConnected && wsClient.isConnected) {
			console.log('[Preview] Sending value update to Grasshopper (GUID keys):', {
				[paramId]: value
			});

			// Send via WebSocket with GUID keys (what C# expects)
			wsClient.sendValueUpdate(sessionId, $state.snapshot(values));
		} else if (!wsClient.isConnected) {
			console.warn('[Preview] Cannot send values - WebSocket not connected');
		}
	}

	// Compute badge configuration
	const badgeConfig = $derived(
		runtimeMode === 'local'
			? wsConnected
				? { label: 'Connected', variant: 'connected' as const }
				: {
						label: 'Disconnected',
						variant: 'disconnected' as const
					}
			: solving
				? { label: '⚙️ Solving...', variant: 'solving' as const }
				: { label: '☁️ Rhino Compute', variant: 'compute' as const }
	);

	onMount(() => {
		// Define handlers at the top level so they can be cleaned up
		const handleInitialData = (message: any) => {
			if (message.sessionId === sessionId) {
				console.log('[Preview] Received initial data:', message);

				const receivedSchema = message.schema;
				const availableParams = message.availableParams as AvailableParameters;
				const currentValues = message.currentValues || {};

				console.log('[Preview] Available Parameters:', availableParams);

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

				// Initialize values from available params defaults
				processedSchema.inputs.forEach((input: any) => {
					const availableParam = availableParams?.parameters?.find((p) => p.id === input.id);
					const defaultValue =
						availableParam?.default !== null && availableParam?.default !== undefined
							? availableParam.default
							: getDefaultValue(input.paramType);

					values[input.id] = defaultValue;
				});

				processedSchema.outputs.forEach((output: any) => {
					values[output.id] = null;
				});

				// Apply current values from Grasshopper
				if (currentValues && Object.keys(currentValues).length > 0) {
					isRemoteUpdate = true;
					values = { ...values, ...currentValues };
					isRemoteUpdate = false;
				}

				schema = processedSchema;
				loading = false;
			}
		};

		const handleCurrentValues = (message: any) => {
			if (message.sessionId === sessionId) {
				console.log('[Preview] Received current values:', message.values);
				isRemoteUpdate = true;
				values = { ...values, ...message.values };
				isRemoteUpdate = false;
			}
		};

		const handleOutputs = (message: any) => {
			if (message.sessionId === sessionId) {
				console.log('[Preview] Received outputs:', message.outputs);
				const outputUpdates = Object.fromEntries(
					Object.entries(message.outputs).filter(([paramId]) =>
						schema?.outputs.some((o) => o.id === paramId)
					)
				);

				if (Object.keys(outputUpdates).length > 0) {
					isRemoteUpdate = true;
					values = { ...values, ...outputUpdates };
					isRemoteUpdate = false;
				}
			}
		};

		const handleOutputUpdate = (message: any) => {
			if (message.sessionId === sessionId) {
				console.log('[Preview] Received output update:', message.outputs);
				const outputUpdates = Object.fromEntries(
					Object.entries(message.outputs).filter(([paramId]) =>
						schema?.outputs.some((o) => o.id === paramId)
					)
				);

				if (Object.keys(outputUpdates).length > 0) {
					isRemoteUpdate = true;
					values = { ...values, ...outputUpdates };
					isRemoteUpdate = false;
				}
			}
		};

		const handleSchemaUpdated = (message: any) => {
			if (message.sessionId === sessionId) {
				console.log('[Preview] Schema updated:', {
					schema: message.schema,
					removedIds: message.removedIds
				});

				const removedCount = message.removedIds?.length || 0;

				const newSchema = ensureSchemaLayoutDefaults(
					JSON.parse(JSON.stringify(message.schema))
				);

				if (message.removedIds && message.removedIds.length > 0) {
					const newValues = { ...values };
					message.removedIds.forEach((id: string) => {
						delete newValues[id];
					});
					values = newValues;

					console.log(`[Preview] Removed ${message.removedIds.length} parameter(s) from UI`);
				}

				schema = null;

				setTimeout(() => {
					schema = newSchema;

					if (removedCount > 0) {
						showNotification(
							`Schema updated: ${removedCount} parameter${removedCount > 1 ? 's' : ''} removed`
						);
					}
				}, 10);
			}
		};

		const initializeSchema = async () => {
			sessionId = page.url.searchParams.get('session') || '';

			if (runtimeMode === 'local') {
				const result = await initializeWebSocketSession(sessionId);

				if (result.error) {
					error = result.error;
					loading = false;
					return;
				}

				console.log('[Preview] WebSocket connected');
				wsConnected = result.connected;

				// Register handlers
				wsClient.on('initialData', handleInitialData);
				wsClient.on('currentValues', handleCurrentValues);
				wsClient.on('outputs', handleOutputs);
				wsClient.on('outputUpdate', handleOutputUpdate);
				wsClient.on('schemaUpdated', handleSchemaUpdated);

				// Request initial data from Grasshopper
				console.log('[Preview] Requesting initial data from Grasshopper');
				wsClient.requestInitialData(sessionId);
			}
		};

		initializeSchema();

		return () => {
			// Clean up WebSocket handlers to prevent duplicate responses
			wsClient.off('initialData', handleInitialData);
			wsClient.off('currentValues', handleCurrentValues);
			wsClient.off('outputs', handleOutputs);
			wsClient.off('outputUpdate', handleOutputUpdate);
			wsClient.off('schemaUpdated', handleSchemaUpdated);
			// Don't disconnect - keep connection alive for page switching
		};
	});
</script>

<PageContainer background="white">
	<PageHeader
		title={schema?.name || 'Interactive Preview'}
		badge={badgeConfig}
		showModeToggle={true}
		{sessionId}
	>
		<nav class="flex gap-2">
			<Button variant="outline" size="sm" onclick={() => navigateTo('')}>Home</Button>
			<Button variant="outline" size="sm" onclick={() => navigateTo('builder')}>
				Schema Builder
			</Button>
			<Button variant="default" size="sm">Interactive Preview</Button>
		</nav>
	</PageHeader>

	<div class="flex-1 overflow-auto">
		{#if loading}
			<div class="flex min-h-[400px] items-center justify-center">
				<StateDisplay type="loading" size="large" message="Loading preview..." />
			</div>
		{:else if error}
			<div class="flex min-h-[400px] items-center justify-center">
				<StateDisplay type="error" size="large" message={error} />
			</div>
		{:else if schema}
			<div class="mx-auto max-w-6xl p-8">
				{#if schema.layout.type === 'tabbed' && schema.layout.tabs && schema.layout.tabs.length > 0}
					<TabLayout
						{schema}
						bind:values
						onValueChange={handleValueChange}
						debounceSliders={true}
					/>
				{:else}
					<LegacyLayout
						{schema}
						bind:values
						onValueChange={handleValueChange}
						debounceSliders={true}
					/>
				{/if}
			</div>
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
</style>
