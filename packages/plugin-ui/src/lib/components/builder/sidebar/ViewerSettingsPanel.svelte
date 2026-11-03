<script lang="ts">
	import type { UISchema, ViewerOptions } from '@selvajs/schemas';
	import { Input, Select } from '@selvajs/ui';
	import SettingsSection from './SettingsSection.svelte';
	import SettingRow from './SettingRow.svelte';

	interface Props {
		schema: UISchema;
		onSchemaChange: (schema: UISchema) => void;
	}

	let { schema, onSchemaChange }: Props = $props();

	const DEFAULT_BACKGROUND = '#E0E0E0';
	const background = $derived(schema.viewerOptions?.backgroundColor ?? DEFAULT_BACKGROUND);

	const LOOKS: { value: NonNullable<ViewerOptions['look']>; label: string }[] = [
		{ value: 'technical', label: 'Technical' },
		{ value: 'studio', label: 'Studio' },
		{ value: 'showcase', label: 'Showcase' },
		{ value: 'night', label: 'Night' },
		{ value: 'arctic', label: 'Arctic' }
	];
	const look = $derived(schema.viewerOptions?.look ?? 'technical');

	function updateViewerOptions(updates: Partial<ViewerOptions>) {
		onSchemaChange({ ...schema, viewerOptions: { ...schema.viewerOptions, ...updates } });
	}
</script>

<SettingsSection id="viewer.look" title="Look" collapsible={false}>
	<div class="grid grid-cols-2 gap-3">
		<SettingRow label="Background" for="viewer-background">
			<div class="flex items-center gap-2">
				<input
					type="color"
					aria-label="Pick background color"
					class="border-input size-8 shrink-0 cursor-pointer rounded-md border bg-transparent p-1"
					value={background}
					oninput={(e) => updateViewerOptions({ backgroundColor: e.currentTarget.value })}
				/>
				<Input
					id="viewer-background"
					class="min-w-0 font-mono"
					value={background}
					oninput={(e) => updateViewerOptions({ backgroundColor: e.currentTarget.value })}
					placeholder={DEFAULT_BACKGROUND}
				/>
			</div>
		</SettingRow>
		<SettingRow label="Look" for="viewer-look">
			<Select.Root
				type="single"
				value={look}
				onValueChange={(value) => updateViewerOptions({ look: value as ViewerOptions['look'] })}
			>
				<Select.Trigger id="viewer-look" size="sm" class="w-full">
					{LOOKS.find((option) => option.value === look)?.label ?? look}
				</Select.Trigger>
				<Select.Content>
					{#each LOOKS as option (option.value)}
						<Select.Item value={option.value} label={option.label} />
					{/each}
				</Select.Content>
			</Select.Root>
		</SettingRow>
	</div>
	{#if look === 'night'}
		<p class="text-muted-foreground -mt-2 text-xs">Night lights Emissive Material parts.</p>
	{/if}
</SettingsSection>
