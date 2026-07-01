<script lang="ts">
	import { Button, AlertDialog, toast } from '@selvajs/ui';
	import { Upload, Play, CloudUpload, Trash2 } from '@lucide/svelte';
	import { invalidateAll } from '$app/navigation';
	import type { DefinitionVersion } from '@selvajs/platform';
	import UploadVersionDialog from './UploadVersionDialog.svelte';

	interface Props {
		definitionGuid: string;
		onOpenRunner: (guid: string, channel?: 'live' | 'draft', versionId?: string) => void;
	}

	let { definitionGuid, onOpenRunner }: Props = $props();

	let versions = $state<DefinitionVersion[]>([]);
	let liveVersionId = $state<string | null>(null);
	let draftVersionId = $state<string | null>(null);
	let loading = $state(true);

	let showUploadDialog = $state(false);
	let publishingTarget = $state<DefinitionVersion | null>(null); // null = publish current draft
	let publishingTargetSet = $state(false);
	let publishing = $state(false);
	let confirmingDelete = $state<DefinitionVersion | null>(null);
	let deletingId = $state<string | null>(null);

	$effect(() => {
		void definitionGuid;
		loadVersions();
	});

	async function loadVersions() {
		loading = true;
		try {
			const res = await fetch(`/api/definitions/${definitionGuid}/versions`);
			if (!res.ok) throw new Error(`${res.status}`);
			const data = (await res.json()) as {
				versions: DefinitionVersion[];
				liveVersionId: string | null;
				draftVersionId: string | null;
			};
			versions = data.versions;
			liveVersionId = data.liveVersionId;
			draftVersionId = data.draftVersionId;
		} catch {
			toast.error('Failed to load versions');
		} finally {
			loading = false;
		}
	}

	const liveVersion = $derived(versions.find((v) => v.id === liveVersionId) ?? null);
	const draftVersion = $derived(versions.find((v) => v.id === draftVersionId) ?? null);
	const draftIsAhead = $derived(
		draftVersion !== null && liveVersion !== null && draftVersion.id !== liveVersion.id
	);
	const nextVersionNumber = $derived((versions[0]?.versionNumber ?? 0) + 1);

	function formatRelative(iso: string) {
		const ms = Date.now() - new Date(iso).getTime();
		const minutes = Math.floor(ms / 60000);
		if (minutes < 1) return 'Just now';
		if (minutes < 60) return `${minutes}m ago`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		if (days === 1) return 'Yesterday';
		if (days < 30) return `${days}d ago`;
		return new Date(iso).toLocaleDateString();
	}

	async function publish(target: DefinitionVersion | null) {
		publishing = true;
		try {
			const body = target ? { versionId: target.id } : {};
			const res = await fetch(`/api/definitions/${definitionGuid}/publish`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				toast.error(err.message || err.error || 'Failed to publish');
				return;
			}
			const result = await res.json();
			toast.success(`v${result.version?.versionNumber ?? '?'} is now live`);
			await loadVersions();
			await invalidateAll();
		} catch {
			toast.error('Failed to publish');
		} finally {
			publishing = false;
			publishingTarget = null;
			publishingTargetSet = false;
		}
	}

	async function deleteVersion(version: DefinitionVersion) {
		deletingId = version.id;
		try {
			const res = await fetch(`/api/definitions/${definitionGuid}/versions/${version.id}`, {
				method: 'DELETE'
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				toast.error(
					err.message ||
						err.error ||
						'Failed to delete version. Live or draft versions cannot be deleted.'
				);
				return;
			}
			toast.success(`v${version.versionNumber} deleted`);
			await loadVersions();
			await invalidateAll();
		} catch {
			toast.error('Failed to delete version');
		} finally {
			deletingId = null;
			confirmingDelete = null;
		}
	}
</script>

<div class="space-y-4">
	<!-- Status banner -->
	{#if loading}
		<div class="border-border bg-muted/30 rounded-md border px-4 py-3">
			<p class="text-muted-foreground text-xs">Loading versions…</p>
		</div>
	{:else if versions.length === 0}
		<div
			class="border-border bg-muted/30 text-muted-foreground rounded-md border px-4 py-3 text-sm"
		>
			No versions yet. Upload one to get started.
		</div>
	{:else}
		<div
			class="border-border bg-muted/30 flex items-center justify-between gap-3 rounded-md border px-4 py-3"
		>
			<div class="flex min-w-0 items-center gap-2 text-sm">
				<span class="bg-success h-2 w-2 shrink-0 rounded-full"></span>
				{#if liveVersion}
					<span><strong>Live now</strong> — v{liveVersion.versionNumber}</span>
					{#if draftIsAhead && draftVersion}
						<span class="text-muted-foreground">· newer version uploaded</span>
					{:else}
						<span class="text-muted-foreground">· up to date</span>
					{/if}
				{:else}
					<span class="text-muted-foreground">Not yet published — promote a draft to go live</span>
				{/if}
			</div>
			{#if draftIsAhead && draftVersion}
				<Button size="sm" onclick={() => publish(null)} disabled={publishing} class="shrink-0">
					<CloudUpload class="mr-1.5 h-3.5 w-3.5" />
					Publish v{draftVersion.versionNumber}
				</Button>
			{/if}
		</div>
	{/if}

	<!-- Header row: title + upload action -->
	<div class="flex items-center justify-between gap-3">
		<div>
			<h3 class="text-base font-semibold tracking-tight">Versions</h3>
			<p class="text-muted-foreground mt-1 text-xs">
				Each upload becomes a version. The live version is what runs when someone uses this
				definition.
			</p>
		</div>
		<Button variant="outline" size="sm" onclick={() => (showUploadDialog = true)} class="shrink-0">
			<Upload class="mr-1.5 h-3.5 w-3.5" />
			Upload new version
		</Button>
	</div>

	<!-- Version timeline -->
	{#if !loading && versions.length > 0}
		<div class="space-y-2">
			{#each versions as version (version.id)}
				{@const isLive = version.id === liveVersionId}
				{@const isDraft = version.id === draftVersionId && !isLive}
				<div
					class={`rounded-md border p-3 transition-colors ${
						isLive ? 'border-primary/40 bg-accent/40' : 'border-border bg-card hover:bg-muted/30'
					}`}
				>
					<div class="flex items-start justify-between gap-3">
						<div class="min-w-0 flex-1">
							<div class="flex flex-wrap items-center gap-2">
								<span class="font-mono text-sm font-semibold">v{version.versionNumber}</span>
								{#if isLive}
									<span
										class="bg-success/10 text-success rounded-full px-2 py-0.5 font-mono text-[10px] tracking-wide uppercase"
									>
										live
									</span>
								{/if}
								{#if isDraft}
									<span
										class="bg-warning/10 text-warning rounded-full px-2 py-0.5 font-mono text-[10px] tracking-wide uppercase"
									>
										draft
									</span>
								{/if}
							</div>
							{#if version.changeNote}
								<p class="mt-1 truncate text-sm">{version.changeNote}</p>
							{:else if version.originalFilename}
								<p class="text-muted-foreground mt-1 truncate font-mono text-xs">
									{version.originalFilename}
								</p>
							{/if}
							<p class="text-muted-foreground mt-1 text-xs">
								Uploaded {formatRelative(version.uploadedAt)}
							</p>
						</div>
						<div class="flex shrink-0 items-center gap-1">
							<Button
								size="sm"
								variant={isLive ? 'outline' : 'ghost'}
								onclick={() =>
									isLive
										? onOpenRunner(definitionGuid, 'live')
										: isDraft
											? onOpenRunner(definitionGuid, 'draft')
											: onOpenRunner(definitionGuid, undefined, version.id)}
							>
								<Play class="mr-1.5 h-3.5 w-3.5" />
								Run
							</Button>
							{#if !isLive}
								<Button
									size="sm"
									variant="outline"
									disabled={publishing}
									onclick={() => {
										publishingTarget = version;
										publishingTargetSet = true;
									}}
								>
									Make live
								</Button>
							{/if}
							{#if !isLive && !isDraft}
								<Button
									size="sm"
									variant="ghost"
									onclick={() => (confirmingDelete = version)}
									disabled={deletingId === version.id}
									class="text-muted-foreground hover:text-destructive h-8 w-8 p-0"
									aria-label="Delete version"
								>
									<Trash2 class="h-3.5 w-3.5" />
								</Button>
							{/if}
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<UploadVersionDialog
	{definitionGuid}
	{nextVersionNumber}
	open={showUploadDialog}
	onOpenChange={(o) => (showUploadDialog = o)}
	onUploaded={loadVersions}
/>

<AlertDialog.Root
	open={publishingTargetSet}
	onOpenChange={(o) => {
		if (!o) {
			publishingTarget = null;
			publishingTargetSet = false;
		}
	}}
>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>
				{#if publishingTarget}
					Make v{publishingTarget.versionNumber} live?
				{:else}
					Publish current draft?
				{/if}
			</AlertDialog.Title>
			<AlertDialog.Description>
				{#if publishingTarget && liveVersion && publishingTarget.versionNumber < liveVersion.versionNumber}
					Rolling back to an older version. Anyone running this definition will immediately get v{publishingTarget.versionNumber}
					instead of v{liveVersion.versionNumber}.
				{:else if publishingTarget}
					Anyone running this definition will immediately get v{publishingTarget.versionNumber}
					instead of v{liveVersion?.versionNumber ?? '—'}.
				{:else}
					Promotes the current draft to live. Everyone running this definition gets the new version
					immediately.
				{/if}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action onclick={() => publish(publishingTarget)} disabled={publishing}>
				{publishing ? 'Publishing…' : 'Publish'}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root open={!!confirmingDelete} onOpenChange={(o) => !o && (confirmingDelete = null)}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>
				Delete v{confirmingDelete?.versionNumber}?
			</AlertDialog.Title>
			<AlertDialog.Description>
				This permanently removes the version's file. The live and draft versions cannot be deleted —
				repoint first.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				onclick={() => confirmingDelete && deleteVersion(confirmingDelete)}
				disabled={!!deletingId}
			>
				{deletingId ? 'Deleting…' : 'Delete'}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
