<script lang="ts">
	import { Button, Callout, Dialog, Input, Label, toast, ConfirmDialog } from '@selvajs/ui';
	import { Copy, TriangleAlert, Check } from '@lucide/svelte';
	import { DEFAULT_SHARE_LINK_MAX_SOLVES } from '@selvajs/platform';

	type DefinitionChannel = 'live' | 'draft';

	interface Props {
		definitionGuid: string;
		open: boolean;
		onOpenChange: (open: boolean) => void;
		onMinted: () => void;
	}

	let { definitionGuid, open, onOpenChange, onMinted }: Props = $props();

	// Form state
	let channel = $state<DefinitionChannel>('live');
	let allowSolve = $state(true);
	let label = $state('');
	let expiresEnabled = $state(false);
	let expiresAt = $state('');
	let capEnabled = $state(true);
	let cap = $state(DEFAULT_SHARE_LINK_MAX_SOLVES);

	let creating = $state(false);
	let mintedToken = $state<string | null>(null);
	let mintedShareUrl = $state<string | null>(null);
	let copied = $state(false);
	let confirmingHighCap = $state(false);
	let confirmingUncapped = $state(false);

	$effect(() => {
		if (!open) reset();
	});

	function reset() {
		channel = 'live';
		allowSolve = true;
		label = '';
		expiresEnabled = false;
		expiresAt = '';
		capEnabled = true;
		cap = DEFAULT_SHARE_LINK_MAX_SOLVES;
		mintedToken = null;
		mintedShareUrl = null;
		copied = false;
	}

	function submit() {
		if (capEnabled && cap > DEFAULT_SHARE_LINK_MAX_SOLVES) {
			confirmingHighCap = true;
			return;
		}
		if (!capEnabled) {
			confirmingUncapped = true;
			return;
		}
		createLink();
	}

	async function createLink() {
		creating = true;
		try {
			const body = {
				channel,
				allowSolve,
				...(label.trim() ? { name: label.trim() } : {}),
				maxSolves: capEnabled ? cap : null,
				...(expiresEnabled && expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {})
			};
			const res = await fetch(`/api/v1/definitions/${definitionGuid}/share-links`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				toast.error(err.message || err.error || 'Failed to mint share link');
				return;
			}
			const data = (await res.json()) as { token: string; link: { id: string } };
			mintedToken = data.token;
			mintedShareUrl = `${window.location.origin}/library/${definitionGuid}?token=${data.token}`;
			confirmingHighCap = false;
			confirmingUncapped = false;
			onMinted();
		} catch {
			toast.error('Failed to mint share link');
		} finally {
			creating = false;
		}
	}

	async function copyUrl() {
		if (!mintedShareUrl) return;
		try {
			await navigator.clipboard.writeText(mintedShareUrl);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			toast.error('Could not copy to clipboard');
		}
	}
</script>

<Dialog.Root {open} {onOpenChange}>
	<Dialog.Content class="max-w-lg">
		{#if !mintedToken}
			<Dialog.Header>
				<Dialog.Title>New share link</Dialog.Title>
				<Dialog.Description>
					Anyone with the link gets the access you configure here. Caps and expiry are the
					load-bearing protection — they assume the URL will eventually leak.
				</Dialog.Description>
			</Dialog.Header>

			<div class="mt-4 space-y-4">
				<div class="space-y-1.5">
					<Label for="sl-channel">Channel</Label>
					<select
						id="sl-channel"
						bind:value={channel}
						class="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
					>
						<option value="live">Live — recipients see the published version</option>
						<option value="draft">Draft — recipients see the unpublished version</option>
					</select>
					{#if channel === 'draft'}
						<p class="text-warning flex items-start gap-1.5 text-xs">
							<TriangleAlert class="mt-0.5 h-3 w-3 shrink-0" />
							Draft links expose the unpublished version. Use only for reviewers.
						</p>
					{/if}
				</div>

				<div class="space-y-1.5">
					<Label for="sl-label">Label (optional)</Label>
					<Input id="sl-label" bind:value={label} placeholder="e.g. Demo for Acme" />
				</div>

				<div class="border-border rounded-md border p-3">
					<label class="flex cursor-pointer items-start gap-3">
						<input type="checkbox" bind:checked={allowSolve} class="mt-0.5 shrink-0" />
						<div class="min-w-0">
							<p class="text-sm font-medium">Allow solve</p>
							<p class="text-muted-foreground mt-0.5 text-xs">
								When off, recipients can view the schema and parameters but can't run solves. When
								on, every solve counts against the cap.
							</p>
						</div>
					</label>
				</div>

				<div class="border-border rounded-md border p-3">
					<label class="flex cursor-pointer items-start gap-3">
						<input type="checkbox" bind:checked={capEnabled} class="mt-0.5 shrink-0" />
						<div class="min-w-0 flex-1">
							<p class="text-sm font-medium">Cap total solves</p>
							<p class="text-muted-foreground mt-0.5 text-xs">
								Default {DEFAULT_SHARE_LINK_MAX_SOLVES.toLocaleString()}. Recommended. Uncapped
								links are a denial-of-wallet risk if leaked.
							</p>
						</div>
					</label>
					{#if capEnabled}
						<div class="mt-2 ml-6">
							<Input type="number" min={1} bind:value={cap} class="h-8 w-32 text-sm" />
						</div>
					{/if}
				</div>

				<div class="border-border rounded-md border p-3">
					<label class="flex cursor-pointer items-start gap-3">
						<input type="checkbox" bind:checked={expiresEnabled} class="mt-0.5 shrink-0" />
						<div class="min-w-0 flex-1">
							<p class="text-sm font-medium">Set expiry</p>
							<p class="text-muted-foreground mt-0.5 text-xs">
								The link stops working after this date. Off = never expires.
							</p>
						</div>
					</label>
					{#if expiresEnabled}
						<div class="mt-2 ml-6">
							<input
								type="datetime-local"
								bind:value={expiresAt}
								class="border-input bg-background h-8 rounded-md border px-2 text-sm"
							/>
						</div>
					{/if}
				</div>
			</div>

			<Dialog.Footer class="mt-4">
				<Button variant="outline" onclick={() => onOpenChange(false)}>Cancel</Button>
				<Button
					onclick={submit}
					disabled={creating || (expiresEnabled && !expiresAt) || (capEnabled && cap < 1)}
				>
					{creating ? 'Creating…' : 'Create link'}
				</Button>
			</Dialog.Footer>
		{:else}
			<Dialog.Header>
				<Dialog.Title>Share link ready</Dialog.Title>
				<Dialog.Description>
					Copy the link now — this is the only time you'll see it. The server stores only a hash; we
					cannot show it again.
				</Dialog.Description>
			</Dialog.Header>

			<div class="mt-4 space-y-3">
				<Callout tone="warning">
					This URL grants the configured access to anyone who receives it. Treat it like a password
					— revoke it immediately if it's compromised.
				</Callout>

				<div class="border-border bg-muted/40 rounded-md border p-3">
					<p class="text-muted-foreground mb-2 text-xs font-medium tracking-wider uppercase">
						Share URL
					</p>
					<div class="flex items-start gap-2">
						<code class="bg-background min-w-0 flex-1 rounded p-2 font-mono text-xs break-all"
							>{mintedShareUrl}</code
						>
						<Button
							size="sm"
							variant={copied ? 'default' : 'outline'}
							onclick={copyUrl}
							class="shrink-0"
						>
							{#if copied}
								<Check class="mr-1.5 h-3.5 w-3.5" />
								Copied
							{:else}
								<Copy class="mr-1.5 h-3.5 w-3.5" />
								Copy
							{/if}
						</Button>
					</div>
				</div>
			</div>

			<Dialog.Footer class="mt-4">
				<Button onclick={() => onOpenChange(false)}>Done</Button>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<ConfirmDialog
	bind:open={confirmingHighCap}
	title="Raise the solve cap?"
	description={`You're raising the cap above the default of ${DEFAULT_SHARE_LINK_MAX_SOLVES}. An uncapped or high-cap link is a denial-of-wallet vector if leaked.`}
	confirmLabel="Continue"
	pendingLabel="Creating…"
	variant="destructive"
	onConfirm={createLink}
/>

<ConfirmDialog
	bind:open={confirmingUncapped}
	title="Remove the solve cap?"
	description="Removing the cap means an unlimited number of solves on this link. Recommended only for trusted recipients."
	confirmLabel="Continue"
	pendingLabel="Creating…"
	variant="destructive"
	onConfirm={createLink}
/>
