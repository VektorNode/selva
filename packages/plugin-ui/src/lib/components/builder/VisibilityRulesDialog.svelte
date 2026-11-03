<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Dialog } from '@selvajs/ui';
	import { Eye, EyeOff } from '@lucide/svelte';

	interface Props {
		/** Names the thing the rules belong to, for the dialog title. */
		subject: string;
		ruleCount: number;
		alwaysHidden?: boolean;
		/** `compact` fits an item card's header row; the default fits a group header. */
		compact?: boolean;
		children: Snippet;
	}

	let { subject, ruleCount, alwaysHidden = false, compact = false, children }: Props = $props();

	let open = $state(false);
	const active = $derived(ruleCount > 0 || alwaysHidden);
</script>

<!-- A dialog, not a popover: the rule rows open their own dropdowns, and a dropdown nested in a
     popover loses its outside-click dismissal. -->
<button
	type="button"
	class="hover:bg-hover relative flex shrink-0 items-center justify-center rounded-sm {compact
		? 'h-6 w-6'
		: 'size-9 rounded-md'} {active
		? 'text-primary'
		: 'text-muted-foreground hover:text-foreground'}"
	aria-label={compact ? 'Visibility rules' : 'Group visibility rules'}
	title="Visibility rules"
	onclick={() => (open = true)}
>
	{#if alwaysHidden}<EyeOff size={compact ? 14 : 16} />{:else}<Eye size={compact ? 14 : 16} />{/if}
	{#if ruleCount > 0}
		<span
			class="bg-primary text-primary-foreground absolute flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-1 text-[9px] leading-none {compact
				? '-top-0.5 -right-0.5'
				: 'top-0.5 right-0.5'}"
		>
			{ruleCount}
		</span>
	{/if}
</button>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-2xl">
		<Dialog.Header>
			<Dialog.Title>Visibility rules</Dialog.Title>
			<Dialog.Description>{subject}</Dialog.Description>
		</Dialog.Header>
		{@render children()}
	</Dialog.Content>
</Dialog.Root>
