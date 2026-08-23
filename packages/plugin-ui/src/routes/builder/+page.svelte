<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import {
		AppShell,
		StateDisplay,
		Button,
		Dialog,
		Resizable,
		toast,
		useFooterItem
	} from '@selvajs/ui';
	import { Save, RefreshCw } from '@lucide/svelte';
	import WsStatusFooter from '$lib/components/WsStatusFooter.svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { BuilderSidebar, TabEditor, SyncDialog } from '$lib/components/builder';
	import { buildSessionParams } from '$lib/utils/session';
	import { onMount } from 'svelte';
	import { useBuilderState } from '$lib/composables/useBuilderState.svelte';
	import { useBuilderActions } from '$lib/composables/useBuilderActions.svelte';

	let sessionId = $state('');
	let builderState = $state<ReturnType<typeof useBuilderState> | null>(null);
	let showBatchProcessor = $state(false);
	let saveInFlight: Promise<boolean> | null = null;

	// Navigation confirmation. When the user clicks "Interactive Preview" with
	// unsaved edits, we hold the route here and ask save / discard / cancel.
	let navPromptOpen = $state(false);
	let pendingNavRoute = $state<'/preview' | null>(null);

	const actions = useBuilderActions(() => builderState);

	async function navigateTo(route: '/' | '/preview') {
		if (route === '/preview' && builderState?.state.isDirty) {
			pendingNavRoute = route;
			navPromptOpen = true;
			return;
		}
		performNavigate(route);
	}

	function performNavigate(route: '/' | '/preview') {
		const url = `${route}?${buildSessionParams()}`;
		goto(url, { noScroll: true }).catch(() => {});
	}

	async function navPromptSave() {
		navPromptOpen = false;
		const route = pendingNavRoute;
		pendingNavRoute = null;
		const saved = await saveSchema();
		if (saved && route) performNavigate(route);
	}

	function navPromptDiscard() {
		navPromptOpen = false;
		const route = pendingNavRoute;
		pendingNavRoute = null;
		builderState?.discardDraft();
		if (route) performNavigate(route);
	}

	function navPromptCancel() {
		navPromptOpen = false;
		pendingNavRoute = null;
	}

	const homeUrl = $derived(`/?${buildSessionParams()}`);

	const placedInLayoutIds = $derived.by(() => {
		const ids = new SvelteSet<string>();
		const layout = builderState?.state.draft?.layout;

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

	function saveSchema(): Promise<boolean> {
		if (saveInFlight) return saveInFlight;
		if (!builderState) return Promise.resolve(false);

		// The seam owns the request/response handshake, timeout, and post-save lifecycle
		// (isDirty reset + toasts). The route just guards against overlapping saves.
		const promise = builderState.save();
		saveInFlight = promise;
		promise.finally(() => {
			if (saveInFlight === promise) saveInFlight = null;
		});
		return promise;
	}

	function handleKeydown(e: KeyboardEvent) {
		if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
			e.preventDefault();
			if (builderState?.history.canUndo() && builderState.state.draft) {
				const prev = builderState.history.undo($state.snapshot(builderState.state.draft));
				if (prev) {
					builderState.state.draft = prev;
					builderState.markDirty();
					toast.success('Undo');
				}
			}
		} else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
			e.preventDefault();
			if (builderState?.history.canRedo() && builderState.state.draft) {
				const next = builderState.history.redo($state.snapshot(builderState.state.draft));
				if (next) {
					builderState.state.draft = next;
					builderState.markDirty();
					toast.success('Redo');
				}
			}
		} else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
			e.preventDefault();
			saveSchema().catch(() => {});
		}
	}

	onMount(() => {
		const urlSessionId = page.url.searchParams.get('session') || '';
		sessionId = urlSessionId;

		builderState = useBuilderState(urlSessionId);
		// initialize() now owns the connect handshake (via the SchemaSource) and the first fetch.
		builderState.initialize();
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

	useFooterItem({
		id: 'ws-status',
		component: WsStatusFooter,
		getProps: () => ({
			connected: builderState?.connected ?? false,
			sessionId
		}),
		position: 'left',
		priority: 10
	});
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
			disabled={!builderState?.state.draft}
		>
			Sync with Grasshopper
		</Button>
		<Button variant="outline" size="sm" onclick={() => (showBatchProcessor = !showBatchProcessor)}>
			Batch Processors
		</Button>
	{/snippet}

	<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
		{#if builderState?.state.loading}
			<div class="flex min-h-100 items-center justify-center">
				<StateDisplay type="loading" size="large" message="Loading schema..." />
			</div>
		{:else if builderState?.state.draft}
			{#if builderState.state.error}
				<div class="flex flex-col items-center gap-3 px-6 pt-4">
					<StateDisplay type="warning" size="medium" message={builderState.state.error} />
					<Button
						variant="outline"
						size="sm"
						onclick={() => builderState?.syncParameters()}
						disabled={!builderState?.connected}
					>
						<RefreshCw class="mr-2 h-4 w-4" />Refresh
					</Button>
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
							schema={builderState.state.draft}
							{availableInputs}
							availableOutputs={availableOutputsUnplaced}
							placedIds={placedInLayoutIds}
							syncNeeded={builderState.state.syncNeeded}
							onSchemaChange={(updatedSchema) => {
								if (builderState && builderState.state.draft) {
									builderState.history.push($state.snapshot(builderState.state.draft));
									builderState.state.draft = updatedSchema;
									builderState.markDirty();
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
						{#if builderState.state.draft.layout?.type === 'tabbed'}
							<TabEditor
								bind:tabs={builderState.state.draft.layout.tabs}
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
							<Button onclick={() => saveSchema().catch(() => {})}>
								<Save class="mr-2 h-4 w-4" />Save Schema
							</Button>
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

	<Dialog.Root bind:open={navPromptOpen}>
		<Dialog.Content>
			<Dialog.Header>
				<Dialog.Title>Unsaved layout changes</Dialog.Title>
				<Dialog.Description>
					You have unsaved edits to the schema. Save them before switching to Interactive Preview,
					discard them, or cancel and stay here.
				</Dialog.Description>
			</Dialog.Header>
			<Dialog.Footer>
				<Button variant="outline" onclick={navPromptCancel}>Cancel</Button>
				<Button variant="outline" onclick={navPromptDiscard}>Discard</Button>
				<Button onclick={() => navPromptSave().catch(() => {})}>Save and continue</Button>
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
