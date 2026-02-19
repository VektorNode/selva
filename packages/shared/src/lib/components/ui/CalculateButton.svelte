<script lang="ts">
	import { Button } from './button/index.js';

	interface Props {
		hasPendingChanges: boolean;
		isSolving: boolean;
		oncalculate: () => void;
	}

	let { hasPendingChanges, isSolving, oncalculate }: Props = $props();
</script>

<div class="sticky bottom-0 mt-6 bg-background/80 pb-2 backdrop-blur-sm">
	<div class="flex justify-center">
		<Button
			variant={hasPendingChanges ? 'default' : 'outline'}
			size="lg"
			onclick={oncalculate}
			disabled={!hasPendingChanges || isSolving}
			class="w-full max-w-xs shadow-lg transition-all duration-200 {hasPendingChanges && !isSolving
				? 'ring-2 ring-primary ring-offset-2 animate-[selva-pending-pulse_2s_ease-in-out_infinite]'
				: ''}"
		>
			{#if isSolving}
				<div
					class="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent"
				></div>
				Solving...
			{:else if hasPendingChanges}
				<svg class="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M13 10V3L4 14h7v7l9-11h-7z"
					/>
				</svg>
				Calculate
			{:else}
				<svg class="mr-2 h-4 w-4 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M5 13l4 4L19 7"
					/>
				</svg>
				Up to date
			{/if}
		</Button>
	</div>
</div>

<style>
	@keyframes selva-pending-pulse {
		0%,
		100% {
			box-shadow: 0 0 0 0 hsl(var(--primary) / 0.4);
		}
		50% {
			box-shadow: 0 0 0 6px hsl(var(--primary) / 0);
		}
	}


</style>
