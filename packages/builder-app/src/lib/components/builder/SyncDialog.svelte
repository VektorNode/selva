<script lang="ts">
	import { Dialog, Button } from '@selva/shared';
	import type { SyncChange, SyncDiff } from '$lib/websocket/websocket.svelte';
	import { ChevronDown, ChevronUp } from '@lucide/svelte';

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

	// Use a plain object for selection to avoid Set reactivity issues in Svelte 5
	let selectedKeys = $state<Record<string, boolean>>({});
	let expandedSections = $state({ fromGH: true, toGH: true });

	function changeKey(change: SyncChange, direction: 'fromGH' | 'toGH') {
		return `${direction}__${change.ParamId}__${change.Field}`;
	}

	function getSelectedDirection(): 'fromGH' | 'toGH' | null {
		const fromGHSelected = (syncDiff?.fromGH ?? []).some((c) => selectedKeys[changeKey(c, 'fromGH')]);
		const toGHSelected = (syncDiff?.toGH ?? []).some((c) => selectedKeys[changeKey(c, 'toGH')]);
		if (fromGHSelected) return 'fromGH';
		if (toGHSelected) return 'toGH';
		return null;
	}

	function toggleSelect(change: SyncChange, direction: 'fromGH' | 'toGH') {
		const key = changeKey(change, direction);
		const isCurrentlySelected = selectedKeys[key];

		// If deselecting, just deselect
		if (isCurrentlySelected) {
			selectedKeys = { ...selectedKeys, [key]: false };
			return;
		}

		// If selecting, check if we need to clear the opposite direction
		const currentDirection = getSelectedDirection();
		if (currentDirection && currentDirection !== direction) {
			// Clear the opposite direction
			const next = { ...selectedKeys };
			const oppositeDir = direction === 'fromGH' ? 'toGH' : 'fromGH';
			const oppositeChanges = oppositeDir === 'fromGH' ? (syncDiff?.fromGH ?? []) : (syncDiff?.toGH ?? []);
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
			// Deselect all in this direction
			changes.forEach((c) => delete next[changeKey(c, direction)]);
		} else {
			// Clear opposite direction first, then select all in this direction
			const oppositeDir = direction === 'fromGH' ? 'toGH' : 'fromGH';
			const oppositeChanges = oppositeDir === 'fromGH' ? (syncDiff?.fromGH ?? []) : (syncDiff?.toGH ?? []);
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
	<Dialog.Content class="max-h-[80vh] max-w-3xl overflow-y-auto">
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
					<div class="border-l-4 border-blue-500 bg-blue-50 p-4 dark:bg-blue-950">
						<button
							type="button"
							class="flex w-full items-center justify-between font-semibold text-blue-900 dark:text-blue-100"
							onclick={() => (expandedSections.fromGH = !expandedSections.fromGH)}
						>
							<span>Grasshopper → Schema ({syncDiff.fromGH.length} changes)</span>
							{#if expandedSections.fromGH}
								<ChevronUp class="h-5 w-5" />
							{:else}
								<ChevronDown class="h-5 w-5" />
							{/if}
						</button>

						{#if expandedSections.fromGH}
							<div class="mt-4 space-y-2">
								<label class="flex items-center gap-2">
									<input
										type="checkbox"
										class="rounded"
										disabled={isDisabled('fromGH')}
										checked={syncDiff.fromGH.every((c) => isSelected(c, 'fromGH'))}
										onchange={() => toggleAll('fromGH')}
									/>
									<span class="text-sm font-medium" class:text-muted-foreground={isDisabled('fromGH')}>Select all</span>
								</label>

								<div class="overflow-x-auto">
									<table class="w-full text-sm">
										<thead>
											<tr class="border-b text-left">
												<th class="w-8 px-3 py-2"></th>
												<th class="px-3 py-2">Parameter</th>
												<th class="px-3 py-2">Field</th>
												<th class="px-3 py-2">GH Value</th>
												<th class="px-3 py-2">Schema Value</th>
											</tr>
										</thead>
										<tbody>
											{#each syncDiff.fromGH as change (change.ParamId + change.Field)}
												<tr class="border-b hover:bg-blue-100 dark:hover:bg-blue-900" class:opacity-50={isDisabled('fromGH')}>
													<td class="px-3 py-2">
														<input
															type="checkbox"
															class="rounded"
															disabled={isDisabled('fromGH')}
															checked={isSelected(change, 'fromGH')}
															onchange={() => toggleSelect(change, 'fromGH')}
														/>
													</td>
													<td class="px-3 py-2 font-medium">{change.ParamNickname}</td>
													<td class="px-3 py-2">{change.Field}</td>
													<td class="px-3 py-2 font-mono text-xs text-blue-700 dark:text-blue-300"
														>{formatValue(change.GHValue)}</td
													>
													<td class="px-3 py-2 font-mono text-xs"
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
					<div class="border-l-4 border-green-500 bg-green-50 p-4 dark:bg-green-950">
						<button
							type="button"
							class="flex w-full items-center justify-between font-semibold text-green-900 dark:text-green-100"
							onclick={() => (expandedSections.toGH = !expandedSections.toGH)}
						>
							<span>Schema → Grasshopper ({syncDiff.toGH.length} changes)</span>
							{#if expandedSections.toGH}
								<ChevronUp class="h-5 w-5" />
							{:else}
								<ChevronDown class="h-5 w-5" />
							{/if}
						</button>

						{#if expandedSections.toGH}
							<div class="mt-4 space-y-2">
								<label class="flex items-center gap-2">
									<input
										type="checkbox"
										class="rounded"
										disabled={isDisabled('toGH')}
										checked={syncDiff.toGH.every((c) => isSelected(c, 'toGH'))}
										onchange={() => toggleAll('toGH')}
									/>
									<span class="text-sm font-medium" class:text-muted-foreground={isDisabled('toGH')}>Select all</span>
								</label>

								<div class="overflow-x-auto">
									<table class="w-full text-sm">
										<thead>
											<tr class="border-b text-left">
												<th class="w-8 px-3 py-2"></th>
												<th class="px-3 py-2">Parameter</th>
												<th class="px-3 py-2">Field</th>
												<th class="px-3 py-2">Schema Value</th>
												<th class="px-3 py-2">GH Value</th>
											</tr>
										</thead>
										<tbody>
											{#each syncDiff.toGH as change (change.ParamId + change.Field)}
												<tr class="border-b hover:bg-green-100 dark:hover:bg-green-900" class:opacity-50={isDisabled('toGH')}>
													<td class="px-3 py-2">
														<input
															type="checkbox"
															class="rounded"
															disabled={isDisabled('toGH')}
															checked={isSelected(change, 'toGH')}
															onchange={() => toggleSelect(change, 'toGH')}
														/>
													</td>
													<td class="px-3 py-2 font-medium">{change.ParamNickname}</td>
													<td class="px-3 py-2">{change.Field}</td>
													<td class="px-3 py-2 font-mono text-xs text-green-700 dark:text-green-300"
														>{formatValue(change.SchemaValue)}</td
													>
													<td class="px-3 py-2 font-mono text-xs">{formatValue(change.GHValue)}</td>
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
