<script lang="ts">
	import type { TabConfig } from '@selvajs/schemas';
	import { Button, Input, Label, Popover, Switch, ToggleGroup } from '@selvajs/ui';
	import { ImageIcon, PanelLeft, PanelRight, Plus, Trash2 } from '@lucide/svelte';
	import TabIcon from './TabIcon.svelte';
	import LucideIconPicker from './LucideIconPicker.svelte';

	interface Props {
		tab: TabConfig;
		/** Runs `apply` as an undoable draft edit; see `editDraft`. */
		onEdit: (apply: () => void, coalesceKey?: string) => void;
		onRemove: () => void;
		onAddGroup: () => void;
	}

	let { tab, onEdit, onRemove, onAddGroup }: Props = $props();

	let iconOpen = $state(false);

	function setIcon(icon: string | undefined) {
		onEdit(() => (tab.icon = icon), `tab-icon:${tab.id}`);
	}
</script>

<div class="border-border bg-muted/40 flex flex-wrap items-center gap-2 border-b px-4 py-2">
	<Popover.Root bind:open={iconOpen}>
		<Popover.Trigger>
			{#snippet child({ props })}
				<Button {...props} variant="outline" size="icon-sm" aria-label="Tab icon" title="Tab icon">
					<TabIcon icon={tab.icon} fallback={ImageIcon} />
				</Button>
			{/snippet}
		</Popover.Trigger>
		<Popover.Content align="start">
			<div class="flex flex-col gap-3">
				<LucideIconPicker
					current={tab.icon}
					onPick={(icon) => {
						setIcon(`lucide:${icon.name}`);
						iconOpen = false;
					}}
					onClear={() => {
						setIcon(undefined);
						iconOpen = false;
					}}
				/>
				<div class="flex flex-col gap-1.5">
					<label for="tab-icon" class="text-muted-foreground text-xs">
						Or type one or two letters, or any
						<a
							href="https://icon-sets.iconify.design/"
							target="_blank"
							rel="noopener noreferrer"
							class="text-primary underline">Iconify</a
						>
						id
					</label>
					<Input
						id="tab-icon"
						value={tab.icon ?? ''}
						oninput={(e) => setIcon(e.currentTarget.value.trim() || undefined)}
						placeholder="AB or mdi:home"
						class="h-8"
					/>
				</div>
			</div>
		</Popover.Content>
	</Popover.Root>

	<Input
		aria-label="Tab name"
		value={tab.label}
		oninput={(e) => {
			const label = e.currentTarget.value;
			onEdit(() => (tab.label = label), `tab-label:${tab.id}`);
		}}
		placeholder="Tab name"
		class="w-48"
	/>

	<ToggleGroup.Root
		type="single"
		variant="outline"
		size="sm"
		bind:value={
			() => (tab.position === 'right' ? 'right' : 'left'),
			(side) => {
				if (side) onEdit(() => (tab.position = side === 'right' ? 'right' : undefined));
			}
		}
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
			onCheckedChange={(visible) => onEdit(() => (tab.visible = visible ? undefined : false))}
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
