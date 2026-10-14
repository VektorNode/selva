<script lang="ts">
	import type { TabConfig } from '@selvajs/schemas';
	import { Button, Input, Label, Popover, Switch, ToggleGroup } from '@selvajs/ui';
	import { ImageIcon, PanelLeft, PanelRight, Plus, Trash2 } from '@lucide/svelte';
	import TabIcon from './TabIcon.svelte';

	interface Props {
		/** The active tab; edits write straight into it, like every other field on the canvas. */
		tab: TabConfig;
		onRemove: () => void;
		onAddGroup: () => void;
	}

	let { tab, onRemove, onAddGroup }: Props = $props();
</script>

<div class="border-border bg-muted/40 flex flex-wrap items-center gap-2 border-b px-4 py-2">
	<Popover.Root>
		<Popover.Trigger>
			{#snippet child({ props })}
				<Button {...props} variant="outline" size="icon-sm" aria-label="Tab icon" title="Tab icon">
					<TabIcon icon={tab.icon} fallback={ImageIcon} />
				</Button>
			{/snippet}
		</Popover.Trigger>
		<Popover.Content align="start">
			<div class="flex flex-col gap-2">
				<Label for="tab-icon">Icon</Label>
				<div class="flex gap-2">
					<Input
						id="tab-icon"
						value={tab.icon ?? ''}
						oninput={(e) => (tab.icon = e.currentTarget.value.trim() || undefined)}
						placeholder="AB or mdi:home"
					/>
					{#if tab.icon}
						<Button variant="ghost" size="sm" onclick={() => (tab.icon = undefined)}>Clear</Button>
					{/if}
				</div>
				<p class="text-muted-foreground text-xs">
					One or two letters, or an
					<a
						href="https://icon-sets.iconify.design/"
						target="_blank"
						rel="noopener noreferrer"
						class="text-primary underline">Iconify</a
					>
					id such as <code>mdi:home</code>.
				</p>
			</div>
		</Popover.Content>
	</Popover.Root>

	<Input
		aria-label="Tab name"
		value={tab.label}
		oninput={(e) => (tab.label = e.currentTarget.value)}
		placeholder="Tab name"
		class="w-48"
	/>

	<ToggleGroup.Root
		type="single"
		variant="outline"
		size="sm"
		value={tab.position === 'right' ? 'right' : 'left'}
		onValueChange={(side) => {
			if (side) tab.position = side === 'right' ? 'right' : undefined;
		}}
		aria-label="Panel side"
	>
		<ToggleGroup.Item value="left" aria-label="Left panel" title="Left panel">
			<PanelLeft />
		</ToggleGroup.Item>
		<ToggleGroup.Item value="right" aria-label="Right panel" title="Right panel">
			<PanelRight />
		</ToggleGroup.Item>
	</ToggleGroup.Root>

	<div class="flex items-center gap-2">
		<Switch
			id="tab-visible"
			checked={tab.visible !== false}
			onCheckedChange={(visible) => (tab.visible = visible ? undefined : false)}
		/>
		<Label for="tab-visible">Visible</Label>
	</div>

	<div class="ml-auto flex items-center gap-2">
		<Button variant="ghost" size="sm" onclick={onRemove}>
			<Trash2 />
			Delete tab
		</Button>
		<Button variant="outline" size="sm" onclick={onAddGroup}>
			<Plus />
			Add group
		</Button>
	</div>
</div>
