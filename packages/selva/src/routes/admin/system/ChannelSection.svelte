<script lang="ts">
	import { untrack } from 'svelte';
	import { Button, Callout, Card } from '@selvajs/ui';
	import { FlaskConical, ShieldCheck } from '@lucide/svelte';
	import { enhance } from '$app/forms';

	interface Props {
		/** The persisted channel. */
		channel: 'stable' | 'beta';
		/** Disable controls while an update is mid-flight. */
		disabled?: boolean;
	}

	let { channel, disabled = false }: Props = $props();

	// Local selection the radios mutate; the form submits it. Intentionally a
	// one-time snapshot of the persisted `channel` (untrack makes that explicit).
	// The parent keys this component on `channel` ({#key data.channel}), so a
	// confirmed switch remounts it and re-seeds the selection.
	let selected = $state(untrack(() => channel));

	let saving = $state(false);

	let dirty = $derived(selected !== channel);
</script>

<Card.Root>
	<Card.Header>
		<div class="flex items-start justify-between gap-3">
			<Card.Title>Release channel</Card.Title>
			<span
				class="rounded-full border px-2 py-0.5 font-mono text-xs {channel === 'beta'
					? 'border-warning/40 bg-warning/10 text-warning'
					: 'border-border bg-muted text-muted-foreground'}"
				title="The channel this deployment currently tracks"
			>
				{channel === 'beta' ? 'Beta' : 'Stable'}
			</span>
		</div>
		<Card.Description>
			Which published line of @selvajs/* this instance updates to. Switching here only changes the
			channel — run an update afterwards to install from it.
		</Card.Description>
	</Card.Header>
	<Card.Content class="space-y-4">
		<form
			method="POST"
			action="?/setChannel"
			use:enhance={() => {
				saving = true;
				return async ({ update }) => {
					await update({ reset: false });
					saving = false;
				};
			}}
		>
			<div class="grid gap-3 sm:grid-cols-2">
				<label
					class="flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 transition-colors {selected ===
					'stable'
						? 'border-primary bg-primary/5'
						: 'border-border hover:bg-muted/50'}"
				>
					<input
						type="radio"
						name="channel"
						value="stable"
						bind:group={selected}
						{disabled}
						class="sr-only"
					/>
					<ShieldCheck class="text-success mt-0.5 h-5 w-5 shrink-0" />
					<div class="min-w-0">
						<p class="text-sm font-medium">Stable</p>
						<p class="text-muted-foreground mt-0.5 text-xs">
							Production releases (npm <code class="font-mono">latest</code>). The default.
						</p>
					</div>
				</label>

				<label
					class="flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 transition-colors {selected ===
					'beta'
						? 'border-primary bg-primary/5'
						: 'border-border hover:bg-muted/50'}"
				>
					<input
						type="radio"
						name="channel"
						value="beta"
						bind:group={selected}
						{disabled}
						class="sr-only"
					/>
					<FlaskConical class="text-warning mt-0.5 h-5 w-5 shrink-0" />
					<div class="min-w-0">
						<p class="text-sm font-medium">Beta</p>
						<p class="text-muted-foreground mt-0.5 text-xs">
							Pre-release builds (npm <code class="font-mono">beta</code>). Early features, less
							tested.
						</p>
					</div>
				</label>
			</div>

			{#if selected === 'beta'}
				<Callout tone="warning" class="mt-3">
					Beta builds may be unstable. You can revert to Stable here at any time and run an update
					to roll back to the latest stable release.
				</Callout>
			{/if}

			<div class="mt-4 flex items-center gap-3">
				<Button type="submit" disabled={!dirty || saving || disabled}>
					{saving ? 'Saving…' : 'Save channel'}
				</Button>
				{#if dirty}
					<span class="text-muted-foreground text-xs">
						Switches to <span class="font-medium">{selected === 'beta' ? 'Beta' : 'Stable'}</span> — run
						an update to apply.
					</span>
				{/if}
			</div>
		</form>
	</Card.Content>
</Card.Root>
