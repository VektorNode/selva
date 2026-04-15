<script lang="ts">
	import { Circle } from '@lucide/svelte';
	import type { HealthStatus, ComputeInfo } from '$lib/composables/useComputeHealth.svelte';

	interface Props {
		health: HealthStatus;
		compute: ComputeInfo;
	}

	let { health, compute }: Props = $props();

	const statusConfig = {
		ok: { label: 'Online', color: 'text-green-600 dark:text-green-400' },
		warning: { label: 'Warning', color: 'text-yellow-600 dark:text-yellow-400' },
		error: { label: 'Offline', color: 'text-red-600 dark:text-red-400' },
		checking: { label: 'Checking', color: 'text-blue-600 dark:text-blue-400' },
		starting: { label: 'Starting', color: 'text-yellow-600 dark:text-yellow-400' }
	};

	const config = $derived(statusConfig[health.state]);

	const tooltip = $derived(() => {
		const parts: string[] = [];
		parts.push(health.message);
		if (health.reachable) {
			if (compute.rhinoVersion) parts.push(`Rhino v${compute.rhinoVersion}`);
			if (compute.computeVersion) parts.push(`Compute v${compute.computeVersion}`);
			if (compute.selvaInstalled && compute.selvaVersion) {
				parts.push(`Selva v${compute.selvaVersion}`);
			} else if (!compute.selvaInstalled) {
				parts.push('Selva plugin not installed');
			}
		}

		return parts.join(' · ');
	});
</script>

<div class="flex items-center gap-3" title={tooltip()}>
	<!-- Status indicator -->
	<div class="flex items-center gap-1.5">
		<Circle class="h-2.5 w-2.5 shrink-0 fill-current {config.color}" />
		<span class="text-xs font-medium {config.color}">{config.label}</span>
	</div>

	<!-- Desktop: Show all details with dividers -->
	<div class="hidden items-center gap-3 sm:flex">
		<!-- Rhino version -->
		{#if compute.rhinoVersion}
			<div class="border-border text-muted-foreground border-l pl-3 text-xs">
				<span>Rhino {compute.rhinoVersion}</span>
			</div>
		{/if}

		<!-- Compute version -->
		{#if compute.computeVersion}
			<div class="border-border text-muted-foreground border-l pl-3 text-xs">
				<span>Compute {compute.computeVersion}</span>
			</div>
		{/if}

		<!-- Selva plugin status (only show when server is reachable) -->
		{#if health.reachable}
			<div class="border-border border-l pl-3">
				{#if compute.selvaInstalled}
					<span class="text-muted-foreground text-xs">
						Selva {compute.selvaVersion}
					</span>
				{:else}
					<span class="text-xs font-medium text-red-600 dark:text-red-400"> Selva missing </span>
				{/if}
			</div>
		{/if}
	</div>
</div>
