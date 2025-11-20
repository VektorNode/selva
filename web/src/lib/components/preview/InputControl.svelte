<script lang="ts">
	import type {
		InputLayoutItem,
		NumberWidgetConfig,
		TextWidgetConfig,
		DropdownWidgetConfig,
		SupportedTypes
	} from '$lib/types/generated';
	import {
		isNumberWidget,
		isTextWidget,
		isDropdownWidget,
		isCheckboxWidget
	} from '$lib/types/generated';
	import { debounce } from '$lib/utils/debounce';
	import { Input } from '$lib/components/ui/input';
	import { Slider } from '$lib/components/ui/slider';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import * as Dialog from '$lib/components/ui/dialog';
	import Icon from '@iconify/svelte';

	interface Props {
		item: InputLayoutItem;
		value?: unknown;
		displayName?: string;
		onChange: (paramId: string, value: SupportedTypes) => void;
		debounceMs?: number;
	}

	let { item, value = $bindable(), displayName, onChange, debounceMs = 0 }: Props = $props();

	// Generate unique ID for accessibility
	const inputId = $derived(`input-${item.paramId}-${Math.random().toString(36).substring(2, 11)}`);

	const debouncedOnChange = debounce((val: any) => onChange(item.paramId, val), debounceMs);

	function handleChange(newValue: SupportedTypes) {
		value = newValue;
		console.log('InputControl: value changed to', debounceMs);
		if (debounceMs > 0) {
			debouncedOnChange(newValue);
		} else {
			onChange(item.paramId, newValue);
		}
	}

	// For slider rendering, get numeric value
	let sliderValue = $derived(
		isNumberWidget(item) && item.config.renderAsSlider ? (typeof value === 'number' ? value : 0) : 0
	);
</script>

<div class="flex flex-col gap-2">
	<div class="flex items-center gap-2">
		<Label for={inputId}>
			{displayName || item.displayName || item.paramId}
		</Label>
		{#if item.description}
			<Dialog.Root>
				<Dialog.Trigger class="cursor-help text-xs opacity-60 transition-opacity hover:opacity-100">
					<Icon icon="mdi:information-outline" />
				</Dialog.Trigger>
				<Dialog.Content class="sm:max-w-md">
					<Dialog.Header>
						<Dialog.Title>{displayName || item.displayName || item.paramId}</Dialog.Title>
						<Dialog.Description>
							{item.description}
						</Dialog.Description>
					</Dialog.Header>
				</Dialog.Content>
			</Dialog.Root>
		{/if}
	</div>

	{#if isNumberWidget(item)}
		{@const config = item.config as NumberWidgetConfig}
		{#if config.renderAsSlider}
			<div class="flex items-center gap-4">
				<Slider
					type="single"
					value={sliderValue}
					min={config.minimum ?? 0}
					max={config.maximum ?? 100}
					step={config.step ?? 1}
					class="flex-1"
					onValueChange={(val: number) => {
						handleChange(val);
					}}
				/>
				<span class="min-w-12 text-right text-sm text-muted-foreground">
					{value ?? config.minimum ?? 0}
				</span>
			</div>
		{:else}
			<Input
				id={inputId}
				type="number"
				bind:value
				min={config.minimum}
				max={config.maximum}
				step={config.step ?? 1}
				placeholder={config.placeholder}
				oninput={(e) => {
					const target = e.currentTarget as HTMLInputElement;
					const newValue = parseFloat(target.value);
					if (!isNaN(newValue)) {
						handleChange(newValue);
					}
				}}
			/>
		{/if}
	{:else if isCheckboxWidget(item)}
		<div class="flex items-center gap-3">
			<Checkbox
				id={inputId}
				checked={typeof value === 'boolean' ? value : false}
				onCheckedChange={(checked) => handleChange(checked)}
			/>
			<Label for={inputId} class="cursor-pointer text-sm text-muted-foreground">Enabled</Label>
		</div>
	{:else if isTextWidget(item)}
		{@const config = item.config as TextWidgetConfig}
		<Input
			id={inputId}
			type="text"
			bind:value
			placeholder={config.placeholder}
			oninput={(e) => {
				const target = e.currentTarget as HTMLInputElement;
				handleChange(target.value);
			}}
		/>
	{:else if isDropdownWidget(item)}
		{@const config = item.config as DropdownWidgetConfig}
		<Select.Root
			type="single"
			value={typeof value === 'string' ? value : undefined}
			onValueChange={(selected: string) => {
				if (selected) {
					handleChange(selected);
				}
			}}
		>
			<Select.Trigger class="w-full">
				{value || 'Select an option...'}
			</Select.Trigger>
			<Select.Content>
				{#each config.options || [] as opt}
					<Select.Item value={opt} label={opt} />
				{/each}
			</Select.Content>
		</Select.Root>
	{/if}
</div>
