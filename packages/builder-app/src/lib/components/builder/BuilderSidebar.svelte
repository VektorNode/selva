<script lang="ts">
	import { Card, Button } from '@selvajs/ui';
	import { SchemaInfoPanel, AvailableItemList } from '$lib/components/builder';
	import type { UISchema, DiscoveredInput, DiscoveredOutput } from '@selvajs/schemas';

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
</script>

<aside class="flex flex-col gap-6">
	<SchemaInfoPanel {schema} {onSchemaChange} />

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
				Drag parameters into groups below or use the context menu (right click on param) to add them
				to specific tabs/groups.
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
</aside>
