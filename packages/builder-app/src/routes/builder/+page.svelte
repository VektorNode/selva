<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import {
		PageContainer,
		PageHeader,
		StateDisplay,
		Button,
		Dialog,
		toast,
		useFooterItem
	} from 'selva-shared';
	import { Save } from '@lucide/svelte';
	import WsStatusFooter from '$lib/components/WsStatusFooter.svelte';
	import { SvelteSet, SvelteURLSearchParams } from 'svelte/reactivity';
	import { DragDropContext, BuilderSidebar, TabEditor, SyncDialog } from '$lib/components/builder';
	import { initializeWebSocketSession } from '$lib/utils/session';
	import { onMount } from 'svelte';
	import { useBuilderState } from '$lib/composables/useBuilderState.svelte';
	import { useBuilderActions } from '$lib/composables/useBuilderActions.svelte';

	let sessionId = $state('');
	let builderState = $state<ReturnType<typeof useBuilderState> | null>(null);
	let showBatchProcessor = $state(false);

	const actions = useBuilderActions(() => builderState);

	// Navigate to specific routes with session and wsPort preservation
	async function navigateTo(route: '/' | '/preview') {
		// Auto-save schema when switching to interactive mode
		if (route === '/preview') {
			const saved = await saveSchema();
			if (!saved) {
				// Don't navigate if save failed
				return;
			}
		}

		const params = new SvelteURLSearchParams();
		if (sessionId) params.set('session', sessionId);
		const wsPort = page.url.searchParams.get('wsPort');
		if (wsPort) params.set('wsPort', wsPort);

		const url = `${route}?${params.toString()}`;
		goto(url, { noScroll: true }).catch(() => {});
	}

	const placedInLayoutIds = $derived.by(() => {
		const ids = new SvelteSet<string>();
		const layout = builderState?.state.schema?.layout;

		if (layout?.type === 'tabbed') {
			layout.tabs.forEach((tab) => {
				tab.groups.forEach((group) => {
					group.items.forEach((item) => {
						const paramId = (item as { paramId?: string }).paramId;
						if (paramId) ids.add(paramId);
					});
				});
			});
		} else if (layout?.type === 'flat') {
			layout.groups.forEach((group) => {
				group.items.forEach((item) => {
					const paramId = (item as { paramId?: string }).paramId;
					if (paramId) ids.add(paramId);
				});
			});
		}
		return ids;
	});

	const availableInputs = $derived(
		builderState?.state.availableInputs.filter((p) => !placedInLayoutIds.has(p.id)) || []
	);

	const availableOutputsUnplaced = $derived(
		builderState?.state.availableOutputs.filter((o) => !placedInLayoutIds.has(o.id)) || []
	);

	const allAvailableInputs = $derived(builderState?.state.availableInputs || []);

	// Persist current schema to localStorage whenever it changes
	$effect(() => {
		if (builderState?.state.schema && sessionId) {
			builderState.history.persistCurrentSchema(builderState.state.schema);
		}
	});

	function saveSchema(): Promise<boolean> {
		return new Promise((resolve) => {
			// Validation checks
			if (!builderState?.state.schema) {
				toast.error('Schema not initialized');
				resolve(false);
				return;
			}

			if (!sessionId) {
				toast.error('Session not initialized');
				resolve(false);
				return;
			}

			if (!builderState.wsState.connected) {
				toast.error('Not connected to Grasshopper');
				resolve(false);
				return;
			}

			let handled = false;

			// Set up one-time listener for save response
			const handleSaveResponse = (data: unknown) => {
				if (handled) return;

				const message = data as { sessionId: string; success: boolean; message?: string };
				if (message.sessionId !== sessionId) return;

				handled = true;
				clearTimeout(timeoutId);
				builderState?.wsState.off('schemaSaved', handleSaveResponse);

				if (message.success) {
					toast.success('Schema saved successfully');
					resolve(true);
				} else {
					const errorMsg = message.message || 'Unknown error';
					toast.error(`Failed to save schema: ${errorMsg}`);
					resolve(false);
				}
			};

			// Timeout after 10 seconds if no response
			const timeoutId = setTimeout(() => {
				if (handled) return;
				handled = true;
				builderState?.wsState.off('schemaSaved', handleSaveResponse);
				toast.error('Save timeout: no response from Grasshopper');
				resolve(false);
			}, 10000);

			// Listen for save response (runs before composable handlers due to registration order)
			builderState.wsState.on('schemaSaved', handleSaveResponse);

			// Send save request
			builderState.wsState.saveSchema(sessionId, $state.snapshot(builderState.state.schema));
		});
	}

	function handleKeydown(e: KeyboardEvent) {
		if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
			e.preventDefault();
			if (builderState?.history.canUndo() && builderState.state.schema) {
				const prev = builderState.history.undo($state.snapshot(builderState.state.schema));
				if (prev) {
					builderState.state.schema = prev;
					toast.success('Undo');
				}
			}
		} else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
			e.preventDefault();
			if (builderState?.history.canRedo() && builderState.state.schema) {
				const next = builderState.history.redo($state.snapshot(builderState.state.schema));
				if (next) {
					builderState.state.schema = next;
					toast.success('Redo');
				}
			}
		} else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
			e.preventDefault();
			saveSchema().catch(() => {
				// Error already shown via toast in saveSchema
			});
		}
	}

	onMount(() => {
		const urlSessionId = page.url.searchParams.get('session') || '';
		sessionId = urlSessionId;

		const initializeBuilder = async () => {
			const result = await initializeWebSocketSession(urlSessionId);

			builderState = useBuilderState(urlSessionId);

			if (result.error) {
				builderState.state.error = result.error;
				builderState.state.loading = false;
				return;
			}

			builderState.initialize();
		};

		initializeBuilder();
		window.addEventListener('keydown', handleKeydown);

		return () => {
			window.removeEventListener('keydown', handleKeydown);
			builderState?.cleanup();
		};
	});

	function getParameterInfo(paramId: string) {
		return builderState?.state.availableInputs.find((p) => p.id === paramId);
	}

	function handleTabChange(tabId: string) {
		if (builderState) {
			builderState.state.activeTabId = tabId;
		}
	}

	useFooterItem(
		'ws-status',
		WsStatusFooter,
		() => ({
			connected: builderState?.wsState.connected ?? false,
			sessionId
		}),
		'left',
		10
	);
</script>

<DragDropContext>
	<PageContainer background="white">
		<PageHeader title="Schema Builder" showModeToggle={true}>
			<nav class="flex items-center gap-2">
				{#if builderState?.state.syncNeeded}
					<Button
						variant="default"
						size="sm"
						onclick={() => builderState?.syncParameters()}
						class="animate-pulse bg-amber-500 hover:bg-amber-600"
					>
						⚡ Sync Parameters
					</Button>
				{/if}
				<Button variant="outline" size="sm" onclick={() => navigateTo('/')}>Home</Button>
				<Button variant="default" size="sm">Schema Builder</Button>
				<Button variant="outline" size="sm" onclick={() => navigateTo('/preview')}>
					Interactive Preview
				</Button>
				<div class="h-6 w-px bg-gray-300"></div>
				<Button
					variant="outline"
					size="sm"
					onclick={() => builderState?.requestSyncPreview()}
					disabled={!builderState?.state.schema}
				>
					Sync with Grasshopper
				</Button>
				<Button
					variant="outline"
					size="sm"
					onclick={() => (showBatchProcessor = !showBatchProcessor)}
				>
					Batch Processors
				</Button>
			</nav>
		</PageHeader>

		<div class="flex-1 overflow-auto">
			{#if builderState?.state.loading}
				<div class="flex min-h-100 items-center justify-center">
					<StateDisplay type="loading" size="large" message="Loading schema..." />
				</div>
			{:else if builderState?.state.schema}
				<div class="mx-auto grid h-full max-w-500 grid-cols-1 gap-6 p-6 lg:grid-cols-[360px_1fr]">
					{#if builderState.state.error}
						<div class="col-span-2">
							<StateDisplay type="warning" size="medium" message={builderState.state.error} />
						</div>
					{/if}

					<BuilderSidebar
						schema={builderState.state.schema}
						{availableInputs}
						availableOutputs={availableOutputsUnplaced}
						placedIds={placedInLayoutIds}
						syncNeeded={builderState.state.syncNeeded}
						onSchemaChange={(updatedSchema) => {
							if (builderState && builderState.state.schema) {
								// Save snapshot before import
								builderState.history.push($state.snapshot(builderState.state.schema));
								builderState.state.schema = updatedSchema;
								// Auto-select first tab when schema is imported/changed
								if (
									updatedSchema.layout?.type === 'tabbed' &&
									updatedSchema.layout.tabs.length > 0
								) {
									builderState.state.activeTabId = updatedSchema.layout.tabs[0].id;
								}
							}
						}}
						onSync={() => builderState?.syncParameters()}
						onAddToGroup={actions.onAddToGroup}
						onAddToNewGroup={actions.onAddToNewGroup}
					/>

					<main class="flex flex-col gap-6">
						{#if builderState.state.schema.layout?.type === 'tabbed'}
							<TabEditor
								bind:tabs={builderState.state.schema.layout.tabs}
								activeTabId={builderState.state.activeTabId}
								onTabChange={handleTabChange}
								onAddTab={actions.onAddTab}
								onRemoveTab={actions.onRemoveTab}
								onReorderTabs={actions.onReorderTabs}
								onAddGroup={actions.onAddGroup}
								onRemoveGroup={actions.onRemoveGroup}
								onReorderGroups={actions.onReorderGroups}
								onParameterDrop={actions.onParameterDrop}
								onReorder={actions.onReorder}
								onRemoveItem={actions.onRemoveItem}
								onAddLineBreak={actions.onAddLineBreak}
								availableInputs={allAvailableInputs}
								{getParameterInfo}
								outputValues={builderState.state.outputValues}
							/>
						{/if}

						<div class="mb-20 flex justify-end gap-4">
							<Button onclick={() => saveSchema().catch(() => {})}
								><Save class="mr-2 h-4 w-4" />Save Schema</Button
							>
						</div>
					</main>
				</div>
			{/if}
		</div>

		<Dialog.Root bind:open={showBatchProcessor}>
			<Dialog.Content>
				<Dialog.Header>
					<Dialog.Title>Batch Processor - Number Inputs</Dialog.Title>
					<Dialog.Description>
						Convert all number/slider inputs across the entire schema in one action.
					</Dialog.Description>
				</Dialog.Header>

				<div class="space-y-3">
					<Button
						variant="default"
						class="w-full"
						onclick={() => actions.onBatchConvertToSliders(() => (showBatchProcessor = false))}
					>
						Convert All to Sliders
					</Button>
					<Button
						variant="default"
						class="w-full"
						onclick={() => actions.onBatchConvertToNumberInputs(() => (showBatchProcessor = false))}
					>
						Convert All to Number Inputs
					</Button>
				</div>

				<Dialog.Footer>
					<Button variant="outline" onclick={() => (showBatchProcessor = false)}>Close</Button>
				</Dialog.Footer>
			</Dialog.Content>
		</Dialog.Root>

		{#if builderState}
			<SyncDialog
				open={builderState.state.syncDialogOpen}
				syncDiff={builderState.state.syncDiff}
				loading={builderState.state.syncLoading}
				onOpenChange={(open) => {
					if (builderState) builderState.state.syncDialogOpen = open;
				}}
				onApplyChanges={(changes) => builderState?.applySyncChanges(changes)}
			/>
		{/if}
	</PageContainer>
</DragDropContext>
