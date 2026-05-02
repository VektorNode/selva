<script lang="ts">
	import { Card, Button, ScrollArea } from '@selvajs/ui';
	import { SchemaInfoPanel, AvailableItemList } from '$lib/components/builder';
	import type { UISchema, DiscoveredInput, DiscoveredOutput } from '@selvajs/schemas';
	import { getSessionIdFromUrl } from '$lib/utils/session';

	interface Props {
		schema: UISchema;
		availableInputs: DiscoveredInput[];
		availableOutputs: DiscoveredOutput[];
		placedIds: Set<string>;
		syncNeeded?: boolean;
		onSchemaChange: (schema: UISchema) => void;
		onSync: () => void;
		onAddToGroup: (
			tabId: string,
			groupId: string,
			item: DiscoveredInput | DiscoveredOutput
		) => void;
		onAddToNewGroup: (path: string, item: DiscoveredInput | DiscoveredOutput) => void;
	}

	let {
		schema,
		availableInputs,
		availableOutputs,
		placedIds,
		syncNeeded = false,
		onSchemaChange,
		onSync,
		onAddToGroup,
		onAddToNewGroup
	}: Props = $props();

	const schemaInfoStorageKey = $derived(`builder.schemaInfo.open:${getSessionIdFromUrl()}`);

	let schemaInfoOpen = $state(false);

	$effect(() => {
		if (typeof localStorage === 'undefined') return;
		const stored = localStorage.getItem(schemaInfoStorageKey);
		schemaInfoOpen = stored === '1';
	});

	$effect(() => {
		if (typeof localStorage === 'undefined') return;
		localStorage.setItem(schemaInfoStorageKey, schemaInfoOpen ? '1' : '0');
	});
</script>

<aside class="h-full">
	<ScrollArea class="h-full">
		<div class="flex flex-col gap-6">
			<Card.Root class="shadow-sm">
				<Card.Header class="flex flex-row items-center justify-between space-y-0">
					<Card.Title class="text-xl">Available Parameters</Card.Title>
					{#if syncNeeded}
						<Button
							variant="default"
							size="sm"
							onclick={onSync}
							class="bg-amber-500 hover:bg-amber-600"
						>
							Sync
						</Button>
					{/if}
				</Card.Header>
				<Card.Content>
					<p class="text-accent-foreground/40 mb-4 text-sm">
						Drag parameters into groups below or use the context menu (right click on param) to add
						them to specific tabs/groups.
					</p>

					<AvailableItemList
						items={availableInputs}
						title="Inputs"
						placedIds={Array.from(placedIds)}
						tabs={schema?.layout?.type === 'tabbed' ? schema.layout.tabs : []}
						{onAddToGroup}
						{onAddToNewGroup}
					/>

					<AvailableItemList
						items={availableOutputs}
						title="Outputs"
						placedIds={Array.from(placedIds)}
						tabs={schema?.layout?.type === 'tabbed' ? schema.layout.tabs : []}
						{onAddToGroup}
						{onAddToNewGroup}
					/>
				</Card.Content>
			</Card.Root>

			<SchemaInfoPanel {schema} {onSchemaChange} bind:open={schemaInfoOpen} />
		</div>
	</ScrollArea>
</aside>
