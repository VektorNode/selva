<script lang="ts">
	interface Props {
		show: boolean;
	}

	let { show }: Props = $props();
</script>

{#if show}
	<!-- Prominent toast in bottom-left -->
	<div
		class="bottom-6 left-6 gap-3 px-5 py-3 shadow-xl fixed z-50 flex animate-[selva-slideInLeft_0.2s_ease-out] items-center rounded-lg border border-primary/20 bg-primary text-primary-foreground"
	>
		<div class="h-5 w-5 relative flex shrink-0 items-center justify-center">
			<div
				class="animate-ping absolute h-full w-full rounded-full bg-primary-foreground opacity-30"
			></div>
			<div
				class="h-3 w-3 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent"
			></div>
		</div>
		<div class="leading-tight flex flex-col">
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
