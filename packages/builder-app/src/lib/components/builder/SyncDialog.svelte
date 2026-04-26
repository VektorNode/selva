<script lang="ts">
	import { Dialog, Button, Badge, Checkbox, Label } from '@selvajs/shared';
	import type { SyncChange, SyncDiff } from '$lib/websocket/websocket.svelte';
	import { ChevronDown, ChevronUp, ArrowRight } from '@lucide/svelte';

	interface Props {
		open: boolean;
		syncDiff: SyncDiff | null;
		loading?: boolean;
		onOpenChange?: (open: boolean) => void;
		onApplyChanges?: (selectedChanges: SyncChange[]) => void;
	}

	let {
		open = false,
		syncDiff = null,
		loading = false,
		onOpenChange,
		onApplyChanges
	}: Props = $props();

	let selectedKeys = $state<Record<string, boolean>>({});
	let expandedSections = $state({ fromGH: true, toGH: true });

	// Clear selections when dialog closes or syncDiff changes
	$effect(() => {
		if (!open || !syncDiff) {
			selectedKeys = {};
		}
	});

	function changeKey(change: SyncChange, direction: 'fromGH' | 'toGH') {
		return `${direction}__${change.ParamId}__${change.Field}`;
	}

	function getSelectedDirection(): 'fromGH' | 'toGH' | null {
		const fromGHSelected = (syncDiff?.fromGH ?? []).some(
			(c) => selectedKeys[changeKey(c, 'fromGH')]
		);
		const toGHSelected = (syncDiff?.toGH ?? []).some((c) => selectedKeys[changeKey(c, 'toGH')]);
		if (fromGHSelected) return 'fromGH';
		if (toGHSelected) return 'toGH';
		return null;
	}

	function toggleSelect(change: SyncChange, direction: 'fromGH' | 'toGH') {
		const key = changeKey(change, direction);
		const isCurrentlySelected = selectedKeys[key];

		if (isCurrentlySelected) {
			selectedKeys = { ...selectedKeys, [key]: false };
			return;
		}

		const currentDirection = getSelectedDirection();
		if (currentDirection && currentDirection !== direction) {
			const next = { ...selectedKeys };
			const oppositeDir = direction === 'fromGH' ? 'toGH' : 'fromGH';
			const oppositeChanges =
				oppositeDir === 'fromGH' ? (syncDiff?.fromGH ?? []) : (syncDiff?.toGH ?? []);
			oppositeChanges.forEach((c) => delete next[changeKey(c, oppositeDir)]);
			selectedKeys = { ...next, [key]: true };
		} else {
			selectedKeys = { ...selectedKeys, [key]: true };
		}
	}

	function toggleAll(direction: 'fromGH' | 'toGH') {
		const changes = direction === 'fromGH' ? (syncDiff?.fromGH ?? []) : (syncDiff?.toGH ?? []);
		const allSelected = changes.every((c) => selectedKeys[changeKey(c, direction)]);
		const next = { ...selectedKeys };

		if (allSelected) {
			changes.forEach((c) => delete next[changeKey(c, direction)]);
		} else {
			const oppositeDir = direction === 'fromGH' ? 'toGH' : 'fromGH';
			const oppositeChanges =
				oppositeDir === 'fromGH' ? (syncDiff?.fromGH ?? []) : (syncDiff?.toGH ?? []);
			oppositeChanges.forEach((c) => delete next[changeKey(c, oppositeDir)]);
			changes.forEach((c) => (next[changeKey(c, direction)] = true));
		}
		selectedKeys = next;
	}

	function isSelected(change: SyncChange, direction: 'fromGH' | 'toGH') {
		return !!selectedKeys[changeKey(change, direction)];
	}

	function isDisabled(direction: 'fromGH' | 'toGH'): boolean {
		const currentDirection = getSelectedDirection();
		return currentDirection !== null && currentDirection !== direction;
	}

	function formatValue(value: unknown): string {
		if (value === null || value === undefined) return '(empty)';
		if (value === '') return '(empty)';
		if (typeof value === 'number') return value.toFixed(2);
		if (typeof value === 'boolean') return value ? 'true' : 'false';
		return String(value);
	}

	const selectedCount = $derived(Object.values(selectedKeys).filter(Boolean).length);

	function buildSelectedChanges(): SyncChange[] {
		const result: SyncChange[] = [];
		(syncDiff?.fromGH ?? []).forEach((c) => {
			if (selectedKeys[changeKey(c, 'fromGH')]) result.push({ ...c, Direction: 'fromGH' });
		});
		(syncDiff?.toGH ?? []).forEach((c) => {
			if (selectedKeys[changeKey(c, 'toGH')]) result.push({ ...c, Direction: 'toGH' });
		});
		return result;
	}

	function handleApply() {
		onApplyChanges?.(buildSelectedChanges());
	}

	function handleClose() {
		selectedKeys = {};
		onOpenChange?.(false);
	}

	const hasChanges = $derived(
		(syncDiff?.fromGH?.length ?? 0) > 0 || (syncDiff?.toGH?.length ?? 0) > 0
	);
</script>

<Dialog.Root {open} {onOpenChange}>
	<Dialog.Content class="sm:max-w-6xl">
		<Dialog.Header>
			<Dialog.Title>Sync with Grasshopper</Dialog.Title>
			<Dialog.Description>
				Review changes between your schema and Grasshopper, then select which changes to apply.
			</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-6">
			{#if loading}
				<div class="flex items-center justify-center py-8">
					<div class="text-muted-foreground">Loading sync preview...</div>
				</div>
			{:else if !syncDiff || !hasChanges}
				<div class="text-muted-foreground flex items-center justify-center py-8">
					<div>No differences found. Your schema is in sync with Grasshopper!</div>
				</div>
			{:else}
				<!-- Grasshopper → Schema changes -->
				{#if (syncDiff.fromGH?.length ?? 0) > 0}
					<div class="w-full rounded-lg border-2 border-blue-500 bg-blue-50 p-4 dark:bg-blue-950">
						<button
							type="button"
							class="flex w-full items-center justify-between font-semibold text-blue-900 dark:text-blue-100"
							onclick={() => (expandedSections.fromGH = !expandedSections.fromGH)}
						>
							<div class="flex items-center gap-2">
								<Badge class="bg-blue-600 text-white hover:bg-blue-600">GH → SCHEMA</Badge>
								<span
									>{syncDiff.fromGH.length}
									{syncDiff.fromGH.length === 1 ? 'change' : 'changes'}</span
								>
							</div>
							{#if expandedSections.fromGH}
								<ChevronUp class="h-5 w-5" />
							{:else}
								<ChevronDown class="h-5 w-5" />
							{/if}
						</button>

						{#if expandedSections.fromGH}
							<div class="mt-4 space-y-3">
								<div class="flex items-center justify-between">
									<div class="flex items-center gap-2">
										<Checkbox
											disabled={isDisabled('fromGH')}
											checked={syncDiff.fromGH.every((c) => isSelected(c, 'fromGH'))}
											onCheckedChange={() => toggleAll('fromGH')}
										/>
										<Label
											class={`cursor-pointer ${isDisabled('fromGH') ? 'text-muted-foreground' : ''}`}
										>
											Select all
										</Label>
									</div>
									<div class="text-xs text-blue-700 dark:text-blue-300">
										Update Schema with values from Grasshopper
									</div>
								</div>

								<div class="overflow-x-auto rounded border bg-white dark:bg-gray-900">
									<table class="w-full text-sm">
										<thead class="bg-blue-100 dark:bg-blue-900">
											<tr class="text-left">
												<th class="w-8 px-3 py-2"></th>
												<th class="px-3 py-2 font-semibold">Parameter</th>
												<th class="px-3 py-2 font-semibold">Field</th>
												<th class="px-3 py-2 font-semibold">
													<div class="flex items-center gap-1">
														<Badge class="bg-blue-600 text-white hover:bg-blue-600">GH</Badge>
														<span>New Value</span>
													</div>
												</th>
												<th class="px-3 py-2"></th>
												<th class="px-3 py-2 font-semibold">
													<div class="flex items-center gap-1">
														<Badge variant="secondary">Schema</Badge>
														<span>Current Value</span>
													</div>
												</th>
											</tr>
										</thead>
										<tbody>
											{#each syncDiff.fromGH as change (change.ParamId + change.Field)}
												<tr
													class="border-b last:border-0 hover:bg-blue-50 dark:hover:bg-blue-900/50"
													class:opacity-50={isDisabled('fromGH')}
												>
													<td class="px-3 py-2">
														<Checkbox
															disabled={isDisabled('fromGH')}
															checked={isSelected(change, 'fromGH')}
															onCheckedChange={() => toggleSelect(change, 'fromGH')}
														/>
													</td>
													<td class="px-3 py-2 font-medium">{change.ParamNickname}</td>
													<td class="text-muted-foreground px-3 py-2">{change.Field}</td>
													<td
														class="px-3 py-2 font-mono text-xs font-semibold text-blue-700 dark:text-blue-300"
														>{formatValue(change.GHValue)}</td
													>
													<td class="px-2">
														<ArrowRight class="h-4 w-4 text-blue-500" />
													</td>
													<td class="px-3 py-2 font-mono text-xs text-gray-500 dark:text-gray-400"
														>{formatValue(change.SchemaValue)}</td
													>
												</tr>
											{/each}
										</tbody>
									</table>
								</div>
							</div>
						{/if}
					</div>
				{/if}

				<!-- Schema → Grasshopper changes -->
				{#if (syncDiff.toGH?.length ?? 0) > 0}
					<div class="rounded-lg border-2 border-green-500 bg-green-50 p-4 dark:bg-green-950">
						<button
							type="button"
							class="flex w-full items-center justify-between font-semibold text-green-900 dark:text-green-100"
							onclick={() => (expandedSections.toGH = !expandedSections.toGH)}
						>
							<div class="flex items-center gap-2">
								<Badge class="bg-green-600 text-white hover:bg-green-600">SCHEMA → GH</Badge>
								<span
									>{syncDiff.toGH.length} {syncDiff.toGH.length === 1 ? 'change' : 'changes'}</span
								>
							</div>
							{#if expandedSections.toGH}
								<ChevronUp class="h-5 w-5" />
							{:else}
								<ChevronDown class="h-5 w-5" />
							{/if}
						</button>

						{#if expandedSections.toGH}
							<div class="mt-4 space-y-3">
								<div class="flex items-center justify-between">
									<div class="flex items-center gap-2">
										<Checkbox
											disabled={isDisabled('toGH')}
											checked={syncDiff.toGH.every((c) => isSelected(c, 'toGH'))}
											onCheckedChange={() => toggleAll('toGH')}
										/>
										<Label
											class={`cursor-pointer ${isDisabled('toGH') ? 'text-muted-foreground' : ''}`}
										>
											Select all
										</Label>
									</div>
									<div class="text-xs text-green-700 dark:text-green-300">
										Update Grasshopper with values from Schema
									</div>
								</div>

								<div class="overflow-x-auto rounded border bg-white dark:bg-gray-900">
									<table class="w-full text-sm">
										<thead class="bg-green-100 dark:bg-green-900">
											<tr class="text-left">
												<th class="w-8 px-3 py-2"></th>
												<th class="px-3 py-2 font-semibold">Parameter</th>
												<th class="px-3 py-2 font-semibold">Field</th>
												<th class="px-3 py-2 font-semibold">
													<div class="flex items-center gap-1">
														<Badge class="bg-green-600 text-white hover:bg-green-600">Schema</Badge>
														<span>New Value</span>
													</div>
												</th>
												<th class="px-3 py-2"></th>
												<th class="px-3 py-2 font-semibold">
													<div class="flex items-center gap-1">
														<Badge variant="secondary">GH</Badge>
														<span>Current Value</span>
													</div>
												</th>
											</tr>
										</thead>
										<tbody>
											{#each syncDiff.toGH as change (change.ParamId + change.Field)}
												<tr
													class="border-b last:border-0 hover:bg-green-50 dark:hover:bg-green-900/50"
													class:opacity-50={isDisabled('toGH')}
												>
													<td class="px-3 py-2">
														<Checkbox
															disabled={isDisabled('toGH')}
															checked={isSelected(change, 'toGH')}
															onCheckedChange={() => toggleSelect(change, 'toGH')}
														/>
													</td>
													<td class="px-3 py-2 font-medium">{change.ParamNickname}</td>
													<td class="text-muted-foreground px-3 py-2">{change.Field}</td>
													<td
														class="px-3 py-2 font-mono text-xs font-semibold text-green-700 dark:text-green-300"
														>{formatValue(change.SchemaValue)}</td
													>
													<td class="px-2">
														<ArrowRight class="h-4 w-4 text-green-500" />
													</td>
													<td class="px-3 py-2 font-mono text-xs text-gray-500 dark:text-gray-400"
														>{formatValue(change.GHValue)}</td
													>
												</tr>
											{/each}
										</tbody>
									</table>
								</div>
							</div>
						{/if}
					</div>
				{/if}
			{/if}
		</div>

		<Dialog.Footer class="flex gap-2">
			<Button variant="outline" onclick={handleClose} disabled={loading}>Cancel</Button>
			<Button onclick={handleApply} disabled={loading || selectedCount === 0} variant="default">
				Apply Selected ({selectedCount})
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
