<script lang="ts">
	import type { DefinitionVersion } from '@selvajs/platform';
	import type { SchemaDiff } from '@selvajs/schemas';
	import { LoaderCircle } from '@lucide/svelte';
	import { Button, FilterableDropdown, toast, type FilterableDropdownItem } from '@selvajs/ui';
	import MarkdownNote from './MarkdownNote.svelte';
	import VersionChanges from './VersionChanges.svelte';
	import InventorySection from './InventorySection.svelte';
	import { refreshInventory, type InventoryReport } from './inventory.js';

	interface Props {
		definitionGuid: string;
		version: DefinitionVersion;
		/** Every version of the definition, newest first: the choices to compare with. */
		versions: DefinitionVersion[];
	}

	let { definitionGuid, version, versions }: Props = $props();

	type Loaded =
		| { state: 'loading' }
		| { state: 'error'; message: string }
		| {
				state: 'done';
				base: { id: string; versionNumber: number } | null;
				changes: SchemaDiff | null;
				/** Absent for callers who may only run the definition; null when not read yet. */
				inventory?: InventoryReport | null;
		  };

	/** '' = the version just before. */
	let against = $state('');
	let loaded = $state<Loaded>({ state: 'loading' });
	/** Bumped to fetch again after an inventory is read. */
	let reload = $state(0);
	let reading = $state(false);

	async function read(versionId: string) {
		reading = true;
		const error = await refreshInventory(definitionGuid, versionId);
		reading = false;
		if (error) toast.error(error);
		else reload++;
	}

	$effect(() => {
		void reload;
		const url = `/api/v1/definitions/${definitionGuid}/versions/${version.id}/changes${against ? `?against=${against}` : ''}`;
		let cancelled = false;
		loaded = { state: 'loading' };
		fetch(url)
			.then(async (res) => {
				if (cancelled) return;
				if (!res.ok) {
					const body = await res.json().catch(() => ({}));
					loaded = { state: 'error', message: body.message || `Failed to load (${res.status})` };
					return;
				}
				loaded = { state: 'done', ...(await res.json()) };
			})
			.catch(() => {
				if (!cancelled) loaded = { state: 'error', message: 'Failed to load changes' };
			});
		return () => {
			cancelled = true;
		};
	});

	const others = $derived(versions.filter((v) => v.id !== version.id));

	const PREVIOUS = 'previous';
	const compareItems = $derived<FilterableDropdownItem[]>([
		{ id: PREVIOUS, label: 'the version before' },
		...others.map((v) => ({ id: v.id, label: `v${v.versionNumber}` }))
	]);
</script>

<div class="mt-3 space-y-4 border-t pt-3">
	{#if version.changeNote}
		<MarkdownNote source={version.changeNote} />
	{:else}
		<p class="text-faint-foreground text-sm">No release notes.</p>
	{/if}

	<div class="space-y-2">
		<div class="flex flex-wrap items-center justify-between gap-2">
			<h4 class="text-sm font-semibold">Changes</h4>
			{#if others.length}
				<div class="text-muted-foreground flex items-center gap-1.5 text-xs">
					compared with
					<FilterableDropdown
						size="sm"
						aria-label="Version to compare with"
						items={compareItems}
						value={against || PREVIOUS}
						onChange={(id) => (against = id === PREVIOUS ? '' : id)}
					/>
				</div>
			{/if}
		</div>

		{#if loaded.state === 'loading'}
			<p class="text-muted-foreground flex items-center gap-2 text-sm">
				<LoaderCircle class="h-3.5 w-3.5 animate-spin" /> Comparing…
			</p>
		{:else if loaded.state === 'error'}
			<p class="text-destructive text-sm">{loaded.message}</p>
		{:else if !loaded.base}
			<p class="text-muted-foreground text-sm">The first version: nothing to compare with.</p>
		{:else if !loaded.changes}
			<p class="text-muted-foreground text-sm">
				v{loaded.base.versionNumber} or this version predates stored schemas, so changes can't be listed.
			</p>
		{:else}
			<p class="text-muted-foreground text-xs">
				v{loaded.base.versionNumber} → v{version.versionNumber}
			</p>
			<VersionChanges diff={loaded.changes} />
		{/if}
	</div>

	{#if loaded.state === 'done' && loaded.inventory !== undefined}
		{#if loaded.inventory}
			{@const base = loaded.base}
			<InventorySection
				report={loaded.inventory}
				baseNumber={base?.versionNumber}
				code={{ definitionGuid, versionId: version.id, against: against || undefined }}
				onReadBase={base ? () => read(base.id) : undefined}
				readingBase={reading}
			/>
		{:else}
			<div class="flex flex-wrap items-center gap-2">
				<p class="text-muted-foreground text-sm">
					v{version.versionNumber} was uploaded before Selva read what is inside a file.
				</p>
				<Button size="sm" variant="outline" onclick={() => read(version.id)} disabled={reading}>
					{reading ? 'Reading…' : 'Read it now'}
				</Button>
			</div>
		{/if}
	{/if}
</div>
