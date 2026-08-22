<script lang="ts">
	import * as AlertDialog from './primitives/alert-dialog/index.js';

	let {
		open = $bindable(false),
		title,
		description,
		confirmLabel = 'Continue',
		pendingLabel,
		cancelLabel = 'Cancel',
		variant = 'default',
		onConfirm
	}: {
		open?: boolean;
		title: string;
		description?: string;
		confirmLabel?: string;
		pendingLabel?: string;
		cancelLabel?: string;
		variant?: 'default' | 'destructive';
		onConfirm: () => void | Promise<void>;
	} = $props();

	let pending = $state(false);

	async function handleConfirm() {
		pending = true;
		try {
			await onConfirm();
		} finally {
			pending = false;
		}
	}
</script>

<AlertDialog.Root bind:open onOpenChange={(next) => !pending && (open = next)}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>{title}</AlertDialog.Title>
			{#if description}
				<AlertDialog.Description class={variant === 'destructive' ? 'text-destructive' : undefined}>
					{description}
				</AlertDialog.Description>
			{/if}
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel disabled={pending}>{cancelLabel}</AlertDialog.Cancel>
			<AlertDialog.Action
				onclick={handleConfirm}
				disabled={pending}
				class={variant === 'destructive'
					? 'text-destructive-foreground bg-destructive hover:bg-destructive/90'
					: undefined}
			>
				{pending ? (pendingLabel ?? confirmLabel) : confirmLabel}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
