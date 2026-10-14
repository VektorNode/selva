<script lang="ts">
	import type { UISchema, ViewerOptions } from '@selvajs/schemas';
	import { Input, Switch } from '@selvajs/ui';
	import SettingsSection from './SettingsSection.svelte';
	import SettingRow from './SettingRow.svelte';

	interface Props {
		schema: UISchema;
		onSchemaChange: (schema: UISchema) => void;
	}

	let { schema, onSchemaChange }: Props = $props();

	const DEFAULT_BACKGROUND = '#E0E0E0';
	const background = $derived(schema.viewerOptions?.backgroundColor ?? DEFAULT_BACKGROUND);

	function updateViewerOptions(updates: Partial<ViewerOptions>) {
		onSchemaChange({ ...schema, viewerOptions: { ...schema.viewerOptions, ...updates } });
	}
</script>

<SettingsSection id="viewer.rendering" title="Rendering" description="Where the geometry is drawn.">
	<SettingRow
		label="Local render"
		for="enable-local-rendering"
		layout="inline"
		hint="Draw geometry in the browser, no server needed."
	>
		<Switch
			id="enable-local-rendering"
			checked={schema.viewerOptions?.enableLocal ?? false}
			onCheckedChange={(checked) => updateViewerOptions({ enableLocal: checked })}
		/>
	</SettingRow>
	<SettingRow
		label="Compute render"
		for="enable-remote-rendering"
		layout="inline"
		hint="Render through Rhino Compute."
	>
		<Switch
			id="enable-remote-rendering"
			checked={schema.viewerOptions?.enableRemote ?? false}
			onCheckedChange={(checked) => updateViewerOptions({ enableRemote: checked })}
		/>
	</SettingRow>
</SettingsSection>

<SettingsSection id="viewer.scene" title="Scene">
	<SettingRow label="Background" for="viewer-background">
		<div class="flex items-center gap-2">
			<input
				type="color"
				aria-label="Pick background color"
				class="border-input size-9 shrink-0 cursor-pointer rounded-md border bg-transparent p-1"
				value={background}
				oninput={(e) => updateViewerOptions({ backgroundColor: e.currentTarget.value })}
			/>
			<Input
				id="viewer-background"
				class="font-mono"
				value={background}
				oninput={(e) => updateViewerOptions({ backgroundColor: e.currentTarget.value })}
				placeholder={DEFAULT_BACKGROUND}
			/>
		</div>
	</SettingRow>
</SettingsSection>
