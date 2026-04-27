<script lang="ts">
	import { Button } from './button';
	import { Zap, Check, Loader, Play } from '@lucide/svelte';

	interface Props {
		hasPendingChanges: boolean;
		hasNeverSolved?: boolean;
		isSolving: boolean;
		oncalculate: () => void;
	}

	let { hasPendingChanges, hasNeverSolved = false, isSolving, oncalculate }: Props = $props();
</script>

<div class="bottom-0 mt-3 pb-3 pt-2 backdrop-blur-sm px-2 sticky border-t border-border/50">
	<Button
		variant={hasPendingChanges ? 'default' : 'ghost'}
		size="lg"
		onclick={() => !isSolving && oncalculate()}
		disabled={!hasPendingChanges && !isSolving}
		aria-busy={isSolving}
		class="gap-2 font-medium w-full transition-all duration-200
			{hasPendingChanges && !isSolving ? 'selva-pending-pulse shadow-md' : ''}
			{!hasPendingChanges && !isSolving ? 'text-muted-foreground' : ''}"
	>
		{#if isSolving}
			<Loader class="h-4 w-4 animate-spin" />
			Solving...
		{:else if hasNeverSolved}
			<Play class="h-4 w-4" />
			Press to calculate
		{:else if hasPendingChanges}
			<Zap class="h-4 w-4" />
			Calculate
		{:else}
			<Check class="h-4 w-4" />
			Up to date
		{/if}
	</Button>
</div>
