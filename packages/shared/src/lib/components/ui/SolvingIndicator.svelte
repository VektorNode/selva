<script lang="ts">
	interface Props {
		show: boolean;
	}

	let { show }: Props = $props();
</script>

{#if show}
	<div
		class="bg-primary text-primary-foreground fixed bottom-8 left-8 z-50 flex animate-[selva-slideInLeft_0.3s_ease-out] items-center gap-3 rounded-lg px-4 py-3 shadow-lg"
	>
		<div
			class="border-primary-foreground h-4 w-4 animate-spin rounded-full border-2 border-t-transparent"
		></div>
		<span class="text-sm font-medium">Solving...</span>
	</div>
{/if}

<style>
	@keyframes selva-slideInLeft {
		from {
			transform: translateX(-100%);
			opacity: 0;
		}
		to {
			transform: translateX(0);
			opacity: 1;
		}
	}
</style>
