<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Collapsible } from '@selvajs/ui';
	import { ChevronDown } from '@lucide/svelte';
	import { usePersisted } from '#lib/composables/usePersisted.svelte.js';
	import { getSectionOpeners } from '../reveal.js';

	interface Props {
		/** Stable id; the open/closed state is remembered under it. */
		id: string;
		title: string;
		description?: string;
		/** A plain label with no chevron, for groups short enough to stay open. */
		collapsible?: boolean;
		/** Marks the whole group, so its rows need no chip each. */
		badge?: Snippet;
		children: Snippet;
	}

	let { id, title, description, collapsible = true, badge, children }: Props = $props();

	// The storage key is read once; `id` is fixed for the component's lifetime.
	// svelte-ignore state_referenced_locally
	const open = usePersisted(`builder.section.open:${id}`, true);

	const openers = getSectionOpeners();
	$effect(() => {
		openers.set(id, () => (open.value = true));
		return () => openers.delete(id);
	});
</script>

{#snippet heading()}
	<div class="flex min-w-0 flex-col gap-0.5">
		<div class="flex items-center gap-2">
			<h3 class="text-muted-foreground text-xs font-semibold tracking-wider uppercase">{title}</h3>
			{@render badge?.()}
		</div>
		{#if description}
			<p class="text-muted-foreground text-xs">{description}</p>
		{/if}
	</div>
{/snippet}

<div data-settings-section={id} class="border-border border-b last:border-b-0">
	{#if collapsible}
		<Collapsible.Root bind:open={open.value}>
			<Collapsible.Trigger>
				{#snippet child({ props })}
					<button
						{...props}
						class="group/section flex w-full items-start justify-between gap-3 pt-5 pb-3 text-left"
					>
						{@render heading()}
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
				<div class="flex flex-col gap-5 pb-5">
					{@render children()}
				</div>
			</Collapsible.Content>
		</Collapsible.Root>
	{:else}
		<div class="pt-5 pb-3">{@render heading()}</div>
		<div class="flex flex-col gap-5 pb-5">
			{@render children()}
		</div>
	{/if}
</div>
