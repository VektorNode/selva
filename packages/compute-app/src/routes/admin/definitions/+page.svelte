<script lang="ts">
	import { Button, Input, Card, toast } from 'selva-shared';
	import { Plus } from '@lucide/svelte';
	import { invalidateAll } from '$app/navigation';
	import DefinitionCard from './DefinitionCard.svelte';
	import EditDefinitionDialog from './EditDefinitionDialog.svelte';
	import AddDefinitionDialog from './AddDefinitionDialog.svelte';
	import type { DefinitionRecord, Project, ComputeServerConfig } from './+page.server.js';

	interface PageData {
		projects: Project[];
		records: DefinitionRecord[];
		computeServers: ComputeServerConfig[];
	}

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();

	let editingDefinition = $state<string | null>(null);
	let savingDefinition = $state<Record<string, boolean>>({});
	let showAddModal = $state(false);
	let addingDefinition = $state(false);
	let searchQuery = $state('');
	let activeProjectId = $state<string | null>(null);

	$effect(() => {
		if (data.projects.length > 0 && activeProjectId === null) {
			activeProjectId = data.projects[0].id;
		}
	});

	const visibleRecords = $derived(
		data.records.filter((r) => {
			if (activeProjectId && r.projectId !== activeProjectId) return false;
			if (!searchQuery) return true;
			const q = searchQuery.toLowerCase();
			return (
				r.meta.displayName?.toLowerCase().includes(q) ||
				r.meta.description?.toLowerCase().includes(q) ||
				r.meta.originalFilename?.toLowerCase().includes(q)
			);
		})
	);

	const editingRecord = $derived(
		editingDefinition ? data.records.find((r) => r.guid === editingDefinition) : null
	);

	async function getErrorMessage(response: Response, fallback: string): Promise<string> {
		if (response.headers.get('content-type')?.includes('application/json')) {
			const err = await response.json().catch(() => null);
			return err?.message || err?.error?.message || `${fallback} (${response.status})`;
		}
		return `${fallback} (${response.status})`;
	}

	async function saveDefinition(guid: string, patch: Partial<DefinitionRecord['meta']> & { maxHistory?: number; projectId?: string; computeServerId?: string | null }) {
		savingDefinition[guid] = true;
		try {
			const response = await fetch(`/admin/api/definitions/${guid}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(patch)
			});
			if (response.ok) {
				toast.success('Definition saved');
				editingDefinition = null;
				await invalidateAll();
			} else {
				toast.error(await getErrorMessage(response, 'Save failed'));
			}
		} catch (err) {
			toast.error('Save failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
		} finally {
			savingDefinition[guid] = false;
		}
	}

	async function submitAddDefinition(formData: FormData) {
		addingDefinition = true;
		try {
			const response = await fetch('/admin/api/definitions', {
				method: 'POST',
				body: formData
			});
			if (response.ok) {
				toast.success(`"${formData.get('displayName')}" created`);
				showAddModal = false;
				await invalidateAll();
			} else {
				const msg = await getErrorMessage(response, 'Failed to create definition');
				toast.error(msg);
				throw new Error(msg);
			}
		} catch (err) {
			if (!(err instanceof Error && err.message)) {
				toast.error('Failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
			}
			throw err;
		} finally {
			addingDefinition = false;
		}
	}
</script>

<svelte:head>
	<title>Definitions - Selva Admin</title>
</svelte:head>

<div class="w-full space-y-6 p-6 lg:px-12 xl:px-16">
	<Card.Root>
		<Card.Header>
			<div class="flex items-center justify-between">
				<div>
					<Card.Title>Definitions</Card.Title>
					<Card.Description>
						{visibleRecords.length} definition{visibleRecords.length === 1 ? '' : 's'}
						{activeProjectId && data.projects.length > 1
							? `in ${data.projects.find((p) => p.id === activeProjectId)?.name ?? 'project'}`
							: 'configured'}
					</Card.Description>
				</div>
				<Button onclick={() => (showAddModal = true)} class="hidden md:inline-flex">
					<Plus class="mr-2 h-4 w-4" />
					Add Definition
				</Button>
			</div>
			<p class="text-muted-foreground mt-2 text-xs md:hidden">
				💡 Uploading definitions is not available on mobile. Use a desktop or tablet to add new
				definitions.
			</p>
		</Card.Header>

		<Card.Content class="space-y-4">
			<!-- Project tabs (only shown when multiple projects exist) -->
			{#if data.projects.length > 1}
				<div class="flex gap-1 border-b">
					{#each data.projects as project (project.id)}
						<button
							class="px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px
								{activeProjectId === project.id
								? 'border-primary text-foreground'
								: 'border-transparent text-muted-foreground hover:text-foreground'}"
							onclick={() => (activeProjectId = project.id)}
						>
							{project.name}
						</button>
					{/each}
				</div>
			{/if}

			<!-- Search -->
			<Input type="text" bind:value={searchQuery} placeholder="Search definitions..." />

			<!-- Grid -->
			{#if visibleRecords.length === 0}
				<div class="flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 text-center">
					<p class="text-sm font-medium">No definitions found</p>
					<p class="text-muted-foreground mt-1 text-sm">
						{searchQuery ? 'Try adjusting your search' : 'Add your first definition to get started'}
					</p>
				</div>
			{:else}
				<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{#each visibleRecords as record (record.guid)}
						<DefinitionCard
							guid={record.guid}
							config={{
								displayName: record.meta.displayName,
								description: record.meta.description ?? '',
								category: record.meta.category,
								tags: record.meta.tags,
								coverImage: record.meta.coverImage,
								originalFilename: record.meta.originalFilename,
								file: `definition.${record.fileExt}`
							}}
							onEdit={(g) => (editingDefinition = g)}
						/>
					{/each}
				</div>
			{/if}
		</Card.Content>
	</Card.Root>

	<!-- Edit Definition Dialog -->
	{#if editingDefinition && editingRecord}
		{@const record = editingRecord}
		<EditDefinitionDialog
			open={true}
			guid={record.guid}
			config={{
				displayName: record.meta.displayName,
				description: record.meta.description ?? '',
				category: record.meta.category ?? '',
				coverImage: record.meta.coverImage ?? '',
				tags: record.meta.tags,
				originalFilename: record.meta.originalFilename,
				file: `definition.${record.fileExt}`,
				maxHistory: record.maxHistory > 0 ? record.maxHistory : undefined,
				projectId: record.projectId,
				computeServerId: record.computeServerId
			}}
			projects={data.projects}
			computeServers={data.computeServers}
			history={record.history}
			savingDefinition={savingDefinition[record.guid]}
			onOpenChange={(o) => { if (!o) editingDefinition = null; }}
			onSave={saveDefinition}
		/>
	{/if}

	<!-- Add Definition Dialog -->
	<AddDefinitionDialog
		open={showAddModal}
		isAdding={addingDefinition}
		projects={data.projects}
		defaultProjectId={activeProjectId ?? data.projects[0]?.id}
		computeServers={data.computeServers}
		onOpenChange={(o) => (showAddModal = o)}
		onSubmit={submitAddDefinition}
	/>
</div>
