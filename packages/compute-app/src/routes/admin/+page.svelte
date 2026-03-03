<script lang="ts">
	import { Button, Input, Card, toast } from '@selva/shared';
	import { Plus } from '@lucide/svelte';
	import { invalidateAll } from '$app/navigation';
	import DefinitionCard from './DefinitionCard.svelte';
	import EditDefinitionDialog from './EditDefinitionDialog.svelte';
	import AddDefinitionDialog from './AddDefinitionDialog.svelte';
	import UpdateSection from './UpdateSection.svelte';

	interface HistoryEntry {
		filename: string;
		originalName: string;
		date: string;
	}

	interface DefinitionConfig {
		displayName: string;
		description: string;
		category?: string;
		tags?: string[];
		coverImage?: string;
		file?: string;
		originalFilename?: string;
		maxHistory?: number;
	}

	interface PageData {
		config: { [guid: string]: DefinitionConfig };
		history: { [guid: string]: HistoryEntry[] };
	}

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();

	// Local editable copy of config (GUID-keyed)
	let editableConfig = $state<{ [guid: string]: DefinitionConfig }>({});
	$effect(() => {
		const raw = JSON.parse(JSON.stringify(data.config)) as typeof editableConfig;
		// Normalize optional fields to empty strings so bind:value never receives undefined
		for (const cfg of Object.values(raw)) {
			cfg.description ??= '';
			cfg.category ??= '';
			cfg.coverImage ??= '';
		}
		editableConfig = raw;
	});

	// State
	let editingDefinition = $state<string | null>(null);
	let savingDefinition = $state<{ [guid: string]: boolean }>({});
	let uploadingDefinitionFile = $state<{ [guid: string]: boolean }>({});
	let uploadingDefinitionImage = $state<{ [guid: string]: boolean }>({});
	let revertingFile = $state<{ [guid: string]: string | null }>({});
	let showAddModal = $state(false);
	let addingDefinition = $state(false);
	let searchQuery = $state('');
	let updateRunning = $state(false);
	let updateLogs = $state('');
	let updateExitCode = $state<number | null>(null);
	let updateRestarting = $state(false);

	const filteredDefinitions = $derived(
		Object.entries(editableConfig).filter(([_guid, cfg]) => {
			if (searchQuery === '') return true;
			const q = searchQuery.toLowerCase();
			return (
				cfg.displayName?.toLowerCase().includes(q) ||
				cfg.description?.toLowerCase().includes(q) ||
				cfg.originalFilename?.toLowerCase().includes(q)
			);
		})
	);

	async function getErrorMessage(response: Response, fallback: string): Promise<string> {
		if (response.headers.get('content-type')?.includes('application/json')) {
			const err = await response.json().catch(() => null);
			return err?.message || err?.error?.message || `${fallback} (${response.status})`;
		}
		return `${fallback} (${response.status})`;
	}

	async function saveDefinition(guid: string, config: DefinitionConfig) {
		savingDefinition[guid] = true;
		try {
			const response = await fetch(`/admin/api/definitions/${guid}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					displayName: config.displayName,
					description: config.description?.trim() || undefined,
					category: config.category?.trim() || undefined,
					tags: config.tags && config.tags.length > 0 ? [...new Set(config.tags)] : undefined,
					coverImage: config.coverImage ?? undefined,
					maxHistory: config.maxHistory !== undefined ? config.maxHistory : undefined
				})
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
				const displayName = formData.get('displayName');
				toast.success(`"${displayName}" created`);
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

	async function waitForAppRestart() {
		updateLogs += '\nWaiting for app to come back online…\n';
		await new Promise((r) => setTimeout(r, 3000));
		for (let i = 0; i < 30; i++) {
			try {
				const res = await fetch('/api/health', { cache: 'no-store' });
				if (res.ok) {
					updateLogs += '✓ App is back online!\n';
					updateExitCode = 0;
					updateRunning = false;
					updateRestarting = false;
					return;
				}
			} catch {
				// still down, keep polling
			}
			await new Promise((r) => setTimeout(r, 2000));
		}
		updateLogs += '⚠ App did not come back within 60s — check PM2 logs.\n';
		updateRunning = false;
		updateRestarting = false;
	}

	async function runUpdate() {
		updateRunning = true;
		updateRestarting = false;
		updateLogs = '';
		updateExitCode = null;
		try {
			const response = await fetch('/admin/api/update', { method: 'POST' });
			if (!response.ok) {
				updateLogs = 'Failed to start update process';
				updateRunning = false;
				return;
			}
			const reader = response.body?.getReader();
			const decoder = new TextDecoder();
			if (!reader) {
				updateLogs = 'Failed to read response';
				updateRunning = false;
				return;
			}
			let buffer = '';
			let gotExit = false;
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				const parts = buffer.split('\n\n');
				buffer = parts.pop()!;
				for (const part of parts) {
					if (!part.startsWith('data: ')) continue;
					try {
						const event = JSON.parse(part.slice(6));
						if (event.type === 'log') updateLogs += event.data + '\n';
						else if (event.type === 'restarting') {
							updateLogs += event.data + '\n';
							updateRestarting = true;
						} else if (event.type === 'exit') {
							gotExit = true;
							updateExitCode = event.code;
							updateRunning = false;
						}
					} catch {
						// ignore malformed events
					}
				}
			}
			// Stream closed without an exit event — the process restarted itself
			if (!gotExit) {
				await waitForAppRestart();
			}
		} catch (err) {
			if (updateRestarting) {
				// Expected — the server killed itself during restart
				await waitForAppRestart();
			} else {
				updateLogs += '\nError: ' + (err instanceof Error ? err.message : 'Unknown error');
				updateRunning = false;
			}
		}
	}
</script>

<svelte:head>
	<title>Admin Dashboard - Selva Compute</title>
</svelte:head>

<div class="w-full space-y-6 p-6 lg:px-12 xl:px-16">
	<!-- Definition Manager -->
	<Card.Root>
		<Card.Header>
			<div class="flex items-center justify-between">
				<div>
					<Card.Title>Definitions</Card.Title>
					<Card.Description>
						{Object.keys(editableConfig).length} definition{Object.keys(editableConfig).length === 1
							? ''
							: 's'} configured
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
			<!-- Search -->
			<Input type="text" bind:value={searchQuery} placeholder="Search definitions..." />

			<!-- Grid -->
			{#if filteredDefinitions.length === 0}
				<div
					class="flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 text-center"
				>
					<p class="text-sm font-medium">No definitions found</p>
					<p class="text-muted-foreground mt-1 text-sm">
						{searchQuery ? 'Try adjusting your search' : 'Add your first definition to get started'}
					</p>
				</div>
			{:else}
				<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{#each filteredDefinitions as entry (entry[0])}
						<DefinitionCard
							guid={entry[0]}
							config={entry[1]}
							onEdit={(g) => (editingDefinition = g)}
						/>
					{/each}
				</div>
			{/if}
		</Card.Content>
	</Card.Root>

	<!-- Edit Definition Dialog -->
	{#if editingDefinition && editableConfig[editingDefinition]}
		{@const guid = editingDefinition}
		{@const cfg = editableConfig[guid]}
		<EditDefinitionDialog
			open={true}
			{guid}
			config={cfg}
			history={data.history[guid] ?? []}
			savingDefinition={savingDefinition[guid]}
			uploadingDefinitionFile={uploadingDefinitionFile[guid]}
			uploadingDefinitionImage={uploadingDefinitionImage[guid]}
			revertingFile={revertingFile[guid]}
			onOpenChange={(o) => {
				if (!o) editingDefinition = null;
			}}
			onSave={saveDefinition}
		/>
	{/if}

	<!-- Add Definition Dialog -->
	<AddDefinitionDialog
		open={showAddModal}
		isAdding={addingDefinition}
		onOpenChange={(o) => (showAddModal = o)}
		onSubmit={submitAddDefinition}
	/>

	<!-- Application Update -->
	<UpdateSection
		isRunning={updateRunning}
		isRestarting={updateRestarting}
		logs={updateLogs}
		exitCode={updateExitCode}
		onRun={runUpdate}
	/>
</div>

<style>
</style>
