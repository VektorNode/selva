<script lang="ts">
	import {
		AlertDialog,
		Button,
		Card,
		DataTable,
		EmptyState,
		SectionHeader,
		toast
	} from '@selvajs/ui';
	import { RotateCcw, FolderOpen } from '@lucide/svelte';
	import { invalidateAll } from '$app/navigation';
	import type { ReclaimRow } from './+page.server';

	interface PageData {
		projects: ReclaimRow[];
	}
	let { data }: { data: PageData } = $props();

	let confirming = $state<ReclaimRow | null>(null);
	let reclaimingId = $state<string | null>(null);

	const VISIBILITY_TONE: Record<string, string> = {
		public: 'border-success/40 text-success',
		org: 'border-blue-500/40 text-blue-600 dark:text-blue-400',
		private: 'border-border text-muted-foreground'
	};

	async function reclaim(project: ReclaimRow) {
		reclaimingId = project.id;
		try {
			const res = await fetch(`/api/v1/projects/${project.id}/reclaim`, { method: 'POST' });
			if (res.ok) {
				toast.success(`Reclaimed "${project.name}"`);
				await invalidateAll();
			} else {
				const err = await res.json().catch(() => ({}));
				toast.error(err.message || err.error || 'Failed to reclaim');
			}
		} catch {
			toast.error('Failed to reclaim');
		} finally {
			reclaimingId = null;
			confirming = null;
		}
	}
</script>

<svelte:head>
	<title>Team · Reclaim</title>
</svelte:head>

<div class="space-y-6">
	<SectionHeader
		eyebrow="Organization"
		title="Reclaim project"
		description="Take co-ownership of any project in this organization. Reclaiming does not demote the existing owner — it adds you alongside them. Recorded in the audit log."
	/>

	<Card.Root>
		<Card.Content class="pt-6">
			{#if data.projects.length === 0}
				<EmptyState
					icon={FolderOpen}
					title="No projects"
					description="No projects exist in this organization yet."
				/>
			{:else}
				<DataTable
					rows={data.projects}
					getKey={(p) => p.id}
					columns={[
						{ label: 'Project' },
						{ label: 'Visibility', width: '120px' },
						{ label: 'Members', width: '100px', align: 'right' },
						{ label: '', width: '100px' }
					]}
				>
					{#snippet row(project)}
						<div class="min-w-0">
							<p class="truncate text-sm font-medium">{project.name}</p>
							<p class="text-muted-foreground truncate font-mono text-xs">{project.id}</p>
						</div>
						<span
							class={`w-fit rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-wide uppercase ${VISIBILITY_TONE[project.visibility] ?? VISIBILITY_TONE.private}`}
						>
							{project.visibility}
						</span>
						<span class="text-right font-mono text-sm tabular-nums">{project.memberCount}</span>
						<div class="flex justify-end">
							{#if project.alreadyOwner}
								<span class="text-muted-foreground text-xs">Owned</span>
							{:else}
								<Button
									size="sm"
									variant="outline"
									disabled={reclaimingId === project.id}
									onclick={() => (confirming = project)}
								>
									<RotateCcw class="mr-1.5 h-3.5 w-3.5" />
									Reclaim
								</Button>
							{/if}
						</div>
					{/snippet}
				</DataTable>
			{/if}
		</Card.Content>
	</Card.Root>
</div>

<AlertDialog.Root open={!!confirming} onOpenChange={(o) => !o && (confirming = null)}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Reclaim this project?</AlertDialog.Title>
			<AlertDialog.Description>
				{#if confirming}
					You'll be added as a co-owner of <strong>{confirming.name}</strong>. The existing owner is
					not demoted. This action is recorded in the audit log.
				{/if}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				onclick={() => confirming && reclaim(confirming)}
				disabled={!!reclaimingId}
			>
				{reclaimingId ? 'Reclaiming…' : 'Reclaim'}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
