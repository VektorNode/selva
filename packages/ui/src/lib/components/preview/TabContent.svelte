<script lang="ts">
	import type {
		TabConfig,
		SchemaInput,
		DiscoveredOutput,
		SupportedTypes,
		InputLayoutItem,
		OutputLayoutItem
	} from '@selvajs/schemas';
	import * as Tabs from '$lib/components/ui/tabs';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import StateDisplay from '../ui/StateDisplay.svelte';
	import Group from './Group.svelte';
	import InputControl from './InputControl.svelte';
	import OutputDisplay from './OutputDisplay.svelte';
	import { evaluateGroupVisibility } from '$lib/utils/visibility-rules';

	interface Props {
		tab: TabConfig;
		values: Record<string, unknown>;
		collapsedGroups: Record<string, boolean>;
		onToggleGroup: (groupId: string) => void;
		onValueChange: (paramId: string, value: SupportedTypes) => void;
		inputs: SchemaInput[];
		outputs: DiscoveredOutput[];
	}

	let { tab, values, collapsedGroups, onToggleGroup, onValueChange, inputs, outputs }: Props =
		$props();

	function getInputById(paramId: string): SchemaInput | undefined {
		return inputs.find((i) => i.id === paramId);
	}

	function getOutputById(paramId: string): DiscoveredOutput | undefined {
		return outputs.find((o) => o.id === paramId);
	}
</script>

{#snippet renderInput(
	layoutItem: InputLayoutItem,
	visibility: { visible: boolean; disabled: boolean; defaultValue?: unknown }
)}
	{@const input = getInputById(layoutItem.paramId)}
	{#if input}
		<InputControl
			item={layoutItem}
			value={values[input.id] as SupportedTypes | undefined}
			displayName={layoutItem.displayName}
			onChange={onValueChange}
			disabled={visibility.disabled}
		/>
	{/if}
{/snippet}

{#snippet renderOutput(layoutItem: OutputLayoutItem)}
	{@const output = getOutputById(layoutItem.paramId)}
	{#if output}
		<OutputDisplay
			item={layoutItem}
			value={values[layoutItem.paramId]}
			displayName={layoutItem.displayName}
		/>
	{/if}
{/snippet}

<Tabs.Content value={tab.id} class="min-h-0 p-0 flex-1">
	<ScrollArea class="h-full" orientation="vertical">
		<div class="p-4 tab-content-container">
			{#if tab.groups.length === 0}
				<StateDisplay type="empty" size="medium" message="This tab has no groups configured." />
			{:else}
				<div class="gap-8 flex flex-col">
					{#each tab.groups as group (group.id)}
						{#if evaluateGroupVisibility(group, values)}
							<Group
								label={group.label}
								description={group.description}
								items={group.items}
								columns={group.columns ?? 1}
								collapsed={collapsedGroups[group.id] ?? false}
								{values}
								onToggle={() => onToggleGroup(group.id)}
								inputSnippet={renderInput}
								outputSnippet={renderOutput}
							/>
						{/if}
					{/each}
				</div>
			{/if}
		</div>
	</ScrollArea>
</Tabs.Content>

<style>
	.tab-content-container {
		container-type: inline-size;
	}

	@container (max-width: 320px) {
		:global(.schema-grid) {
			grid-template-columns: 1fr;
		}
	}
	@container (min-width: 321px) and (max-width: 560px) {
		:global(.schema-grid) {
			grid-template-columns: repeat(min(2, var(--schema-cols)), minmax(0, 1fr));
		}
	}

	/* Fallback for browsers without container query support */
	@supports not (container-type: inline-size) {
		@media (max-width: 639px) {
			:global(.schema-grid) {
				grid-template-columns: 1fr;
			}
		}
		@media (min-width: 640px) and (max-width: 1023px) {
			:global(.schema-grid) {
				grid-template-columns: repeat(min(2, var(--schema-cols)), minmax(0, 1fr));
			}
		}
	}
</style>
