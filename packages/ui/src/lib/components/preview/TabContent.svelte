<script lang="ts">
	import type {
		TabConfig,
		SchemaInput,
		DiscoveredOutput,
		SupportedTypes,
		InputLayoutItem,
		OutputLayoutItem
	} from '@selvajs/schemas';
	import * as Tabs from '$lib/components/primitives/tabs';
	import { ScrollArea } from '$lib/components/primitives/scroll-area';
	import StateDisplay from '../primitives/StateDisplay.svelte';
	import Group from './Group.svelte';
	import InputControl from './InputControl.svelte';
	import OutputDisplay from './OutputDisplay.svelte';
	import { evaluateGroupVisibility } from '$lib/schema/visibility-rules';
	import { isSupportedOn, layoutItemKind } from '$lib/schema/host-support';
	import { getHostContext } from '$lib/contexts/hostContext.svelte';
	import { getLocaleContext } from '$lib/i18n/localeContext.svelte';

	const locale = getLocaleContext();
	const t = $derived(locale.messages);

	interface Props {
		tab: TabConfig;
		values: Record<string, unknown>;
		collapsedGroups: Record<string, boolean>;
		onToggleGroup: (groupId: string) => void;
		onValueChange: (paramId: string, value: SupportedTypes, forceSolve?: boolean) => void;
		inputs: SchemaInput[];
		outputs: DiscoveredOutput[];
		/** Computed value list options keyed by the target dynamic-value-list input id. */
		dynamicOptions?: Record<string, Record<string, string>>;
	}

	let {
		tab,
		values,
		collapsedGroups,
		onToggleGroup,
		onValueChange,
		inputs,
		outputs,
		dynamicOptions = {}
	}: Props = $props();

	const { host } = getHostContext();

	// An element this host can't render is left out, not shown broken: its input still solves with
	// the definition's own default. A group left with nothing to show goes too.
	const visibleGroups = $derived(
		tab.groups
			.filter((group) => evaluateGroupVisibility(group, values))
			.flatMap((group) => {
				const items = group.items.filter((item) =>
					isSupportedOn(host, layoutItemKind(item, inputs))
				);
				return items.length > 0 || group.items.length === 0 ? [{ ...group, items }] : [];
			})
	);

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
			dynamicOptions={dynamicOptions[input.id]}
			paramType={input.paramType}
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

<Tabs.Content value={tab.id} class="min-h-0">
	<div class="h-full bg-muted dark:bg-background">
		<ScrollArea class="h-full" orientation="vertical">
			<div class="px-3">
				<!-- A heading per panel lets a screen reader jump between them; the tab, when shown,
				     already names it on screen. -->
				<h2 class="sr-only">{tab.label}</h2>
				{#if visibleGroups.length === 0}
					<StateDisplay type="empty" size="medium" message={t.tabNoGroups} />
				{:else}
					<div class="gap-3 py-3 flex flex-col">
						{#each visibleGroups as group (group.id)}
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
								flat={visibleGroups.length === 1}
							/>
						{/each}
					</div>
				{/if}
			</div>
		</ScrollArea>
	</div>
</Tabs.Content>
