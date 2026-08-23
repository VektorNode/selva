<script lang="ts">
	import type { VisibilityRule, DiscoveredInput } from '@selvajs/schemas';
	import { Button, Badge, Input, Select } from '@selvajs/ui';
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
		index: _index,
		availableInputs,
		getParameterInfo,
		currentParamInfo,
		onUpdate,
		onRemove
	}: RuleRowProps = $props();

	// Exclude the parameter this rule lives on, so it can't reference itself.
	let filteredInputs = $derived(
		availableInputs.filter((input) => input.id !== currentParamInfo?.id)
	);

	let selectedParamInfo = $derived(rule.paramId ? getParameterInfo(rule.paramId) : undefined);
	let availableOperators = $derived(getOperatorsForType(selectedParamInfo?.type));
	let validationError = $derived(validateRuleValue(rule, selectedParamInfo));

	function updateRuleValue(newValue: unknown) {
		const updatedRule = { ...rule, value: newValue as { [k: string]: unknown } | undefined };
		onUpdate(updatedRule);
	}

	type RuleOperator =
		| 'equals'
		| 'notEquals'
		| 'greaterThan'
		| 'lessThan'
		| 'greaterThanOrEqual'
		| 'lessThanOrEqual'
		| 'between'
		| 'in'
		| 'notIn'
		| 'matches'
		| 'contains'
		| 'containsAny'
		| 'isEmpty'
		| 'isNotEmpty';

	const RULE_OPERATORS = new Set<RuleOperator>([
		'equals',
		'notEquals',
		'greaterThan',
		'lessThan',
		'greaterThanOrEqual',
		'lessThanOrEqual',
		'between',
		'in',
		'notIn',
		'matches',
		'contains',
		'containsAny',
		'isEmpty',
		'isNotEmpty'
	]);

	function isRuleOperator(value: string): value is RuleOperator {
		return RULE_OPERATORS.has(value as RuleOperator);
	}

	function updateRuleOperator(newOperator: RuleOperator) {
		const updatedRule = { ...rule, operator: newOperator };
		// Reset value/values: the old operator's value shape (single vs. multi vs. none) may not fit the new one.
		if (
			newOperator === 'between' ||
			newOperator === 'in' ||
			newOperator === 'notIn' ||
			newOperator === 'containsAny'
		) {
			updatedRule.value = undefined;
			updatedRule.values = [];
		} else if (newOperator === 'isEmpty' || newOperator === 'isNotEmpty') {
			updatedRule.value = undefined;
			updatedRule.values = undefined;
		} else {
			updatedRule.values = undefined;
		}
		onUpdate(updatedRule);
	}
</script>

<div class="flex items-start gap-2">
	<div class="flex flex-1 flex-col gap-1">
		<Select.Root
			type="single"
			value={rule.paramId}
			onValueChange={(value) => {
				if (value) {
					onUpdate({ ...rule, paramId: value });
				}
			}}
		>
			<Select.Trigger class="h-9 text-sm">
				<span>{selectedParamInfo?.nickname || 'Select input...'}</span>
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

	<div class="flex flex-none flex-col gap-1">
		<Select.Root
			type="single"
			value={rule.operator}
			onValueChange={(value) => {
				if (value && isRuleOperator(value)) {
					updateRuleOperator(value);
				}
			}}
		>
			<Select.Trigger class="h-9 w-50 text-sm">
				<span class="truncate">{rule.operator || 'Op'}</span>
			</Select.Trigger>
			<Select.Content>
				{#each availableOperators as op (op.value)}
					<Select.Item value={op.value} label={op.label} />
				{/each}
			</Select.Content>
		</Select.Root>
	</div>

	<div class="flex flex-1 flex-col gap-1">
		{#if rule.operator === 'between'}
			<div class="flex gap-2">
				<Input
					type="number"
					step={selectedParamInfo?.type === 'integer' ? '1' : 'any'}
					value={rule.values?.[0]}
					onchange={(e) => {
						const val = (e.target as HTMLInputElement).value;
						onUpdate({ ...rule, values: [Number(val), rule.values?.[1] || 0] });
					}}
					class="h-9"
					placeholder="Min"
				/>
				<Input
					type="number"
					step={selectedParamInfo?.type === 'integer' ? '1' : 'any'}
					value={rule.values?.[1]}
					onchange={(e) => {
						const val = (e.target as HTMLInputElement).value;
						onUpdate({ ...rule, values: [rule.values?.[0] || 0, Number(val)] });
					}}
					class="h-9"
					placeholder="Max"
				/>
			</div>
		{:else if rule.operator === 'isEmpty' || rule.operator === 'isNotEmpty'}
			<span class="text-muted-foreground text-[10px] italic">no value required</span>
		{:else if rule.operator === 'in' || rule.operator === 'notIn' || rule.operator === 'containsAny'}
			<!-- Multi-select for ValueList, comma-separated input for other types -->
			{#if selectedParamInfo?.type === 'valueList' && selectedParamInfo?.options && Object.keys(selectedParamInfo.options).length > 0}
				<Select.Root
					type="multiple"
					value={(rule.values || []) as string[]}
					onValueChange={(value) => {
						if (value && Array.isArray(value)) {
							onUpdate({ ...rule, values: value as string[] });
						}
					}}
				>
					<Select.Trigger class="h-9 text-sm">
						{#if rule.values && rule.values.length > 0}
							{@const selectedNames = (rule.values as string[])
								.map((val) => {
									const entry = Object.entries(selectedParamInfo.options || {}).find(
										([_, v]) => v === val
									);
									return entry ? entry[0] : val;
								})
								.filter(Boolean)}
							<span class="truncate">{selectedNames.join(', ')}</span>
						{:else}
							Select values...
						{/if}
					</Select.Trigger>
					<Select.Content>
						{#each Object.entries(selectedParamInfo.options) as [name, val] (name)}
							<Select.Item value={val || ''} label={name}>
								{#snippet children({ selected })}
									{name}
									{#if selected}
										<span class="ml-auto">✓</span>
									{/if}
								{/snippet}
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			{:else}
				<Input
					type="text"
					value={rule.values?.join(',') || ''}
					onchange={(e) => {
						const val = (e.target as HTMLInputElement).value;
						onUpdate({ ...rule, values: val.split(',').map((v) => v.trim()) });
					}}
					class="h-9"
					placeholder="value1,value2,..."
				/>
			{/if}
		{:else}
			{#if selectedParamInfo?.type === 'boolean'}
				<Select.Root
					type="single"
					value={String(rule.value || '')}
					onValueChange={(value) => {
						if (value) updateRuleValue(value === 'true');
					}}
				>
					<Select.Trigger class="h-9 text-sm">
						{#if rule.value !== undefined && rule.value !== null}
							{String(rule.value)}
						{:else}
							Select value...
						{/if}
					</Select.Trigger>
					<Select.Content>
						<Select.Item value="true" label="true" />
						<Select.Item value="false" label="false" />
					</Select.Content>
				</Select.Root>
			{:else if selectedParamInfo?.type === 'valueList' && selectedParamInfo?.options}
				<Select.Root
					type="single"
					value={String(rule.value || '')}
					onValueChange={(value) => {
						if (value) updateRuleValue(value);
					}}
				>
					<Select.Trigger class="h-9 text-sm">
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
						{#each Object.entries(selectedParamInfo.options) as [name, val] (name)}
							<Select.Item value={val || ''} label={name} />
						{/each}
					</Select.Content>
				</Select.Root>
			{:else}
				<Input
					type={selectedParamInfo?.type === 'number' || selectedParamInfo?.type === 'integer'
						? 'number'
						: 'text'}
					step={selectedParamInfo?.type === 'integer' ? '1' : 'any'}
					value={rule.value}
					onchange={(e) => {
						const val = (e.target as HTMLInputElement).value;
						updateRuleValue(
							selectedParamInfo?.type === 'number' || selectedParamInfo?.type === 'integer'
								? Number(val)
								: val
						);
					}}
					class="h-9"
					placeholder="Value"
				/>
			{/if}
		{/if}

		{#if validationError}
			<span class="text-destructive text-[9px]">{validationError}</span>
		{/if}
	</div>

	<Button variant="ghost" size="icon" class="h-9 w-9 flex-none" onclick={onRemove}>
		<X size={16} />
	</Button>
</div>
