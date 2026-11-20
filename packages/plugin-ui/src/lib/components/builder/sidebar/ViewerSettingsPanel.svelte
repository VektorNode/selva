<script lang="ts">
	import type { UISchema, ViewerOptions } from '@selvajs/schemas';
	import { page } from '$app/state';
	import { Button, ColorInput, Select, Switch } from '@selvajs/ui';
	import { previewCamera } from '#lib/features/preview/preview-camera.svelte.js';
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

	const camera = $derived(schema.viewerOptions?.camera);
	// The plugin writes an absent position as an empty list.
	const exact = $derived(camera?.position?.length === 3 && camera.target?.length === 3);
	const seen = $derived(previewCamera(page.url.searchParams.get('session') || ''));

	function useCurrentView(keepExact: boolean) {
		if (!seen) return;
		const { direction, position, target } = seen;
		updateViewerOptions({ camera: keepExact ? { direction, position, target } : { direction } });
	}

	function clearView() {
		const { camera: _dropped, ...rest } = schema.viewerOptions ?? {};
		onSchemaChange({ ...schema, viewerOptions: rest });
	}
</script>

<SettingsSection id="viewer.rendering" title="Rendering" collapsible={false}>
	<SettingRow
		label="Compute render"
		for="enable-remote-rendering"
		layout="inline"
		hint="Show Rhino.Compute's geometry in Selva's viewer."
	>
		<Switch
			id="enable-remote-rendering"
			checked={schema.viewerOptions?.enableRemote ?? false}
			onCheckedChange={(checked) => updateViewerOptions({ enableRemote: checked })}
		/>
	</SettingRow>
</SettingsSection>

<SettingsSection id="viewer.look" title="Look" collapsible={false}>
	<div class="grid grid-cols-2 gap-3">
		<SettingRow label="Background" for="viewer-background">
			<ColorInput
				inputId="viewer-background"
				value={background}
				onChange={(backgroundColor) => updateViewerOptions({ backgroundColor })}
			/>
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

<SettingsSection id="viewer.camera" title="Default view" collapsible={false}>
	<p class="text-muted-foreground text-xs">
		{#if !camera}
			Opens in the iso view.
		{:else if exact}
			Opens in the saved view, at its exact position.
		{:else}
			Opens looking from the saved angle, zoomed to fit the model.
		{/if}
	</p>
	<div class="flex flex-wrap gap-2">
		<Button size="sm" variant="outline" disabled={!seen} onclick={() => useCurrentView(exact)}>
			Use view from Preview
		</Button>
		{#if camera}
			<Button size="sm" variant="ghost" onclick={clearView}>Clear</Button>
		{/if}
	</div>
	{#if !seen}
		<p class="text-muted-foreground -mt-1 text-xs">
			Frame the model in Preview, then come back here.
		</p>
	{/if}
	<SettingRow
		label="Keep exact position"
		for="viewer-camera-exact"
		layout="inline"
		hint="Off: the view keeps its angle and zooms to fit, for a model that changes size."
	>
		<Switch
			id="viewer-camera-exact"
			checked={exact}
			disabled={!camera || (!exact && !seen)}
			onCheckedChange={(checked) =>
				checked
					? useCurrentView(true)
					: updateViewerOptions({ camera: { direction: camera!.direction } })}
		/>
	</SettingRow>
</SettingsSection>
