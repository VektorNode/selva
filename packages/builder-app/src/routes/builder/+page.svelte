<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { AppShell, StateDisplay, Button, Dialog, Resizable, toast, useFooterItem } from '@selvajs/ui';
	import { Save } from '@lucide/svelte';
	import WsStatusFooter from '$lib/components/WsStatusFooter.svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { BuilderSidebar, TabEditor, SyncDialog } from '$lib/components/builder';
	import { initializeWebSocketSession, buildSessionParams } from '$lib/utils/session';
	import { onMount } from 'svelte';
	import { useBuilderState } from '$lib/composables/useBuilderState.svelte';
	import { useBuilderActions } from '$lib/composables/useBuilderActions.svelte';

	let sessionId = $state('');
	let builderState = $state<ReturnType<typeof useBuilderState> | null>(null);
	let showBatchProcessor = $state(false);
	let saveInFlight: Promise<boolean> | null = null;

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

		const url = `${route}?${buildSessionParams()}`;
		goto(url, { noScroll: true }).catch(() => {});
	}

	const homeUrl = $derived(`/?${buildSessionParams()}`);

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

	const availableInputs = $derived(builderState?.state.availableInputs || []);

	const availableOutputsUnplaced = $derived(builderState?.state.availableOutputs || []);

	const allAvailableInputs = $derived(builderState?.state.availableInputs || []);

	// Persist current schema to localStorage whenever it changes
	$effect(() => {
		if (builderState?.state.schema && sessionId) {
			builderState.history.persistCurrentSchema(builderState.state.schema);
		}
	});

	function saveSchema(): Promise<boolean> {
		// Coalesce concurrent calls — a single in-flight save resolves them all
		if (saveInFlight) return saveInFlight;

		const promise = new Promise<boolean>((resolve) => {
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
			let timeoutId: ReturnType<typeof setTimeout>;

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

			// Register listener BEFORE sending so a fast response can't arrive first
			builderState.wsState.on('schemaSaved', handleSaveResponse);

			timeoutId = setTimeout(() => {
				if (handled) return;
				handled = true;
				builderState?.wsState.off('schemaSaved', handleSaveResponse);
				toast.error('Save timeout: no response from Grasshopper');
				resolve(false);
			}, 10000);

			builderState.wsState.saveSchema(sessionId, $state.snapshot(builderState.state.schema));
		});

		saveInFlight = promise;
		promise.finally(() => {
			if (saveInFlight === promise) saveInFlight = null;
		});
		return promise;
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

<AppShell {homeUrl} title="Schema Builder" mode="fixed" showFooter>
			{#snippet navItems()}
				<Button variant="default" size="sm">Schema Builder</Button>
				<Button variant="ghost" size="sm" onclick={() => navigateTo('/preview')}>
					Interactive Preview
				</Button>
			{/snippet}
			{#snippet rightContent()}
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
			{/snippet}

		<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
			{#if builderState?.state.loading}
				<div class="flex min-h-100 items-center justify-center">
					<StateDisplay type="loading" size="large" message="Loading schema..." />
				</div>
			{:else if builderState?.state.schema}
				{#if builderState.state.error}
					<div class="px-6 pt-4">
						<StateDisplay type="warning" size="medium" message={builderState.state.error} />
					</div>
				{/if}

				<Resizable.PaneGroup
					direction="horizontal"
					autoSaveId="builder-sidebar-layout"
					class="min-h-0 flex-1"
				>
					<Resizable.Pane defaultSize={25} minSize={18} maxSize={42}>
						<div class="h-full px-(--page-px) py-(--page-py)">
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
								onImportGhGroups={actions.onImportGhGroups}
							/>
						</div>
					</Resizable.Pane>

					<Resizable.Handle withHandle />

					<Resizable.Pane defaultSize={75} minSize={40}>
						<main class="flex h-full flex-col gap-6 overflow-y-auto px-(--page-px) py-(--page-py)">
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
									onMoveGroupToTab={actions.onMoveGroupToTab}
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
					</Resizable.Pane>
				</Resizable.PaneGroup>
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
	</AppShell>
