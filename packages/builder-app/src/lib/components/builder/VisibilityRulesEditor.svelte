<script lang="ts">
	import type {
		VisibilityCondition,
		VisibilityRule,
		DiscoveredInput,
		GroupVisibilityCondition
	} from '@selvajs/ui';
	import { Button, Select } from '@selvajs/ui';
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
			visibilityCondition.rules.push(newRule);
		}
	}

	function updateRule(index: number, updatedRule: VisibilityRule) {
		if (!visibilityCondition?.rules) return;
		visibilityCondition.rules[index] = updatedRule;
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

<div class="flex flex-col gap-3">
	<!-- Conditions Section -->
	<div class=" border-border rounded-lg border p-3">
		<!-- Header with Mode Toggle -->
		<div class="mb-3 flex items-center justify-between gap-2">
			<div class="flex items-center gap-2">
				<div class="bg-primary h-4 w-1 rounded-full"></div>
				<span class="text-foreground text-[11px] font-semibold uppercase">Conditions</span>
			</div>

			<!-- Logic Mode Toggle -->
			{#if visibilityCondition && visibilityCondition.rules?.length > 1}
				<div class=" border-border flex h-5 items-center gap-0 rounded border">
					<button
						onclick={() => setMode('all')}
						class={`px-2 text-[9px] font-medium transition-colors ${
							visibilityCondition.mode === 'all'
								? 'bg-primary text-primary-foreground'
								: 'text-muted-foreground hover:text-foreground'
						}`}
					>
						ALL
					</button>
					<div class="bg-border/20 h-3 w-px"></div>
					<button
						onclick={() => setMode('any')}
						class={`px-2 text-[9px] font-medium transition-colors ${
							visibilityCondition.mode === 'any'
								? 'bg-primary text-primary-foreground'
								: 'text-muted-foreground hover:text-foreground'
						}`}
					>
						ANY
					</button>
				</div>
			{/if}
		</div>

		<!-- Rules List -->
		{#if visibilityCondition?.rules && visibilityCondition.rules.length > 0}
			<div class="space-y-2">
				{#each visibilityCondition.rules as rule, index (rule.paramId + index)}
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

			<!-- Add Rule Button -->
			<Button variant="dashed" size="sm" onclick={addRule} class="mt-2">+ Add Condition</Button>
		{:else}
			<!-- Empty State -->
			<Button variant="dashed" size="sm" onclick={addRule}>+ Add your first condition</Button>
		{/if}
	</div>

	<!-- Effects Section -->
	{#if visibilityCondition && visibilityCondition.rules?.length > 0}
		<div class=" border-border rounded-lg border p-3">
			<!-- Header -->
			<div class="mb-3 flex items-center gap-2">
				<div class="bg-primary h-4 w-1 rounded-full"></div>
				<span class="text-foreground text-[11px] font-semibold uppercase">Then</span>
			</div>

			<div class="grid grid-cols-2 gap-3">
				<!-- Action Select -->
				<div class="flex flex-col gap-1.5">
					<span class="text-muted-foreground text-[9px] font-semibold tracking-wider uppercase">
						Action
					</span>
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
						<Select.Trigger class="h-9">
							<span class="text-sm font-medium"
								>{visibilityCondition.action?.toUpperCase() || 'SHOW'}</span
							>
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
						<span class="text-muted-foreground text-[9px] font-semibold tracking-wider uppercase">
							Set Value To
						</span>
						<DefaultValueInput
							paramType={currentParamInfo?.type}
							paramConstraints={currentParamInfo}
							{options}
							bind:value={(visibilityCondition as VisibilityCondition).defaultValue}
						/>
					</div>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Validation Errors -->
	{#if hasErrors}
		<div class="border-destructive/40 bg-destructive/5 rounded-lg border p-2">
			<div class="mb-1.5 flex items-center gap-1.5">
				<span class="text-destructive text-[9px] font-semibold uppercase">Errors</span>
			</div>
			<div class="space-y-0.5">
				{#each validationErrors as error (error)}
					<div class="text-destructive/90 text-[9px]">• {error}</div>
				{/each}
			</div>
		</div>
	{/if}
</div>
