<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { PageContainer, PageHeader, StateDisplay, Card } from '@selvajs/shared';
	import { Wrench, Play } from '@lucide/svelte';
	import { SvelteURLSearchParams } from 'svelte/reactivity';

	var sessionId = page.url.searchParams.get('session');
	var wsPort = page.url.searchParams.get('wsPort');

	function navigateTo(path: string) {
		const params = new SvelteURLSearchParams();
		if (sessionId) params.set('session', sessionId);
		if (wsPort) params.set('wsPort', wsPort);
		goto(`/${path}?${params.toString()}`, { noScroll: true }).catch(() => {});
	}
</script>

<PageContainer background="white">
	<PageHeader title="Selva" showModeToggle={true} />
	{#if !sessionId}
		<div class="flex flex-1 items-center justify-center">
			<StateDisplay
				type="error"
				size="large"
				title="No Session ID"
				message="No session ID provided in URL. Please start from the Grasshopper component."
			/>
		</div>
	{:else}
		<div class="mx-auto w-full max-w-4xl flex-1 p-12">
			<h2 class="text-foreground mb-4 text-4xl font-bold">Welcome to Selva</h2>
			<p class="text-muted-foreground mb-8 text-lg">Choose a mode to get started:</p>

			<div class="grid grid-cols-1 gap-6 md:grid-cols-2">
				<button onclick={() => navigateTo('builder')} class="text-left">
					<Card.Root
						class="hover:border-primary h-full transform border-2 p-8 transition-all hover:-translate-y-1 hover:shadow-lg"
					>
						<Card.Header class="mb-3 p-0">
							<Card.Title class="flex items-center gap-2 text-2xl">
								<Wrench class="h-6 w-6" />Schema Builder
							</Card.Title>
						</Card.Header>
						<Card.Content class="p-0">
							<p class="text-muted-foreground leading-relaxed">
								Configure your UI schema by selecting inputs and outputs from your Grasshopper
								definition
							</p>
						</Card.Content>
					</Card.Root>
				</button>

				<button onclick={() => navigateTo('preview')} class="text-left">
					<Card.Root
						class="hover:border-primary h-full transform border-2 p-8 transition-all hover:-translate-y-1 hover:shadow-lg"
					>
						<Card.Header class="mb-3 p-0">
							<Card.Title class="flex items-center gap-2 text-2xl">
								<Play class="h-6 w-6" />Interactive Preview
							</Card.Title>
						</Card.Header>
						<Card.Content class="p-0">
							<p class="text-muted-foreground leading-relaxed">
								Interact with your Grasshopper definition in real-time with live parameter updates
							</p>
						</Card.Content>
					</Card.Root>
				</button>
			</div>
		</div>
	{/if}
</PageContainer>
