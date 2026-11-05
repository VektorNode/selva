<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { AppShell, StateDisplay } from '@selvajs/ui';
	import { getGroups, type UISchema } from '@selvajs/schemas';
	import { buildSessionParams, getWebSocketPortFromUrl, isPlayerUrl } from '#lib/utils/session.js';
	import { currentRole } from '#lib/utils/session-role.svelte.js';
	import { rhinoShellProps } from '#lib/utils/rhino-host.svelte.js';
	import { getGrasshopperSource } from '#lib/schema-source/grasshopper-source.js';
	import { rememberBridgeSecret } from '#lib/websocket/bridge-secret.js';
	import type { WsInitialDataMessage } from '#lib/websocket/websocket.svelte.js';

	const sessionId = page.url.searchParams.get('session');
	let error = $state<string | null>(null);

	// The redirect drops the URL fragment, and can run before the layout has stored the secret it
	// carries, so store it here first.
	function go(route: 'builder' | 'preview') {
		if (sessionId) rememberBridgeSecret(sessionId);
		goto(`/${route}?${buildSessionParams()}`, { replace: true, reset: false }).catch(() => {});
	}

	function hasLayoutItems(schema: UISchema | undefined): boolean {
		return !!schema && getGroups(schema).some((group) => (group.items?.length ?? 0) > 0);
	}

	// A player lands on the preview. An author lands on the builder until the UI has something
	// in it, then on the preview.
	onMount(() => {
		if (!sessionId) return;
		if (isPlayerUrl()) {
			go('preview');
			return;
		}

		const source = getGrasshopperSource(getWebSocketPortFromUrl());
		const onInitialData = (message: WsInitialDataMessage) => {
			source.off('initialData', onInitialData);
			go(hasLayoutItems(message.schema) ? 'preview' : 'builder');
		};
		source.on('initialData', onInitialData);

		source.connect(sessionId).then((result) => {
			if (!result.ok) {
				source.off('initialData', onInitialData);
				error = result.error;
			} else if (currentRole() === 'player') {
				source.off('initialData', onInitialData);
				go('preview');
			} else {
				// The route needs only the schema; the page it opens asks for the rest.
				source.requestInitialData(sessionId, { schemaOnly: true });
			}
		});

		return () => source.off('initialData', onInitialData);
	});
</script>

<AppShell {...rhinoShellProps()} homeUrl={`/?${buildSessionParams()}`} mode="fixed" showFooter>
	<div class="flex flex-1 items-center justify-center">
		{#if !sessionId}
			<StateDisplay
				type="error"
				size="large"
				title="No Session ID"
				message="No session ID provided in URL. Please start from the Grasshopper component."
			/>
		{:else if error}
			<StateDisplay type="error" size="large" message={error} />
		{:else}
			<StateDisplay type="loading" size="large" message="Connecting to Grasshopper..." />
		{/if}
	</div>
</AppShell>
