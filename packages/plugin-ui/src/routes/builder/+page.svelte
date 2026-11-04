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
	import { Save, RefreshCw, CloudUpload, PlugZap } from '@lucide/svelte';
	import WsStatusFooter from '#lib/components/WsStatusFooter.svelte';
	import ModeHeader from '#lib/components/ModeHeader.svelte';
	import { MediaQuery, SvelteSet } from 'svelte/reactivity';
	import {
		BuilderSearch,
		BuilderSidebar,
		SelectionBar,
		TabEditor,
		SyncDialog
	} from '#lib/components/builder/index.js';
	import { bringIntoView } from '#lib/components/builder/reveal.js';
	import type { SearchTarget } from '#lib/features/builder/index.js';
	import SelvaUploadDialog from '#lib/components/selva-upload/SelvaUploadDialog.svelte';
	import SelvaConnectionDialog from '#lib/components/selva-upload/SelvaConnectionDialog.svelte';
	import { buildSessionParams } from '#lib/utils/session.js';
	import { currentRole } from '#lib/utils/session-role.svelte.js';
	import { rhinoShellProps } from '#lib/utils/rhino-host.svelte.js';
	import { onMount, tick } from 'svelte';
	import { useBuilderState } from '#lib/composables/useBuilderState.svelte.js';
	import { useBuilderActions } from '#lib/composables/useBuilderActions.svelte.js';
	import { builderSelection } from '#lib/features/builder/selection.svelte.js';
	import { setBuilderDraft } from '#lib/components/builder/draft-context.js';
	import { putAsset } from '#lib/features/builder/option-assets.js';
	import { useSelvaUpload, type SelvaUpload } from '#lib/composables/useSelvaUpload.svelte.js';

	let sessionId = $state('');
	let builderState = $state<ReturnType<typeof useBuilderState> | null>(null);
	let selvaUpload = $state<SelvaUpload | null>(null);
	let showBatchProcessor = $state(false);
	let searchOpen = $state(false);
	let sidebar = $state<BuilderSidebar>();
	let saveInFlight: Promise<boolean> | null = null;

	// Navigation confirmation. When the user clicks "Interactive Preview" with
	// unsaved edits, we hold the route here and ask save / discard / cancel.
	let navPromptOpen = $state(false);
	let pendingNavRoute = $state<'/preview' | null>(null);

	const actions = useBuilderActions(() => builderState);

	$effect(() => {
		builderSelection.setTabDropHandler(actions.onDropOnTab);
		return () => builderSelection.setTabDropHandler(null);
	});
	setBuilderDraft({
		edit: (apply) => builderState?.editDraft(apply),
		get assets() {
			return builderState?.state.draft?.assets;
		},
		putAsset: (asset) => {
			const draft = builderState?.state.draft;
			if (!draft) throw new Error('No schema to add the asset to');
			return putAsset(draft, asset);
		}
	});

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
		goto(url, { reset: false }).catch(() => {});
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

	// Side by side under 1024px, the sidebar's quarter is too narrow to read a parameter name, and
	// a docked Rhino panel is narrower still. Stacked, a parameter can still be dragged from the
	// sidebar onto a group. The two arrangements save their sizes separately.
	const stacked = new MediaQuery('width < 64rem');
	const split = $derived(
		stacked.current
			? {
					direction: 'vertical' as const,
					autoSaveId: 'builder-sidebar-layout-stacked',
					sidebar: { defaultSize: 40, minSize: 20, maxSize: 75 },
					canvas: { defaultSize: 60, minSize: 25 }
				}
			: {
					direction: 'horizontal' as const,
					autoSaveId: 'builder-sidebar-layout',
					sidebar: { defaultSize: 25, minSize: 18, maxSize: 42 },
					canvas: { defaultSize: 75, minSize: 40 }
				}
	);

	// An upload already running can still be watched; a new one waits for the save.
	const uploadNeedsSave = $derived(!!builderState?.state.isDirty && !selvaUpload?.state.uploading);

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
		} else if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
			e.preventDefault();
			if (builderState?.state.draft) searchOpen = !searchOpen;
		}
	}

	// A player session has no builder: the plugin would refuse its saves anyway.
	$effect(() => {
		if (currentRole() === 'player') {
			goto(`/preview?${buildSessionParams()}`, { replace: true }).catch(() => {});
		}
	});

	onMount(() => {
		if (currentRole() === 'player') return;
		const urlSessionId = page.url.searchParams.get('session') || '';
		sessionId = urlSessionId;

		builderState = useBuilderState(urlSessionId);
		// initialize() now owns the connect handshake (via the SchemaSource) and the first fetch.
		builderState.initialize();
		selvaUpload = useSelvaUpload(urlSessionId, {
			isSchemaDirty: () => builderState?.state.isDirty ?? false
		});
		selvaUpload.initialize();
		window.addEventListener('keydown', handleKeydown);

		return () => {
			window.removeEventListener('keydown', handleKeydown);
			builderState?.cleanup();
			selvaUpload?.cleanup();
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

	const expandedItems = new SvelteSet<string>();
	const peekedGroups = new SvelteSet<string>();

	async function revealGroup(tabId: string, groupId: string) {
		if (tabId) handleTabChange(tabId);
		await tick();
		const target = document.querySelector(`[data-builder-group-id="${CSS.escape(groupId)}"]`);
		if (target) bringIntoView(target);
	}

	async function revealItem(tabId: string, groupId: string, itemId: string) {
		if (tabId) handleTabChange(tabId);
		peekedGroups.add(groupId);
		expandedItems.add(itemId);
		await tick();
		const target = document.querySelector(`[data-builder-item-id="${CSS.escape(itemId)}"]`);
		if (target) bringIntoView(target);
	}

	function revealSearchResult(target: SearchTarget) {
		switch (target.kind) {
			case 'item':
				return revealItem(target.tabId, target.groupId, target.itemId);
			case 'group':
				return revealGroup(target.tabId, target.groupId);
			case 'tab':
				return handleTabChange(target.tabId);
			case 'param':
				return sidebar?.revealParameter(target.nickname);
			case 'setting':
				return sidebar?.revealSetting(target);
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

{#snippet headerActions()}
	<Button
		variant={builderState?.state.isDirty ? 'default' : 'outline'}
		size="sm"
		onclick={() => saveSchema().catch(() => {})}
		disabled={!builderState?.state.draft}
		title="Save schema (Ctrl+S / ⌘S)"
	>
		<Save class="h-4 w-4" /><span class="max-sm:sr-only">Save</span>
	</Button>
	{#if selvaUpload?.available}
		<!-- The title sits on a wrapper: a disabled button gets no hover, so its own title never shows. -->
		<span title={uploadNeedsSave ? 'Save the schema first' : undefined}>
			<Button
				variant="outline"
				size="sm"
				onclick={() => selvaUpload?.open()}
				disabled={!builderState?.state.draft || uploadNeedsSave}
			>
				<CloudUpload class="h-4 w-4" /><span class="max-lg:sr-only">Upload to Selva</span>
			</Button>
		</span>
	{:else}
		<Button variant="outline" size="sm" onclick={() => selvaUpload?.openConnection()}>
			<PlugZap class="h-4 w-4" /><span class="max-lg:sr-only">Connect to Selva…</span>
		</Button>
	{/if}
{/snippet}

<AppShell {...rhinoShellProps()} mode="fixed" showFooter>
	{#snippet header()}
		<ModeHeader
			{homeUrl}
			current="builder"
			onSwitch={() => navigateTo('/preview')}
			title={builderState?.state.draft?.name ?? null}
			syncNeeded={builderState?.state.syncNeeded}
			onSync={() => builderState?.syncParameters()}
			actions={headerActions}
		/>
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

			{#key stacked.current}
				<Resizable.PaneGroup
					direction={split.direction}
					autoSaveId={split.autoSaveId}
					class="min-h-0 flex-1"
				>
					<Resizable.Pane {...split.sidebar}>
						<div class="h-full px-(--page-px) py-(--page-py) max-lg:py-2">
							<BuilderSidebar
								bind:this={sidebar}
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
								onSyncPreview={() => builderState?.requestSyncPreview()}
								onBatch={() => (showBatchProcessor = true)}
								onAddToGroup={actions.onAddToGroup}
								onAddToNewGroup={actions.onAddToNewGroup}
								onImportGhGroups={actions.onImportGhGroups}
								onRevealItem={revealItem}
								onSearch={() => (searchOpen = true)}
							/>
						</div>
					</Resizable.Pane>

					<Resizable.Handle withHandle />

					<Resizable.Pane {...split.canvas}>
						<main
							class="flex h-full flex-col gap-6 overflow-y-auto px-(--page-px) py-(--page-py) max-lg:py-3"
						>
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
									onCarrySelection={actions.onCarrySelection}
									onReorder={actions.onReorder}
									onRemoveItem={actions.onRemoveItem}
									onAddLineBreak={actions.onAddLineBreak}
									onEdit={(apply, coalesceKey) => builderState?.editDraft(apply, coalesceKey)}
									availableInputs={allAvailableInputs}
									{getParameterInfo}
									outputValues={builderState.state.outputValues}
									{expandedItems}
									{peekedGroups}
								/>
								<SelectionBar
									tabs={builderState.state.draft.layout.tabs}
									placedParamIds={placedInLayoutIds}
									onAdd={actions.onAddSelectedToGroup}
									onMove={actions.onMoveSelectedToGroup}
								/>
							{/if}
						</main>
					</Resizable.Pane>
				</Resizable.PaneGroup>
			{/key}
		{:else if builderState?.state.error}
			<div class="flex min-h-100 items-center justify-center px-6">
				<StateDisplay type="error" size="large" message={builderState.state.error} />
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

	{#if selvaUpload}
		<SelvaUploadDialog upload={selvaUpload} schema={builderState?.state.draft} />
		<SelvaConnectionDialog upload={selvaUpload} />
	{/if}

	{#if builderState?.state.draft}
		<BuilderSearch
			bind:open={searchOpen}
			schema={builderState.state.draft}
			availableInputs={allAvailableInputs}
			availableOutputs={availableOutputsUnplaced}
			onPick={revealSearchResult}
		/>
	{/if}

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
