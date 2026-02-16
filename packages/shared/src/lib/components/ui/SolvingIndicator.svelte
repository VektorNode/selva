<script lang="ts">
	interface Props {
		show: boolean;
	}

	let { show }: Props = $props();
</script>

{#if show}
	<!-- Full-width top progress bar -->
	<div class="pointer-events-none fixed inset-x-0 top-0 z-50">
		<div class="h-1 w-full overflow-hidden bg-primary/20">
			<div class="h-full bg-primary animate-[selva-sweep_1.2s_ease-in-out_infinite]"></div>
		</div>
	</div>

	<!-- Prominent toast in bottom-left -->
	<div
		class="fixed bottom-6 left-6 z-50 flex animate-[selva-slideInLeft_0.2s_ease-out] items-center gap-3 rounded-lg border border-primary/20 bg-primary px-5 py-3 text-primary-foreground shadow-xl"
	>
		<div class="relative flex h-5 w-5 shrink-0 items-center justify-center">
			<div class="absolute h-full w-full animate-ping rounded-full bg-primary-foreground opacity-30"></div>
			<div class="h-3 w-3 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent"></div>
		</div>
		<div class="flex flex-col leading-tight">
			<span class="text-sm font-semibold">Solving</span>
			<span class="text-xs opacity-70">Grasshopper is calculating...</span>
		</div>
	</div>
{/if}

<style>
	@keyframes selva-slideInLeft {
		from {
			transform: translateX(-110%);
			opacity: 0;
		}
		to {
			transform: translateX(0);
			opacity: 1;
		}
	}

	@keyframes selva-sweep {
		0% {
			width: 0%;
			margin-left: 0%;
		}
		50% {
			width: 60%;
			margin-left: 20%;
		}
		100% {
			width: 0%;
			margin-left: 100%;
		}
	}
</style>
