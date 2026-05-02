<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { AppShell, StateDisplay, Button, AppLayout, createSolvingIndicator, useFooterItem } from '@selvajs/ui';
	import { buildSessionParams } from '$lib/utils/session';
	import { usePreviewState } from '$lib/composables/usePreviewState.svelte';
	import WsStatusFooter from '$lib/components/WsStatusFooter.svelte';

	const sessionId = $derived(page.url.searchParams.get('session') || '');
	let isViewerFullscreen = $state(false);

	const preview = usePreviewState(() => sessionId);
	const solvingIndicator = createSolvingIndicator(() => preview.wsState.isSolving);

	$effect(() => {
		if (sessionId) {
			preview.initialize();
			return () => preview.cleanup();
		}
	});

	function navigateTo(route: '/' | '/builder') {
		goto(`${route}?${buildSessionParams()}`).catch(() => {});
	}

	const homeUrl = $derived(`/?${buildSessionParams()}`);

	useFooterItem(
		'ws-status',
		WsStatusFooter,
		() => ({ connected: preview.wsState.connected, sessionId }),
		'left',
		10
	);
</script>

<AppShell {homeUrl} title={preview.state.schema?.name ?? null} mode="fixed" showFooter>
	{#snippet navItems()}
		<Button variant="ghost" size="sm" onclick={() => navigateTo('/builder')}>
			Schema Builder
		</Button>
		<Button variant="default" size="sm">Interactive Preview</Button>
	{/snippet}
	{#snippet rightContent()}
		{#if preview.state.syncNeeded}
			<Button
				variant="default"
				size="sm"
				onclick={() => preview.syncParameters()}
				class="animate-pulse bg-amber-500 hover:bg-amber-600"
			>
				⚡ Sync Parameters
			</Button>
		{/if}
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
					meshes={preview.state.displayMeshes}
					isSolving={preview.wsState.isSolving}
					showSolvingIndicator={preview.state.schema.instanceSolve !== false && solvingIndicator.show}
					hasPendingChanges={preview.state.hasPendingChanges}
					bind:isViewerFullscreen
					bind:values={preview.state.values}
					onValueChange={preview.handleValueChange}
					oncalculate={preview.handleCalculate}
					onLoadValues={() => {
						if (preview.state.schema?.instanceSolve !== false) {
							preview.wsState.sendValueUpdate(sessionId, $state.snapshot(preview.state.values));
						} else {
							preview.state.hasPendingChanges = true;
						}
					}}
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
