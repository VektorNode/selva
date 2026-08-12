<script lang="ts">
	import {
		Button,
		Card,
		DataTable,
		EmptyState,
		Input,
		Label,
		SectionHeader,
		Tabs,
		Textarea,
		toast
	} from '@selvajs/ui';
	import { ArrowLeft, FileText, Plus, Settings, Shield, Trash2, X } from '@lucide/svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import type { GrantRow, OrgOption, UserOption, DefinitionRow } from './+page.server';
	import type { Project } from '@selvajs/platform';

	interface PageData {
		project: Project;
		definitions: DefinitionRow[];
		grants: GrantRow[];
		orgOptions: OrgOption[];
		userOptions: UserOption[];
	}
	let { data }: { data: PageData } = $props();

	// ============================================================================
	// Settings — initial values seeded from data.project; the $effect below
	// resyncs after every invalidateAll. The svelte-ignore is needed because
	// the seeders pre-date the effect (warned but correct).
	// ============================================================================
	/* svelte-ignore state_referenced_locally */
	let nameInput = $state(data.project.name);
	/* svelte-ignore state_referenced_locally */
	let descriptionInput = $state(data.project.description ?? '');
	let savingSettings = $state(false);
	let deleting = $state(false);

	$effect(() => {
		nameInput = data.project.name;
		descriptionInput = data.project.description ?? '';
	});

	async function saveSettings() {
		if (!nameInput.trim()) {
			toast.error('Name is required');
			return;
		}
		savingSettings = true;
		try {
			const res = await fetch(`/api/admin/projects/${data.project.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: nameInput.trim(),
					description: descriptionInput.trim() || null
				})
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				throw new Error(body.message ?? `HTTP ${res.status}`);
			}
			toast.success('Saved');
			await invalidateAll();
		} catch (err) {
			toast.error((err as Error).message);
		} finally {
			savingSettings = false;
		}
	}

	async function deleteProject() {
		if (!confirm(`Delete “${data.project.name}”? This cannot be undone.`)) return;
		deleting = true;
		try {
			const res = await fetch(`/api/admin/projects/${data.project.id}`, { method: 'DELETE' });
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				throw new Error(body.message ?? `HTTP ${res.status}`);
			}
			toast.success('Project deleted');
			goto('/admin/projects');
		} catch (err) {
			toast.error((err as Error).message);
			deleting = false;
		}
	}

	// ============================================================================
	// Grants
	// ============================================================================
	let showAddGrant = $state(false);
	let granteeType = $state<'org' | 'user'>('org');
	let granteeId = $state('');
	let canSolveNew = $state(true);
	let addingGrant = $state(false);
	let revokingId = $state<string | null>(null);

	const granteeOptions = $derived(
		granteeType === 'org'
			? data.orgOptions.map((o) => ({ id: o.id, label: o.name, sub: o.slug }))
			: data.userOptions.map((u) => ({
					id: u.id,
					label: u.displayName ?? u.email ?? u.id,
					sub: u.displayName && u.email ? u.email : undefined
				}))
	);

	const usedGranteeIds = $derived(
		new Set(data.grants.filter((g) => g.granteeType === granteeType).map((g) => g.granteeId))
	);

	$effect(() => {
		// When switching grantee type or after adding, pick a sensible default.
		if (!granteeOptions.find((o) => o.id === granteeId)) {
			granteeId = granteeOptions.find((o) => !usedGranteeIds.has(o.id))?.id ?? '';
		}
	});

	async function addGrant() {
		if (!granteeId) {
			toast.error('Pick a grantee');
			return;
		}
		addingGrant = true;
		try {
			const res = await fetch(`/api/admin/projects/${data.project.id}/grants`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ granteeType, granteeId, canSolve: canSolveNew })
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				throw new Error(body.message ?? `HTTP ${res.status}`);
			}
			toast.success('Grant added');
			showAddGrant = false;
			granteeId = '';
			canSolveNew = true;
			await invalidateAll();
		} catch (err) {
			toast.error((err as Error).message);
		} finally {
			addingGrant = false;
		}
	}

	async function revokeGrant(grantId: string) {
		revokingId = grantId;
		try {
			const res = await fetch(`/api/admin/projects/${data.project.id}/grants/${grantId}`, {
				method: 'DELETE'
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				throw new Error(body.message ?? `HTTP ${res.status}`);
			}
			toast.success('Grant revoked');
			await invalidateAll();
		} catch (err) {
			toast.error((err as Error).message);
		} finally {
			revokingId = null;
		}
	}
</script>

<svelte:head>
	<title>Admin · {data.project.name}</title>
</svelte:head>

<div class="space-y-6">
	<div>
		<a
			href="/admin/projects"
			class="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
		>
			<ArrowLeft class="h-3 w-3" /> Platform projects
		</a>
	</div>

	<SectionHeader
		eyebrow="Platform project"
		title={data.project.name}
		description={data.project.description ?? undefined}
	/>

	<Tabs.Root value="grants">
		<Tabs.List>
			<Tabs.Trigger value="grants" class="gap-1.5">
				<Shield class="h-3.5 w-3.5" /> Grants
				<span class="text-muted-foreground ml-1 font-mono text-[11px]">{data.grants.length}</span>
			</Tabs.Trigger>
			<Tabs.Trigger value="definitions" class="gap-1.5">
				<FileText class="h-3.5 w-3.5" /> Definitions
				<span class="text-muted-foreground ml-1 font-mono text-[11px]"
					>{data.definitions.length}</span
				>
			</Tabs.Trigger>
			<Tabs.Trigger value="settings" class="gap-1.5">
				<Settings class="h-3.5 w-3.5" /> Settings
			</Tabs.Trigger>
		</Tabs.List>

		<!-- Grants -->
		<Tabs.Content value="grants" class="mt-4 space-y-4">
			<Card.Root>
				<Card.Content class="space-y-4 pt-6">
					<div class="flex items-center justify-between">
						<div>
							<p class="text-sm font-medium">Access grants</p>
							<p class="text-muted-foreground text-xs">
								Orgs or users you've granted view/solve access. Instance admins always have full
								access.
							</p>
						</div>
						<Button size="sm" onclick={() => (showAddGrant = !showAddGrant)} class="gap-1.5">
							<Plus class="h-3.5 w-3.5" /> Add grant
						</Button>
					</div>

					{#if showAddGrant}
						<div class="bg-muted/30 space-y-3 rounded-lg border p-4">
							<div class="space-y-1.5">
								<Label>Grantee type</Label>
								<div class="flex gap-2">
									<Button
										variant={granteeType === 'org' ? 'default' : 'outline'}
										size="sm"
										onclick={() => (granteeType = 'org')}
									>
										Organization
									</Button>
									<Button
										variant={granteeType === 'user' ? 'default' : 'outline'}
										size="sm"
										onclick={() => (granteeType = 'user')}
									>
										Individual user
									</Button>
								</div>
							</div>
							<div class="space-y-1.5">
								<Label for="grantee-id">{granteeType === 'org' ? 'Organization' : 'User'}</Label>
								<select
									id="grantee-id"
									bind:value={granteeId}
									class="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
								>
									{#each granteeOptions as opt (opt.id)}
										<option value={opt.id} disabled={usedGranteeIds.has(opt.id)}>
											{opt.label}{opt.sub ? ` — ${opt.sub}` : ''}{usedGranteeIds.has(opt.id)
												? ' (already granted)'
												: ''}
										</option>
									{/each}
								</select>
							</div>
							<label class="flex items-center gap-2 text-sm">
								<input type="checkbox" bind:checked={canSolveNew} />
								Allow solving (uncheck for view-only)
							</label>
							<div class="flex justify-end gap-2">
								<Button variant="outline" size="sm" onclick={() => (showAddGrant = false)}>
									Cancel
								</Button>
								<Button size="sm" disabled={addingGrant || !granteeId} onclick={addGrant}>
									{addingGrant ? 'Adding…' : 'Add grant'}
								</Button>
							</div>
						</div>
					{/if}

					{#if data.grants.length === 0}
						<EmptyState
							size="sm"
							icon={Shield}
							title="No grants yet"
							description="Add a grant to share this project with an org or specific user."
						/>
					{:else}
						<DataTable
							rows={data.grants}
							getKey={(g) => g.id}
							columns={[
								{ label: 'Grantee' },
								{ label: 'Type', width: '120px' },
								{ label: 'Access', width: '120px' },
								{ label: '', width: '40px', align: 'right' }
							]}
						>
							{#snippet row(grant)}
								<div class="min-w-0">
									<p class="truncate text-sm font-medium">{grant.granteeName}</p>
									{#if grant.granteeSubtitle}
										<p class="text-muted-foreground truncate text-xs">{grant.granteeSubtitle}</p>
									{/if}
								</div>
								<span class="text-xs capitalize">{grant.granteeType}</span>
								<span class="text-xs">
									{grant.canSolve ? 'View + solve' : 'View only'}
								</span>
								<div class="text-right">
									<Button
										variant="ghost"
										size="sm"
										class="text-destructive hover:text-destructive h-7 w-7 p-0"
										disabled={revokingId === grant.id}
										onclick={() => revokeGrant(grant.id)}
									>
										<X class="h-3.5 w-3.5" />
									</Button>
								</div>
							{/snippet}
						</DataTable>
					{/if}
				</Card.Content>
			</Card.Root>
		</Tabs.Content>

		<!-- Definitions -->
		<Tabs.Content value="definitions" class="mt-4 space-y-4">
			<Card.Root>
				<Card.Content class="space-y-4 pt-6">
					<div class="flex items-center justify-between">
						<div>
							<p class="text-sm font-medium">Definitions</p>
							<p class="text-muted-foreground text-xs">
								Upload and edit definitions through the standard project view.
							</p>
						</div>
						<Button
							size="sm"
							variant="outline"
							onclick={() => goto(`/projects?project=${data.project.slug}`)}
						>
							Open in projects
						</Button>
					</div>

					{#if data.definitions.length === 0}
						<EmptyState
							size="sm"
							icon={FileText}
							title="No definitions yet"
							description="Open this project in the projects view to upload .gh files."
						/>
					{:else}
						<DataTable
							rows={data.definitions}
							getKey={(d) => d.guid}
							columns={[
								{ label: 'Definition' },
								{ label: 'Status', width: '120px' },
								{ label: 'Updated', width: '140px', align: 'right' }
							]}
						>
							{#snippet row(def)}
								<a href={`/library/${def.guid}`} class="min-w-0 hover:underline">
									<p class="truncate text-sm font-medium">{def.displayName}</p>
									<p class="text-muted-foreground truncate font-mono text-xs">{def.guid}</p>
								</a>
								<span class="text-xs capitalize">{def.status}</span>
								<span class="text-muted-foreground text-right text-xs">
									{new Date(def.updatedAt).toLocaleDateString()}
								</span>
							{/snippet}
						</DataTable>
					{/if}
				</Card.Content>
			</Card.Root>
		</Tabs.Content>

		<!-- Settings -->
		<Tabs.Content value="settings" class="mt-4 space-y-4">
			<Card.Root>
				<Card.Content class="space-y-4 pt-6">
					<div class="space-y-1.5">
						<Label for="proj-name">Name</Label>
						<Input id="proj-name" bind:value={nameInput} />
					</div>
					<div class="space-y-1.5">
						<Label for="proj-desc">Description</Label>
						<Textarea id="proj-desc" bind:value={descriptionInput} rows={3} />
					</div>
					<div class="flex items-center justify-between pt-2">
						<Button
							onclick={deleteProject}
							variant="ghost"
							size="sm"
							disabled={deleting}
							class="text-destructive hover:text-destructive gap-1.5 px-2"
						>
							<Trash2 class="h-3.5 w-3.5" />
							{deleting ? 'Deleting…' : 'Delete project'}
						</Button>
						<Button size="sm" disabled={savingSettings} onclick={saveSettings}>
							{savingSettings ? 'Saving…' : 'Save'}
						</Button>
					</div>
				</Card.Content>
			</Card.Root>
		</Tabs.Content>
	</Tabs.Root>
</div>
