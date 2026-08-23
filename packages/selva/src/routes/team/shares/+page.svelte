<script lang="ts">
	import {
		AlertDialog,
		Button,
		Card,
		DataTable,
		EmptyState,
		Input,
		SectionHeader,
		toast
	} from '@selvajs/ui';
	import { Link2, Trash2, ExternalLink } from '@lucide/svelte';
	import { invalidateAll } from '$app/navigation';
	import type { ShareRow } from './+page.server';

	interface PageData {
		rows: ShareRow[];
	}
	let { data }: { data: PageData } = $props();

	let filter = $state('');
	let confirmingRevoke = $state<ShareRow | null>(null);
	let revokingId = $state<string | null>(null);

	const visible = $derived.by(() => {
		const needle = filter.trim().toLowerCase();
		if (!needle) return data.rows;
		return data.rows.filter((r) =>
			[r.createdByName, r.name, r.definitionName, r.projectName]
				.filter((v): v is string => Boolean(v))
				.some((v) => v.toLowerCase().includes(needle))
		);
	});

	function usage(row: ShareRow): string {
		return row.maxSolves == null ? `${row.solveCount}` : `${row.solveCount} / ${row.maxSolves}`;
	}

	async function revoke(row: ShareRow) {
		revokingId = row.id;
		try {
			// Revoking goes through the per-definition endpoint, which checks edit
			// rights on the parent — reading this roster does not grant them.
			const res = await fetch(`/api/v1/definitions/${row.definitionId}/share-links/${row.id}`, {
				method: 'DELETE'
			});
			if (res.ok) {
				toast.success('Share link revoked');
				await invalidateAll();
			} else {
				const err = await res.json().catch(() => ({}));
				toast.error(err.message || err.error || 'Failed to revoke share link');
			}
		} catch {
			toast.error('Failed to revoke share link');
		} finally {
			revokingId = null;
			confirmingRevoke = null;
		}
	}
</script>

<svelte:head>
	<title>Team · Share links</title>
</svelte:head>

<div class="space-y-6">
	<SectionHeader
		eyebrow="Team"
		title="Share links"
		description="Every active share link across your organisation's definitions."
	/>

	<Card.Root>
		<Card.Content class="space-y-4 pt-6">
			{#if data.rows.length === 0}
				<EmptyState
					icon={Link2}
					title="No active share links"
					description="Links minted from a definition's detail page appear here until they expire or are revoked."
				/>
			{:else}
				<div class="flex items-center justify-between gap-3">
					<Input placeholder="Filter by person, label, definition…" bind:value={filter} />
					<span class="text-muted-foreground shrink-0 text-xs tabular-nums">
						{visible.length} of {data.rows.length}
					</span>
				</div>

				{#if visible.length === 0}
					<p class="text-muted-foreground py-8 text-center text-sm">
						No share links match “{filter}”.
					</p>
				{:else}
					<DataTable
						rows={visible}
						getKey={(r) => r.id}
						columns={[
							{ label: 'Link' },
							{ label: 'Minted by', width: '160px' },
							{ label: 'Solves', width: '100px', align: 'right' },
							{ label: 'Expires', width: '120px', align: 'right' },
							{ label: '', width: '80px' }
						]}
					>
						{#snippet row(link)}
							<div class="min-w-0">
								<div class="flex items-center gap-2">
									<a
										href={`/definitions/${link.definitionId}`}
										class="truncate text-sm font-medium hover:underline"
									>
										{link.name || link.definitionName}
									</a>
									<a
										href={`/definitions/${link.definitionId}`}
										class="text-muted-foreground hover:text-foreground"
										aria-label="Open definition"
									>
										<ExternalLink class="h-3.5 w-3.5" />
									</a>
									<span
										class="text-muted-foreground w-fit rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-wide uppercase"
									>
										{link.channel}
									</span>
									{#if !link.allowSolve}
										<span
											class="text-muted-foreground w-fit rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-wide uppercase"
										>
											view only
										</span>
									{/if}
								</div>
								<p class="text-muted-foreground truncate text-xs">
									{link.projectName} · {link.definitionName}
								</p>
							</div>
							<span class="truncate text-sm">
								{#if link.createdByName}
									{link.createdByName}
								{:else}
									<!-- The minter is gone; the link is not. That is the point of this page. -->
									<span class="text-muted-foreground italic">deleted user</span>
								{/if}
							</span>
							<span class="text-right font-mono text-sm tabular-nums">{usage(link)}</span>
							<span class="text-muted-foreground text-right text-xs">
								{link.expiresAt ? new Date(link.expiresAt).toLocaleDateString() : 'never'}
							</span>
							<div class="flex justify-end">
								<Button
									size="sm"
									variant="ghost"
									disabled={revokingId === link.id}
									onclick={() => (confirmingRevoke = link)}
									class="text-destructive hover:text-destructive h-8 w-8 p-0"
									aria-label="Revoke share link"
								>
									<Trash2 class="h-4 w-4" />
								</Button>
							</div>
						{/snippet}
					</DataTable>
				{/if}
			{/if}
		</Card.Content>
	</Card.Root>
</div>

<AlertDialog.Root open={!!confirmingRevoke} onOpenChange={(o) => !o && (confirmingRevoke = null)}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Revoke this share link?</AlertDialog.Title>
			<AlertDialog.Description>
				{#if confirmingRevoke}
					Anyone holding the URL for
					<strong>{confirmingRevoke.name || confirmingRevoke.definitionName}</strong>
					loses access immediately. The link cannot be restored — a new one would have to be minted.
				{/if}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				onclick={() => confirmingRevoke && revoke(confirmingRevoke)}
				class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
			>
				Revoke link
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
