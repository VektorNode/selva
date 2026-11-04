<script lang="ts">
	import { Button, Dialog } from '@selvajs/ui';
	import type { SelvaUpload } from '#lib/composables/useSelvaUpload.svelte.js';
	import SelvaAccountSection from './SelvaAccountSection.svelte';

	interface Props {
		upload: SelvaUpload;
	}

	let { upload }: Props = $props();

	let body = $state<HTMLElement | null>(null);
</script>

<Dialog.Root
	open={upload.state.connectionOpen}
	onOpenChange={(open) => {
		if (!open) upload.closeConnection();
	}}
>
	<!-- Focus starts on the body, not its first button: that is Sign out, one stray Enter away. -->
	<Dialog.Content
		class="sm:max-w-lg"
		onOpenAutoFocus={(e) => {
			e.preventDefault();
			body?.focus();
		}}
	>
		<Dialog.Header>
			<Dialog.Title>Selva connection</Dialog.Title>
			<Dialog.Description>
				The Selva instance you upload to. The sign-in belongs to this computer and is never saved in
				the definition.
			</Dialog.Description>
		</Dialog.Header>

		<section
			bind:this={body}
			tabindex="-1"
			aria-label="Selva account"
			class="flex min-w-0 flex-col gap-3 outline-none"
		>
			<SelvaAccountSection {upload} />
		</section>

		<Dialog.Footer>
			{#if upload.available}
				<Button
					variant="outline"
					onclick={() => {
						upload.closeConnection();
						upload.open();
					}}
				>
					Upload this definition
				</Button>
			{/if}
			<Button onclick={upload.closeConnection}>Done</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
