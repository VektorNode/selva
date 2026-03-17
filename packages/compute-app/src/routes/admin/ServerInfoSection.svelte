<script lang="ts">
	import { Card } from '@selva/shared';
	import { Circle } from '@lucide/svelte';
	import { useComputeHealth } from '$lib/composables/useComputeHealth.svelte';
	import { onMount, onDestroy } from 'svelte';

	const computeHealth = useComputeHealth();
	onMount(() => computeHealth.startPeriodicCheck(30000));
	onDestroy(() => computeHealth.stopPeriodicCheck());

	const statusConfig = {
		ok: { label: 'Online', color: 'text-green-600 dark:text-green-400' },
		warning: { label: 'Warning', color: 'text-yellow-600 dark:text-yellow-400' },
		error: { label: 'Offline', color: 'text-red-600 dark:text-red-400' },
		checking: { label: 'Checking', color: 'text-blue-600 dark:text-blue-400' }
	};

	const sc = $derived(statusConfig[computeHealth.health.state]);
	const pluginEntries = $derived(Object.entries(computeHealth.plugins));
</script>

<!-- Compute Server Status -->
<Card.Root>
	<Card.Header>
		<div class="flex items-center justify-between">
			<div>
				<Card.Title>Compute Server</Card.Title>
				<Card.Description>Rhino.Compute connection status and version info</Card.Description>
			</div>
			<div class="flex items-center gap-1.5">
				<Circle class="h-2.5 w-2.5 shrink-0 fill-current {sc.color}" />
				<span class="text-xs font-medium {sc.color}">{sc.label}</span>
			</div>
		</div>
	</Card.Header>
	<Card.Content>
		<p class="text-muted-foreground mb-4 text-sm">{computeHealth.health.message}</p>
		<div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
			<div class="bg-muted/40 rounded-md p-3">
				<p class="text-muted-foreground text-xs">Rhino</p>
				<p class="mt-0.5 text-sm font-medium">{computeHealth.compute.rhinoVersion ?? '—'}</p>
			</div>
			<div class="bg-muted/40 rounded-md p-3">
				<p class="text-muted-foreground text-xs">Compute</p>
				<p class="mt-0.5 text-sm font-medium">{computeHealth.compute.computeVersion ?? '—'}</p>
			</div>
			<div class="bg-muted/40 rounded-md p-3">
				<p class="text-muted-foreground text-xs">Selva Plugin</p>
				<p class="mt-0.5 text-sm font-medium">
					{#if computeHealth.compute.selvaInstalled}
						{computeHealth.compute.selvaVersion}
					{:else}
						<span class="text-red-600 dark:text-red-400">Not installed</span>
					{/if}
				</p>
			</div>
		</div>
	</Card.Content>
</Card.Root>

<!-- Installed GH Plugins -->
<Card.Root>
	<Card.Header>
		<Card.Title>Installed Grasshopper Plugins</Card.Title>
		<Card.Description>Plugins available on the Compute server</Card.Description>
	</Card.Header>
	<Card.Content>
		{#if computeHealth.health.state === 'checking'}
			<p class="text-muted-foreground text-sm">Loading…</p>
		{:else if !computeHealth.health.reachable}
			<p class="text-muted-foreground text-sm">Unavailable — compute server is offline</p>
		{:else if pluginEntries.length === 0}
			<p class="text-muted-foreground text-sm">No plugins found</p>
		{:else}
			<div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
				{#each pluginEntries as [name, version] (name)}
					<div class="bg-muted/40 flex items-center justify-between rounded-md px-3 py-2">
						<span class="text-sm font-medium">{name}</span>
						<span class="text-muted-foreground text-xs">{version}</span>
					</div>
				{/each}
			</div>
		{/if}
	</Card.Content>
</Card.Root>
