<script lang="ts">
	import { Button, Card, DataTable, EmptyState, Input, Label, SectionHeader, toast } from '@selvajs/ui';
	import { Folders, Plus } from '@lucide/svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import type { PlatformProjectRow, OrgOption } from './+page.server';

	interface PageData {
		projects: PlatformProjectRow[];
		orgOptions: OrgOption[];
	}
	let { data }: { data: PageData } = $props();

	let showCreate = $state(false);
	let creating = $state(false);
	let newName = $state('');
	let newDescription = $state('');
	let newOrgId = $state<string>('');

	$effect(() => {
		if (showCreate && !newOrgId && data.orgOptions.length > 0) {
			newOrgId = data.orgOptions[0].id;
		}
	});

	async function create() {
		if (!newName.trim()) {
			toast.error('Name is required');
			return;
		}
		creating = true;
		try {
			const res = await fetch('/admin/api/projects', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: newName.trim(),
					description: newDescription.trim() || undefined,
					orgId: newOrgId || undefined
				})
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				throw new Error(body.message ?? `HTTP ${res.status}`);
			}
			const project = await res.json();
			toast.success(`Created “${project.name}”`);
			showCreate = false;
			newName = '';
			newDescription = '';
			await invalidateAll();
			goto(`/admin/projects/${project.id}`);
		} catch (err) {
			toast.error((err as Error).message);
		} finally {
			creating = false;
		}
	}
</script>

<svelte:head>
	<title>Admin · Platform projects</title>
</svelte:head>

<div class="space-y-6">
	<SectionHeader
		eyebrow="Admin"
		title="Platform projects"
		description="Projects owned by platform admins. Grant orgs or individual users view/solve access without project membership."
	>
		{#snippet actions()}
			<Button size="sm" onclick={() => (showCreate = true)} class="gap-1.5">
				<Plus class="h-3.5 w-3.5" /> New project
			</Button>
		{/snippet}
	</SectionHeader>

	{#if showCreate}
		<Card.Root>
			<Card.Content class="space-y-4 pt-6">
				<div class="space-y-1.5">
					<Label for="new-name">Name</Label>
					<Input id="new-name" bind:value={newName} placeholder="Shared templates" />
				</div>
				<div class="space-y-1.5">
					<Label for="new-desc">Description (optional)</Label>
					<Input id="new-desc" bind:value={newDescription} />
				</div>
				<div class="space-y-1.5">
					<Label for="new-org">Host organization</Label>
					<select
						id="new-org"
						bind:value={newOrgId}
						class="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
					>
						{#each data.orgOptions as org (org.id)}
							<option value={org.id}>{org.name} ({org.slug})</option>
						{/each}
					</select>
					<p class="text-muted-foreground text-xs">
						Storage and compute use this org. Membership in this org does NOT grant access — visibility = platform overrides.
					</p>
				</div>
				<div class="flex justify-end gap-2 pt-2">
					<Button variant="outline" size="sm" onclick={() => (showCreate = false)}>Cancel</Button>
					<Button size="sm" disabled={creating} onclick={create}>
						{creating ? 'Creating…' : 'Create'}
					</Button>
				</div>
			</Card.Content>
		</Card.Root>
	{/if}

	<Card.Root>
		<Card.Content class="pt-6">
			{#if data.projects.length === 0}
				<EmptyState
					icon={Folders}
					title="No platform projects"
					description="Click “New project” to create one. Platform projects are managed by instance admins and granted to orgs or individual users."
				/>
			{:else}
				<DataTable
					rows={data.projects}
					getKey={(p) => p.id}
					columns={[
						{ label: 'Project' },
						{ label: 'Host org', width: '200px' },
						{ label: 'Created', width: '140px', align: 'right' }
					]}
				>
					{#snippet row(project)}
						<a href={`/admin/projects/${project.id}`} class="min-w-0 hover:underline">
							<p class="truncate text-sm font-medium">{project.name}</p>
							<p class="text-muted-foreground truncate font-mono text-xs">{project.slug}</p>
						</a>
						<span class="truncate text-sm">{project.hostOrgName}</span>
						<span class="text-muted-foreground text-right text-xs">
							{new Date(project.createdAt).toLocaleDateString()}
						</span>
					{/snippet}
				</DataTable>
			{/if}
		</Card.Content>
	</Card.Root>
</div>
