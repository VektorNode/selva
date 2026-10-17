<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Collapsible } from '@selvajs/ui';
	import { ChevronDown } from '@lucide/svelte';
	import { usePersisted } from '$lib/composables/usePersisted.svelte';

	interface Props {
		/** Stable id; the open/closed state is remembered under it. */
		id: string;
		title: string;
		description?: string;
		children: Snippet;
	}

	let { id, title, description, children }: Props = $props();

	// The storage key is read once; `id` is fixed for the component's lifetime.
	// svelte-ignore state_referenced_locally
	const open = usePersisted(`builder.section.open:${id}`, true);
</script>

<div class="border-border border-b last:border-b-0">
	<Collapsible.Root bind:open={open.value}>
		<Collapsible.Trigger>
			{#snippet child({ props })}
				<button
					{...props}
					class="group/section flex w-full items-start justify-between gap-3 py-3 text-left"
				>
					<div class="flex min-w-0 flex-col gap-0.5">
						<h3 class="text-foreground text-sm font-semibold">{title}</h3>
						{#if description}
							<p class="text-muted-foreground text-xs">{description}</p>
						{/if}
					</div>
					<ChevronDown
						size={16}
						class="text-muted-foreground group-hover/section:text-foreground mt-0.5 shrink-0 transition-transform duration-200 {open.value
							? 'rotate-180'
							: ''}"
					/>
				</button>
			{/snippet}
		</Collapsible.Trigger>
		<Collapsible.Content>
			<div class="flex flex-col gap-4 pb-4">
				{@render children()}
			</div>
		</Collapsible.Content>
	</Collapsible.Root>
</div>
