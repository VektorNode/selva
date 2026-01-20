<script lang="ts">
	import type { VisibilityCondition, VisibilityRule, DiscoveredInput, GroupVisibilityCondition } from '@selva/shared';
	import { Button, Select } from '@selva/shared';
	import RuleRow from './RuleRow.svelte';
	import DefaultValueInput from './DefaultValueInput.svelte';
	import { validateRuleValue, validateDefaultValue } from '$lib/utils/validation';

	interface VisibilityRulesEditorProps {
		visibilityCondition: VisibilityCondition | GroupVisibilityCondition | undefined;
		availableInputs: DiscoveredInput[];
		currentParamInfo?: DiscoveredInput;
		getParameterInfo: (paramId: string) => DiscoveredInput | undefined;
		isGroupCondition?: boolean;
	}

	let {
		visibilityCondition = $bindable(),
		availableInputs,
		currentParamInfo,
		getParameterInfo,
		isGroupCondition = false
	}: VisibilityRulesEditorProps = $props();

	// Validation
	let validationErrors = $derived.by(() => {
		const errors: string[] = [];

		visibilityCondition?.rules?.forEach((rule, idx) => {
			const paramInfo = getParameterInfo(rule.paramId);
			const error = validateRuleValue(rule, paramInfo);
			if (error) errors.push(`Rule ${idx + 1}: ${error}`);
		});

		// Validate defaultValue (only for item conditions, not group conditions)
		if (visibilityCondition && 'defaultValue' in visibilityCondition && visibilityCondition.defaultValue !== undefined) {
			const error = validateDefaultValue(visibilityCondition.defaultValue, currentParamInfo);
			if (error) errors.push(`Default value: ${error}`);
		}

		return errors;
	});

	let hasErrors = $derived(validationErrors.length > 0);

	// Mode toggle
	function setMode(mode: 'all' | 'any') {
		if (visibilityCondition) {
			visibilityCondition.mode = mode;
		}
	}

	function modeButtonClass(mode: 'all' | 'any') {
		const isActive = visibilityCondition?.mode === mode;
		return `rounded border px-2 py-0.5 text-[10px] transition-colors ${
			isActive
				? 'bg-primary text-primary-foreground border-primary'
				: 'border-border/70 hover:border-border hover:bg-accent'
		}`;
	}

	// Rule management
	function addRule() {
		const newRule: VisibilityRule = {
			paramId: '',
			operator: 'equals',
			value: undefined
		};

		if (!visibilityCondition) {
			// Initialize with first rule
			const newCondition: VisibilityCondition | GroupVisibilityCondition = {
				mode: 'all',
				rules: [newRule] as [VisibilityRule, ...VisibilityRule[]],
				action: 'show'
			};
			visibilityCondition = newCondition;
		} else {
			visibilityCondition.rules = [...visibilityCondition.rules, newRule] as [
				VisibilityRule,
				...VisibilityRule[]
			];
		}
	}

	function updateRule(index: number, updatedRule: VisibilityRule) {
		if (!visibilityCondition?.rules) return;
		visibilityCondition.rules[index] = updatedRule;
		visibilityCondition.rules = [...visibilityCondition.rules] as [
			VisibilityRule,
			...VisibilityRule[]
		]; // Trigger reactivity
	}

	function removeRule(index: number) {
		if (!visibilityCondition?.rules) return;
		const filtered = visibilityCondition.rules.filter((_, i) => i !== index);
		if (filtered.length === 0) {
			// If no rules left, remove the entire visibilityCondition
			visibilityCondition = undefined;
		} else {
			visibilityCondition.rules = filtered as [VisibilityRule, ...VisibilityRule[]];
		}
	}
</script>

<div class="flex flex-col gap-3 mt-2">
	<!-- Mode Toggle (AND/OR) -->
	{#if visibilityCondition && visibilityCondition.rules?.length > 1}
		<div class="flex items-center justify-between">
			<span class="text-[10px] text-muted-foreground">Logic Mode</span>
			<div class="flex gap-1">
				<button onclick={() => setMode('all')} class={modeButtonClass('all')}>AND</button>
				<button onclick={() => setMode('any')} class={modeButtonClass('any')}>OR</button>
			</div>
		</div>
	{/if}

	<!-- Rules List -->
	{#if visibilityCondition?.rules && visibilityCondition.rules.length > 0}
		<div class="flex flex-col gap-2">
			{#each visibilityCondition.rules as rule, index (index)}
				<RuleRow
					{rule}
					{index}
					{availableInputs}
					{getParameterInfo}
					{currentParamInfo}
					onUpdate={(updatedRule) => updateRule(index, updatedRule)}
					onRemove={() => removeRule(index)}
				/>
			{/each}
		</div>
	{/if}

	<!-- Add Rule Button -->
	<Button variant="outline" size="sm" onclick={addRule} class="w-full text-[10px] h-7">
		+ Add Rule
	</Button>

	<!-- Action & Default Value -->
	{#if visibilityCondition && visibilityCondition.rules?.length > 0}
		<div class="border-border/70 mt-1 border-t pt-2 flex flex-col gap-2">
			<!-- Action Select -->
			<div class="flex flex-col gap-1">
				<span class="text-muted-foreground text-[10px] font-medium">Action</span>
				<Select.Root
					type="single"
					value={visibilityCondition.action || 'show'}
					onValueChange={(value) => {
						if (visibilityCondition && value) {
							if (isGroupCondition && (value === 'show' || value === 'hide')) {
								visibilityCondition.action = value;
							} else if (!isGroupCondition && (value === 'show' || value === 'hide' || value === 'disable')) {
								visibilityCondition.action = value;
							}
						}
					}}
				>
					<Select.Trigger class="text-[10px] h-6">
						{visibilityCondition.action || 'show'}
					</Select.Trigger>
					<Select.Content>
						<Select.Item value="show" label="Show" />
						<Select.Item value="hide" label="Hide" />
						{#if !isGroupCondition}
							<Select.Item value="disable" label="Disable" />
						{/if}
					</Select.Content>
				</Select.Root>
			</div>

			<!-- Conditional Default Value Input (only for item conditions) -->
			{#if !isGroupCondition && (visibilityCondition.action === 'disable' || visibilityCondition.action === 'hide') && visibilityCondition && 'defaultValue' in visibilityCondition}
				<DefaultValueInput
					paramType={currentParamInfo?.type}
					paramConstraints={currentParamInfo}
					bind:value={visibilityCondition.defaultValue}
				/>
			{/if}
		</div>
	{/if}

	<!-- Validation Errors -->
	{#if hasErrors}
		<div class="bg-destructive/10 border-destructive text-destructive rounded border p-2 text-[9px]">
			{#each validationErrors as error}
				<div>• {error}</div>
			{/each}
		</div>
	{/if}
</div>
