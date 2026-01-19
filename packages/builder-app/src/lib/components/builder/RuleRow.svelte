<script lang="ts">
	import type { VisibilityRule, DiscoveredInput } from '@selva/shared';
	import { Button, Badge, Input, Select } from '@selva/shared';
	import { X } from '@lucide/svelte';
	import { validateRuleValue, getOperatorsForType } from '$lib/utils/validation';

	interface RuleRowProps {
		rule: VisibilityRule;
		index: number;
		availableInputs: DiscoveredInput[];
		getParameterInfo: (paramId: string) => DiscoveredInput | undefined;
		currentParamInfo?: DiscoveredInput;
		onUpdate: (updatedRule: VisibilityRule) => void;
		onRemove: () => void;
	}

	let {
		rule,
		index,
		availableInputs,
		getParameterInfo,
		currentParamInfo,
		onUpdate,
		onRemove
	}: RuleRowProps = $props();

	// Filter inputs (exclude current parameter to prevent self-referencing)
	let filteredInputs = $derived(
		availableInputs.filter((input) => input.id !== currentParamInfo?.id)
	);

	// Get parameter info for selected input
	let selectedParamInfo = $derived(rule.paramId ? getParameterInfo(rule.paramId) : undefined);

	// Get operators for selected param type
	let availableOperators = $derived(getOperatorsForType(selectedParamInfo?.type));

	// Validation
	let validationError = $derived(validateRuleValue(rule, selectedParamInfo));

	// Handle value changes
	function updateRuleValue(newValue: unknown) {
		rule.value = newValue as { [k: string]: unknown } | undefined;
		onUpdate(rule);
	}

	function updateRuleOperator(
		newOperator:
			| 'equals'
			| 'notEquals'
			| 'greaterThan'
			| 'lessThan'
			| 'greaterThanOrEqual'
			| 'lessThanOrEqual'
			| 'between'
			| 'in'
			| 'notIn'
	) {
		rule.operator = newOperator;
		// Clear value when operator changes (especially for between/in/notIn)
		if (newOperator === 'between' || newOperator === 'in' || newOperator === 'notIn') {
			rule.value = undefined;
			rule.values = [];
		} else {
			rule.values = undefined;
		}
		onUpdate(rule);
	}
</script>

<div class="grid grid-cols-[1fr_120px_1fr_32px] gap-2 items-start">
	<!-- Input Select -->
	<div class="flex flex-col gap-1">
		<Select.Root
			type="single"
			value={rule.paramId}
			onValueChange={(value) => {
				if (value) {
					rule.paramId = value;
					onUpdate(rule);
				}
			}}
		>
			<Select.Trigger class="text-[10px] h-6">
				{selectedParamInfo?.nickname || 'Select input...'}
			</Select.Trigger>
			<Select.Content>
				{#each filteredInputs as input (input.id)}
					<Select.Item value={input.id} label={input.nickname}>
						<div class="flex items-center gap-2">
							<Badge variant="outline" class="text-[8px]">{input.type}</Badge>
							<span>{input.nickname}</span>
						</div>
					</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	</div>

	<!-- Operator Select -->
	<div class="flex flex-col gap-1">
		<Select.Root
			type="single"
			value={rule.operator}
			onValueChange={(value) => {
				if (
					value &&
					(value === 'equals' ||
						value === 'notEquals' ||
						value === 'greaterThan' ||
						value === 'lessThan' ||
						value === 'greaterThanOrEqual' ||
						value === 'lessThanOrEqual' ||
						value === 'between' ||
						value === 'in' ||
						value === 'notIn')
				) {
					updateRuleOperator(value);
				}
			}}
		>
			<Select.Trigger class="text-[10px] h-6">
				{rule.operator || 'Operator'}
			</Select.Trigger>
			<Select.Content>
				{#each availableOperators as op}
					<Select.Item value={op.value} label={op.label} />
				{/each}
			</Select.Content>
		</Select.Root>
	</div>

	<!-- Value Input (dynamic based on operator) -->
	<div class="flex flex-col gap-1">
		{#if rule.operator === 'between'}
			<!-- Two inputs for min/max -->
			<div class="flex gap-1">
				<Input
					type="number"
					value={rule.values?.[0]}
					onchange={(e) => {
						const val = (e.target as HTMLInputElement).value;
						rule.values = [Number(val), rule.values?.[1] || 0];
						onUpdate(rule);
					}}
					class="border-border/70 bg-background focus:border-primary text-[10px] h-6 rounded border px-2 focus:outline-none"
					placeholder="Min"
				/>
				<Input
					type="number"
					value={rule.values?.[1]}
					onchange={(e) => {
						const val = (e.target as HTMLInputElement).value;
						rule.values = [rule.values?.[0] || 0, Number(val)];
						onUpdate(rule);
					}}
					class="border-border/70 bg-background focus:border-primary text-[10px] h-6 rounded border px-2 focus:outline-none"
					placeholder="Max"
				/>
			</div>
		{:else if rule.operator === 'in' || rule.operator === 'notIn'}
			<!-- Textarea for multiple values (comma-separated) -->
			<Input
				type="text"
				value={rule.values?.join(',') || ''}
				onchange={(e) => {
					const val = (e.target as HTMLInputElement).value;
					rule.values = val.split(',').map((v) => v.trim());
					onUpdate(rule);
				}}
				class="border-border/70 bg-background focus:border-primary text-[10px] h-6 rounded border px-2 focus:outline-none"
				placeholder="value1,value2,..."
			/>
		{:else}
			<!-- Single value input -->
			{#if selectedParamInfo?.type === 'valueList' && selectedParamInfo?.options}
				<!-- Value list: show dropdown with option names -->
				<Select.Root
					type="single"
					value={String(rule.value || '')}
					onValueChange={(value) => {
						if (value) updateRuleValue(value);
					}}
				>
					<Select.Trigger
						class="text-[10px] h-6 {validationError
							? 'border-destructive'
							: 'border-border/70'}"
					>
						{#if rule.value}
							{@const optionEntry = Object.entries(selectedParamInfo.options).find(
								([_, val]) => val === rule.value
							)}
							{optionEntry ? optionEntry[0] : rule.value}
						{:else}
							Select value...
						{/if}
					</Select.Trigger>
					<Select.Content>
						{#each Object.entries(selectedParamInfo.options) as [name, val]}
							<Select.Item value={val || ''} label={name} />
						{/each}
					</Select.Content>
				</Select.Root>
			{:else}
				<!-- Other types: text or number input -->
				<Input
					type={selectedParamInfo?.type === 'number' || selectedParamInfo?.type === 'integer'
						? 'number'
						: 'text'}
					value={rule.value}
					onchange={(e) => {
						const val = (e.target as HTMLInputElement).value;
						updateRuleValue(
							selectedParamInfo?.type === 'number' || selectedParamInfo?.type === 'integer'
								? Number(val)
								: val
						);
					}}
					class="text-[10px] h-6 rounded border px-2 focus:outline-none {validationError
						? 'border-destructive'
						: 'border-border/70 bg-background focus:border-primary'}"
					placeholder="Value"
				/>
			{/if}
		{/if}

		<!-- Validation Error -->
		{#if validationError}
			<span class="text-destructive text-[9px]">{validationError}</span>
		{/if}
	</div>

	<!-- Remove Button -->
	<Button
		variant="ghost"
		size="icon-sm"
		class="hover:bg-destructive hover:text-destructive-foreground h-6 w-6"
		onclick={onRemove}
	>
		<X size={12} />
	</Button>
</div>
