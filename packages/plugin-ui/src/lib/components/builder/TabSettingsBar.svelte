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
		/** Tab names are unique: a name another tab has is never committed. */
		isLabelTaken: (label: string) => boolean;
	}

	let { tab, onEdit, onRemove, onAddGroup, isLabelTaken }: Props = $props();

	let iconOpen = $state(false);
	let labelError = $state<string | null>(null);

	function renameTo(input: HTMLInputElement) {
		const label = input.value;
		if (isLabelTaken(label)) {
			labelError = `A tab named “${label.trim()}” already exists`;
			return;
		}
		labelError = null;
		onEdit(() => (tab.label = label), `tab-label:${tab.id}`);
	}

	// Leaving the field with a taken name puts back the last name that was kept.
	function settleLabel(input: HTMLInputElement) {
		if (!labelError) return;
		input.value = tab.label;
		labelError = null;
	}

	function setIcon(icon: string | undefined) {
		onEdit(() => (tab.icon = icon), `tab-icon:${tab.id}`);
	}
</script>

<div class="bg-card flex flex-wrap items-center gap-x-5 gap-y-3 border-b px-5 py-4">
	<Popover.Root bind:open={iconOpen}>
		<Popover.Trigger>
			{#snippet child({ props })}
				<Button {...props} variant="outline" size="icon" aria-label="Tab icon" title="Tab icon">
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

	<div class="relative">
		<Input
			aria-label="Tab name"
			aria-invalid={labelError ? true : undefined}
			aria-describedby={labelError ? 'tab-name-error' : undefined}
			value={tab.label}
			oninput={(e) => renameTo(e.currentTarget)}
			onblur={(e) => settleLabel(e.currentTarget)}
			placeholder="Tab name"
			class="border-border-strong h-9 w-56"
		/>
		{#if labelError}
			<p id="tab-name-error" class="text-destructive absolute top-full left-0 mt-1 text-xs">
				{labelError}
			</p>
		{/if}
	</div>

	<div class="bg-border hidden h-6 w-px sm:block"></div>

	<ToggleGroup.Root
		type="single"
		variant="outline"
		size="lg"
		bind:value={
			() => (tab.position === 'right' ? 'right' : 'left'),
			(side) => {
				if (side) onEdit(() => (tab.position = side === 'right' ? 'right' : undefined));
			}
		}
		aria-label="Panel side"
		class="[&_[data-slot=toggle-group-item]]:border-border-strong"
	>
		<ToggleGroup.Item value="left" aria-label="Left panel" title="Left panel">
			<PanelLeft />
		</ToggleGroup.Item>
		<ToggleGroup.Item value="right" aria-label="Right panel" title="Right panel">
			<PanelRight />
		</ToggleGroup.Item>
	</ToggleGroup.Root>

	<div class="border-border-strong flex h-9 items-center gap-2.5 rounded-md border px-3">
		<Switch
			id="tab-visible"
			checked={tab.visible !== false}
			onCheckedChange={(visible) => onEdit(() => (tab.visible = visible ? undefined : false))}
		/>
		<Label for="tab-visible" class="cursor-pointer">Visible</Label>
	</div>

	<div class="ml-auto flex items-center gap-3">
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
