<script lang="ts">
	import type {
		VisibilityCondition,
		VisibilityRule,
		DiscoveredInput,
		GroupVisibilityCondition
	} from '@selvajs/schemas';
	import { Button, Label, Switch } from '@selvajs/ui';
	import RuleRow from './RuleRow.svelte';
	import DefaultValueInput from './DefaultValueInput.svelte';
	import { validateRuleValue, validateDefaultValue } from '#lib/utils/validation.js';

	interface VisibilityRulesEditorProps {
		visibilityCondition: VisibilityCondition | GroupVisibilityCondition | undefined;
		availableInputs: DiscoveredInput[];
		currentParamInfo?: DiscoveredInput;
		getParameterInfo: (paramId: string) => DiscoveredInput | undefined;
		isGroupCondition?: boolean;
		options?: Record<string, string | undefined>;
		/** Static visibility. Leave unbound where the item has no such field. */
		visible?: boolean;
		showAlwaysHidden?: boolean;
	}

	let {
		visibilityCondition = $bindable(),
		availableInputs,
		currentParamInfo,
		getParameterInfo,
		isGroupCondition = false,
		options,
		visible = $bindable(),
		showAlwaysHidden = false
	}: VisibilityRulesEditorProps = $props();

	let validationErrors = $derived.by(() => {
		const errors: string[] = [];

		visibilityCondition?.rules?.forEach((rule, idx) => {
			const paramInfo = getParameterInfo(rule.paramId);
			const error = validateRuleValue(rule, paramInfo);
			if (error) errors.push(`Rule ${idx + 1}: ${error}`);
		});

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

	const ACTIONS = [
		{ value: 'show', label: 'Show' },
		{ value: 'hide', label: 'Hide' },
		{ value: 'disable', label: 'Disable' }
	] as const;

	function setAction(action: (typeof ACTIONS)[number]['value']) {
		if (!visibilityCondition) return;
		if (isGroupCondition && action === 'disable') return;
		visibilityCondition.action = action;
	}

	const MODES = [
		{ value: 'all', label: 'All', title: 'Every condition must match' },
		{ value: 'any', label: 'Any', title: 'One matching condition is enough' }
	] as const;

	function setMode(mode: 'all' | 'any') {
		if (visibilityCondition) {
			visibilityCondition.mode = mode;
		}
	}

	function addRule() {
		const newRule: VisibilityRule = {
			paramId: '',
			operator: 'equals',
			value: undefined
		};

		if (!visibilityCondition) {
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
			visibilityCondition = undefined;
		} else {
			visibilityCondition.rules = filtered as [VisibilityRule, ...VisibilityRule[]];
		}
	}
</script>

<div class="flex flex-col gap-3">
	{#if showAlwaysHidden}
		<div class="border-border flex items-center justify-between gap-3 rounded-lg border p-3">
			<Label for="always-hidden" class="text-[11px] font-semibold uppercase">Always hidden</Label>
			<Switch
				id="always-hidden"
				checked={visible === false}
				onCheckedChange={(hidden) => (visible = hidden ? false : undefined)}
			/>
		</div>
	{/if}

	<div
		class="flex flex-col gap-3 {visible === false ? 'pointer-events-none opacity-50' : ''}"
		inert={visible === false}
	>
		<div class=" border-border rounded-lg border p-3">
			<div class="mb-3 flex items-center justify-between gap-2">
				<div class="flex items-center gap-2">
					<div class="bg-primary h-4 w-1 rounded-full"></div>
					<span class="text-foreground text-[11px] font-semibold uppercase">Conditions</span>
				</div>

				{#if visibilityCondition && visibilityCondition.rules?.length > 1}
					<div
						class="bg-muted flex items-center gap-0.5 rounded-md p-0.5"
						role="group"
						aria-label="Match mode"
					>
						{#each MODES as option (option.value)}
							<button
								type="button"
								aria-pressed={visibilityCondition.mode === option.value}
								title={option.title}
								onclick={() => setMode(option.value)}
								class="h-6 rounded-sm px-3 text-xs font-medium transition-colors {visibilityCondition.mode ===
								option.value
									? 'bg-primary text-primary-foreground'
									: 'text-muted-foreground hover:text-foreground'}"
							>
								{option.label}
							</button>
						{/each}
					</div>
				{/if}
			</div>

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

				<Button variant="dashed" size="sm" onclick={addRule} class="mt-2">+ Add Condition</Button>
			{:else}
				<Button variant="dashed" size="sm" onclick={addRule}>+ Add your first condition</Button>
			{/if}
		</div>

		<!-- Effects Section -->
		{#if visibilityCondition && visibilityCondition.rules?.length > 0}
			<div class=" border-border rounded-lg border p-3">
				<div class="mb-3 flex items-center gap-2">
					<div class="bg-primary h-4 w-1 rounded-full"></div>
					<span class="text-foreground text-[11px] font-semibold uppercase">Then</span>
				</div>

				<div class="grid grid-cols-2 gap-3">
					<div class="flex flex-col gap-1.5">
						<span class="text-muted-foreground text-[9px] font-semibold tracking-wider uppercase">
							Action
						</span>
						<div class="flex gap-1" role="group" aria-label="Action">
							{#each ACTIONS as option (option.value)}
								{#if !isGroupCondition || option.value !== 'disable'}
									<button
										type="button"
										aria-pressed={(visibilityCondition.action ?? 'show') === option.value}
										class="h-9 flex-1 rounded-md border px-3 text-sm font-medium transition-colors {(visibilityCondition.action ??
											'show') === option.value
											? 'bg-primary text-primary-foreground border-primary'
											: 'border-border-strong bg-raised hover:bg-hover'}"
										onclick={() => setAction(option.value)}
									>
										{option.label}
									</button>
								{/if}
							{/each}
						</div>
					</div>

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
	</div>

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
