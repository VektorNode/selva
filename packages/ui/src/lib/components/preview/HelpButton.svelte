<script lang="ts">
	import { HelpCircle } from '@lucide/svelte';
	import * as Dialog from '$lib/components/primitives/dialog';

	interface Props {
		/** The field's label: the dialog title and the button's accessible name. */
		label: string;
		description: string;
	}

	let { label, description }: Props = $props();
</script>

<!-- Every field has one, so a column of them is noise. Where a fine pointer can hover, it shows
     only while the pointer or focus is inside the enclosing `group/field`; touch keeps it visible. -->
<Dialog.Root>
	<Dialog.Trigger>
		{#snippet child({ props })}
			<button
				{...props}
				class="-m-1 p-1 shrink-0 cursor-help rounded-sm text-muted-foreground transition hover:text-foreground pointer-fine:opacity-0 pointer-fine:group-focus-within/field:opacity-100 pointer-fine:group-hover/field:opacity-100 pointer-fine:focus-visible:opacity-100"
				aria-label={label}
			>
				<HelpCircle class="size-3.5" />
			</button>
		{/snippet}
	</Dialog.Trigger>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{label}</Dialog.Title>
			<Dialog.Description>{description}</Dialog.Description>
		</Dialog.Header>
	</Dialog.Content>
</Dialog.Root>
