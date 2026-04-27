<script lang="ts">
	import { Button, Card, SectionHeader, AlertDialog, toast } from '@selvajs/ui';
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
			const res = await fetch(`/api/projects/${project.id}/reclaim`, { method: 'POST' });
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
	<title>Admin · Reclaim</title>
</svelte:head>

<div class="space-y-6">
	<SectionHeader
		eyebrow="Admin"
		title="Reclaim & offboard"
		description="Take co-ownership of any project on the instance. Reclaiming does not demote the existing owner — it adds you alongside them. Recorded in the audit log."
	/>

	<Card.Root>
		<Card.Content class="pt-6">
			{#if data.projects.length === 0}
				<div
					class="flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 text-center"
				>
					<FolderOpen class="mb-3 h-8 w-8 text-muted-foreground" />
					<p class="text-sm font-medium">No projects</p>
					<p class="mt-1 text-sm text-muted-foreground">
						No projects exist on this instance, or the data provider does not expose project
						listing.
					</p>
				</div>
			{:else}
				<div class="divide-y rounded-lg border">
					<div
						class="grid grid-cols-[1fr_180px_120px_100px_100px] gap-4 bg-muted/40 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground"
					>
						<span>Project</span>
						<span>Organization</span>
						<span>Visibility</span>
						<span class="text-right">Members</span>
						<span></span>
					</div>
					{#each data.projects as project (project.id)}
						<div
							class="grid grid-cols-[1fr_180px_120px_100px_100px] items-center gap-4 px-4 py-3"
						>
							<div class="min-w-0">
								<p class="truncate text-sm font-medium">{project.name}</p>
								<p class="truncate font-mono text-xs text-muted-foreground">{project.id}</p>
							</div>
							<div class="min-w-0">
								<p class="truncate text-sm">{project.orgName}</p>
								<code class="font-mono text-xs text-muted-foreground">{project.orgSlug}</code>
							</div>
							<span
								class={`w-fit rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${VISIBILITY_TONE[project.visibility] ?? VISIBILITY_TONE.private}`}
							>
								{project.visibility}
							</span>
							<span class="text-right font-mono text-sm tabular-nums">{project.memberCount}</span>
							<div class="flex justify-end">
								<Button
									size="sm"
									variant="outline"
									disabled={reclaimingId === project.id}
									onclick={() => (confirming = project)}
								>
									<RotateCcw class="mr-1.5 h-3.5 w-3.5" />
									Reclaim
								</Button>
							</div>
						</div>
					{/each}
				</div>
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
					You'll be added as a co-owner of <strong>{confirming.name}</strong> in
					<strong>{confirming.orgName}</strong>. The existing owner is not demoted. This action is
					recorded in the audit log.
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
