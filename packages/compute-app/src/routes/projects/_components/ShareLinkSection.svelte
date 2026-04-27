<script lang="ts">
	import { Button, EmptyState, toast, AlertDialog } from '@selvajs/ui';
	import { Plus, Trash2, Link2, TriangleAlert } from '@lucide/svelte';
	import type { ShareLink } from '@selvajs/platform';
	import MintShareLinkDialog from './MintShareLinkDialog.svelte';

	type SafeShareLink = Omit<ShareLink, 'tokenHash'> & { hasToken: true };

	interface Props {
		definitionGuid: string;
	}

	let { definitionGuid }: Props = $props();

	let links = $state<SafeShareLink[]>([]);
	let loading = $state(true);
	let showMintDialog = $state(false);
	let confirmingRevoke = $state<SafeShareLink | null>(null);
	let revokingId = $state<string | null>(null);

	$effect(() => {
		void definitionGuid;
		loadLinks();
	});

	async function loadLinks() {
		loading = true;
		try {
			const res = await fetch(`/api/definitions/${definitionGuid}/share-links`);
			if (!res.ok) throw new Error(`${res.status}`);
			const data = (await res.json()) as { links: SafeShareLink[] };
			links = data.links;
		} catch {
			toast.error('Failed to load share links');
		} finally {
			loading = false;
		}
	}

	async function revoke(link: SafeShareLink) {
		revokingId = link.id;
		try {
			const res = await fetch(`/api/definitions/${definitionGuid}/share-links/${link.id}`, {
				method: 'DELETE'
			});
			if (!res.ok) {
				toast.error('Failed to revoke link');
				return;
			}
			toast.success('Link revoked');
			await loadLinks();
		} catch {
			toast.error('Failed to revoke link');
		} finally {
			revokingId = null;
			confirmingRevoke = null;
		}
	}

	function formatExpiry(iso?: string | null) {
		if (!iso) return 'Never';
		const date = new Date(iso);
		const now = new Date();
		const expired = date.getTime() < now.getTime();
		return { text: date.toLocaleDateString(), expired };
	}

	function formatRelative(iso: string) {
		const ms = Date.now() - new Date(iso).getTime();
		const minutes = Math.floor(ms / 60000);
		if (minutes < 1) return 'just now';
		if (minutes < 60) return `${minutes}m ago`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		if (days < 30) return `${days}d ago`;
		return new Date(iso).toLocaleDateString();
	}

	const activeLinks = $derived(links.filter((l) => !l.revokedAt));
</script>

<div class="space-y-4">
	<div>
		<h3 class="text-base font-semibold tracking-tight">Share links</h3>
		<p class="text-muted-foreground mt-1 text-xs">
			Per-definition tokens that grant access without an account. Use for client demos, embeds, and
			review links.
		</p>
	</div>

	{#if loading}
		<div class="border-border rounded-md border p-6 text-center">
			<p class="text-muted-foreground text-xs">Loading…</p>
		</div>
	{:else if activeLinks.length === 0}
		<EmptyState
			size="sm"
			icon={Link2}
			title="No share links yet"
			description="Mint a link to share this definition without requiring the recipient to have an account."
		>
			{#snippet actions()}
				<Button size="sm" onclick={() => (showMintDialog = true)}>
					<Plus class="mr-1.5 h-3.5 w-3.5" />
					New link
				</Button>
			{/snippet}
		</EmptyState>
	{:else}
		<div class="border-border bg-card overflow-hidden rounded-md border">
			<div
				class="border-border bg-muted/40 flex items-center justify-between gap-3 border-b px-4 py-2"
			>
				<span class="text-muted-foreground text-xs font-medium tracking-wider uppercase">
					{activeLinks.length} active link{activeLinks.length === 1 ? '' : 's'}
				</span>
				<Button size="sm" variant="outline" onclick={() => (showMintDialog = true)}>
					<Plus class="mr-1.5 h-3.5 w-3.5" />
					New link
				</Button>
			</div>
			{#each activeLinks as link, i (link.id)}
				{@const expiry = formatExpiry(link.expiresAt)}
				{@const expired = typeof expiry === 'object' && expiry.expired}
				{@const capValue = link.maxSolves}
				{@const hasCap = capValue !== null && capValue !== undefined}
				{@const capReached = hasCap && link.solveCount >= (capValue as number)}
				<div
					class={`flex items-start gap-3 px-4 py-3 ${i < activeLinks.length - 1 ? 'border-border border-b' : ''}`}
				>
					<div class="min-w-0 flex-1">
						<div class="flex flex-wrap items-center gap-1.5">
							<p class="truncate text-sm font-medium">
								{link.name ?? 'Untitled link'}
							</p>
							<span
								class={`rounded-full px-2 py-0.5 font-mono text-[10px] tracking-wide uppercase ${
									link.channel === 'live'
										? 'bg-success/10 text-success'
										: 'bg-warning/10 text-warning'
								}`}
							>
								{link.channel}
							</span>
							{#if !link.allowSolve}
								<span
									class="bg-muted text-muted-foreground rounded-full px-2 py-0.5 font-mono text-[10px] tracking-wide uppercase"
								>
									view-only
								</span>
							{/if}
							{#if expired}
								<span
									class="bg-destructive/10 text-destructive flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] tracking-wide uppercase"
								>
									<TriangleAlert class="h-2.5 w-2.5" />
									expired
								</span>
							{/if}
							{#if capReached}
								<span
									class="bg-destructive/10 text-destructive rounded-full px-2 py-0.5 font-mono text-[10px] tracking-wide uppercase"
								>
									cap reached
								</span>
							{/if}
						</div>
						<div
							class="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs"
						>
							<span class="font-mono tabular-nums">
								{link.solveCount.toLocaleString()}{hasCap
									? ` / ${(capValue as number).toLocaleString()}`
									: ''} solves
							</span>
							<span>·</span>
							<span>
								Expires: {typeof expiry === 'object' ? expiry.text : expiry}
							</span>
							<span>·</span>
							<span>Minted {formatRelative(link.createdAt)}</span>
						</div>
					</div>
					<Button
						variant="ghost"
						size="icon"
						onclick={() => (confirmingRevoke = link)}
						disabled={revokingId === link.id}
						class="text-muted-foreground hover:text-destructive h-7 w-7 shrink-0"
						aria-label="Revoke link"
					>
						<Trash2 class="h-3.5 w-3.5" />
					</Button>
				</div>
			{/each}
		</div>
	{/if}
</div>

<MintShareLinkDialog
	{definitionGuid}
	open={showMintDialog}
	onOpenChange={(o) => (showMintDialog = o)}
	onMinted={loadLinks}
/>

<AlertDialog.Root open={!!confirmingRevoke} onOpenChange={(o) => !o && (confirmingRevoke = null)}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Revoke this link?</AlertDialog.Title>
			<AlertDialog.Description>
				{#if confirmingRevoke}
					<strong>{confirmingRevoke.name ?? 'This link'}</strong> will stop working immediately. Anyone
					using it will see a "no longer active" page. This cannot be undone.
				{/if}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				onclick={() => confirmingRevoke && revoke(confirmingRevoke)}
				disabled={!!revokingId}
			>
				{revokingId ? 'Revoking…' : 'Revoke'}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
