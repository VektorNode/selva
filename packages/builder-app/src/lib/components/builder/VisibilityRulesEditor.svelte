<script lang="ts">
	import type {
		VisibilityCondition,
		VisibilityRule,
		DiscoveredInput,
		GroupVisibilityCondition
	} from '@selva/shared';
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
		options?: Record<string, string | undefined>;
	}

	let {
		visibilityCondition = $bindable(),
		availableInputs,
		currentParamInfo,
		getParameterInfo,
		isGroupCondition = false,
		options
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
		if (visibilityCondition && !isGroupCondition) {
			const item = visibilityCondition as VisibilityCondition;
			if (
				(item.action === 'disable' || item.action === 'hide') &&
				item.defaultValue !== undefined
			) {
				const error = validateDefaultValue(item.defaultValue, currentParamInfo);
				if (error) errors.push(`Default value: ${error}`);
			}
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
		return `px-2 py-0.5 text-[9px] rounded-sm transition-all ${
			isActive
				? 'bg-background shadow-sm text-foreground font-medium'
				: 'text-muted-foreground hover:text-foreground hover:bg-background/50'
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

<div class="mt-2 flex flex-col gap-4">
	<!-- Conditions Section -->
	<div class="flex flex-col gap-2">
		<div class="flex items-center justify-between px-1">
			<span class="text-foreground text-[11px] font-semibold">When...</span>

			<!-- Logic Mode Toggle -->
			{#if visibilityCondition && visibilityCondition.rules?.length > 1}
				<div class="bg-muted flex h-6 items-center gap-0.5 rounded p-0.5">
					<button onclick={() => setMode('all')} class={modeButtonClass('all')}>AND</button>
					<button onclick={() => setMode('any')} class={modeButtonClass('any')}>OR</button>
				</div>
			{/if}
		</div>

		{#if visibilityCondition?.rules && visibilityCondition.rules.length > 0}
			<div class="border-border/50 flex flex-col gap-2 border-l-2 pl-1">
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

		<Button
			variant="ghost"
			size="sm"
			onclick={addRule}
			class="border-border/60 text-muted-foreground hover:bg-muted/50 hover:text-foreground h-7 w-full border border-dashed text-[10px]"
		>
			+ Add Condition
		</Button>
	</div>

	<!-- Effects Section -->
	{#if visibilityCondition && visibilityCondition.rules?.length > 0}
		<div class="border-border/60 bg-muted/20 flex flex-col gap-3 rounded-lg border p-3">
			<span class="text-foreground text-[11px] font-semibold">Then...</span>

			<div class="grid grid-cols-[1fr,1.5fr] items-start gap-3">
				<!-- Action Select -->
				<div class="flex flex-col gap-1.5">
					<span class="text-muted-foreground text-[10px] font-medium tracking-wider uppercase"
						>Action</span
					>
					<Select.Root
						type="single"
						value={visibilityCondition.action || 'show'}
						onValueChange={(value) => {
							if (visibilityCondition && value) {
								if (isGroupCondition && (value === 'show' || value === 'hide')) {
									visibilityCondition.action = value;
								} else if (
									!isGroupCondition &&
									(value === 'show' || value === 'hide' || value === 'disable')
								) {
									visibilityCondition.action = value;
								}
							}
						}}
					>
						<Select.Trigger class="bg-background h-8 text-[11px]">
							{visibilityCondition.action?.toUpperCase() || 'SHOW'}
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

				<!-- Conditional Default Value Input -->
				{#if !isGroupCondition && (visibilityCondition.action === 'disable' || visibilityCondition.action === 'hide')}
					<div class="flex flex-col gap-1.5">
						<span class="text-muted-foreground text-[10px] font-medium tracking-wider uppercase"
							>Set Value To</span
						>
						<div class="h-8 [&_.flex-col]:gap-0 [&_span]:hidden">
							<DefaultValueInput
								paramType={currentParamInfo?.type}
								paramConstraints={currentParamInfo}
								{options}
								bind:value={(visibilityCondition as VisibilityCondition).defaultValue}
							/>
						</div>
					</div>
				{:else}
					<div class="flex flex-col gap-1.5">
						<span class="text-muted-foreground/30 text-[10px] font-medium tracking-wider uppercase"
							>Set Value To</span
						>
						<div
							class="border-border/40 bg-muted/10 text-muted-foreground/40 flex h-8 items-center rounded border border-dashed px-3 text-[10px] italic"
						>
							Keep current value
						</div>
					</div>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Validation Errors -->
	{#if hasErrors}
		<div
			class="bg-destructive/10 border-destructive text-destructive rounded border p-2 text-[9px]"
		>
			{#each validationErrors as error}
				<div>• {error}</div>
			{/each}
		</div>
	{/if}
</div>
