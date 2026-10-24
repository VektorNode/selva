<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import {
		AppShell,
		StateDisplay,
		Button,
		AppLayout,
		SolveMessages,
		createSolvingIndicator,
		useFooterItem,
		getExternalInputs,
		readExternalValue,
		getHostContext,
		setHostContext,
		type ExternalInput
	} from '@selvajs/ui';
	import { buildSessionParams, getWebSocketPortFromUrl, isRhinoPanel } from '$lib/utils/session';
	import { currentRole } from '$lib/utils/session-role.svelte';
	import { getWebSocketState } from '$lib/websocket/websocket.svelte';
	import { isInRhinoPanel, rhinoShellProps } from '$lib/utils/rhino-host.svelte';
	import { usePreviewState } from '$lib/composables/usePreviewState.svelte';
	import WsStatusFooter from '$lib/components/WsStatusFooter.svelte';
	import ModeHeader from '$lib/components/ModeHeader.svelte';

	const sessionId = $derived(page.url.searchParams.get('session') || '');
	let isViewerFullscreen = $state(false);

	const preview = usePreviewState(() => sessionId);

	// The layout's host actions, plus what each geometry input lets the user pick. Read from the
	// canvas on every initialData, so a changed filter shows on the next load.
	setHostContext({
		...getHostContext(),
		describeGeometry: (paramId) => {
			const input = preview.state.discoveredInputs.find((i) => i.id === paramId);
			return input && { kinds: input.geometryTypes, atMost: input.atMost };
		}
	});
	const solvingIndicator = createSolvingIndicator(() => preview.isSolving, {
		freezesDuringSolve: isRhinoPanel()
	});

	$effect(() => {
		if (sessionId) {
			preview.initialize();
			return () => preview.cleanup();
		}
	});

	// Client-supplied inputs declared by the schema (source.kind === 'client').
	const externalInputs = $derived<ExternalInput[]>(
		preview.state.schema ? getExternalInputs(preview.state.schema) : []
	);

	// External inputs are seeded with the GH default by initializeValues, but we
	// don't want that default to count as "the user provided a value." Override:
	// restore from sessionStorage if present; otherwise clear so the missing-check
	// can detect it.
	//
	// untrack(): we *write* to state.values inside the effect; if we also let it
	// be tracked as a dep, every write re-runs the effect → infinite loop.
	$effect(() => {
		if (!sessionId) return;
		if (externalInputs.length === 0) return;

		const sid = sessionId;
		const inputs = externalInputs;
		untrack(() => {
			for (const ext of inputs) {
				const stored = readExternalValue({ scopeKey: sid, inputId: ext.paramId });
				if (stored !== undefined) {
					if (preview.values[ext.paramId] !== stored) {
						preview.handleValueChange(ext.paramId, stored as never);
					}
				} else if (preview.values[ext.paramId] !== undefined) {
					delete preview.values[ext.paramId];
				}
			}
		});
	});

	function navigateTo(route: '/' | '/builder') {
		goto(`${route}?${buildSessionParams()}`).catch(() => {});
	}

	const homeUrl = $derived(`/?${buildSessionParams()}`);

	const player = $derived(currentRole() === 'player');
	const wsState = getWebSocketState(getWebSocketPortFromUrl());

	useFooterItem({
		id: 'ws-status',
		component: WsStatusFooter,
		getProps: () => ({ connected: preview.connected, sessionId }),
		position: 'left',
		priority: 10
	});
</script>

{#snippet solveMessages()}
	<SolveMessages
		live={preview.live}
		phase={preview.phase}
		diagnostics={preview.diagnostics}
		onabort={() => preview.abort()}
		onconfirm={() => preview.acknowledge()}
		ondiscard={() => preview.discard()}
		freezesDuringSolve={isRhinoPanel()}
		placement={isRhinoPanel() ? 'inline' : 'floating'}
	/>
{/snippet}

{#snippet headerActions()}
	{#if preview.state.syncNeeded}
		<Button
			variant="default"
			size="sm"
			onclick={() => preview.syncParameters()}
			class="animate-pulse bg-amber-500 hover:bg-amber-600"
			title="Sync Parameters"
		>
			⚡ <span class="max-md:sr-only">Sync Parameters</span>
		</Button>
	{/if}
{/snippet}

<AppShell
	{...rhinoShellProps()}
	mode="fixed"
	showFooter
	errors={preview.computeErrors}
	warnings={preview.computeWarnings}
	diagnostics={preview.diagnostics}
>
	{#snippet header()}
		<ModeHeader
			{homeUrl}
			current="preview"
			{player}
			onSwitch={() => navigateTo('/builder')}
			onClose={() => wsState.closeDefinition(sessionId)}
			onEdit={() => wsState.editInGrasshopper(sessionId)}
			title={preview.state.schema?.name ?? null}
			actions={headerActions}
		/>
	{/snippet}

	<div class="relative flex flex-1 flex-col overflow-hidden">
		{#if preview.state.loading}
			<div class="flex min-h-100 items-center justify-center">
				<StateDisplay type="loading" size="large" message="Loading preview..." />
			</div>
		{:else if preview.state.error}
			<div class="flex min-h-100 items-center justify-center">
				<StateDisplay type="error" size="large" message={preview.state.error} />
			</div>
		{:else if preview.state.schema}
			{#key preview.state.schema}
				<AppLayout
					schema={preview.state.schema}
					showViewer={!!preview.state.schema.viewerOptions?.enableLocal && !isInRhinoPanel()}
					meshes={preview.displayMeshes}
					isSolving={preview.isSolving}
					showSolvingIndicator={preview.state.schema.instanceSolve !== false &&
						solvingIndicator.show}
					solvingIndicatorPlacement={isRhinoPanel() ? 'inline' : 'floating'}
					solveMessages={isRhinoPanel() ? solveMessages : undefined}
					hasPendingChanges={preview.hasPendingChanges}
					bind:isViewerFullscreen
					values={preview.values}
					onValueChange={preview.handleValueChange}
					oncalculate={preview.handleCalculate}
					onLoadValues={preview.handleLoadValues}
				/>
			{/key}
		{/if}
	</div>

	{#if preview.notification}
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
			<span class="font-medium">{preview.notification}</span>
		</div>
	{/if}
</AppShell>

{#if !isRhinoPanel()}
	{@render solveMessages()}
{/if}

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
