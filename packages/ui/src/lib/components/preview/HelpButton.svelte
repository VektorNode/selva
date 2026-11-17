<script lang="ts">
	import { HelpCircle } from '@lucide/svelte';
	import * as Dialog from '#lib/components/primitives/dialog/index.js';
	import { formatMessage } from '#lib/i18n/messages.js';

	interface Props {
		/** The field's label: the dialog title. */
		label: string;
		description: string;
		/**
		 * The button's accessible name, `{label}` filled in. Named by the bare label, a screen
		 * reader hears the field's name twice and a lookup by label finds two controls.
		 */
		nameTemplate?: string;
	}

	let { label, description, nameTemplate = 'Help for {label}' }: Props = $props();
</script>

<!-- Every field has one, so a column of them is noise. Where a fine pointer can hover, it shows
     only while the pointer or focus is inside the enclosing `group/field`; touch keeps it visible.
     The box is 24px, touch gets a 44px hit area, and the negative margin keeps the label row from
     growing. -->
<Dialog.Root>
	<Dialog.Trigger>
		{#snippet child({ props })}
			<button
				{...props}
				class="-m-1 size-6 pointer-coarse:after:-inset-2.5 relative flex shrink-0 cursor-help items-center justify-center rounded-sm text-muted-foreground transition hover:text-foreground pointer-coarse:after:absolute pointer-fine:opacity-0 pointer-fine:group-focus-within/field:opacity-100 pointer-fine:group-hover/field:opacity-100 pointer-fine:focus-visible:opacity-100"
				aria-label={formatMessage(nameTemplate, { label })}
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
