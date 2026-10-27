<script lang="ts">
	import type { LocalOptions, UISchema, ViewerOptions } from '@selvajs/schemas';
	import { Switch } from '@selvajs/ui';
	import ScopeNote from '../scope/ScopeNote.svelte';
	import SettingsSection from './SettingsSection.svelte';
	import SettingRow from './SettingRow.svelte';

	interface Props {
		schema: UISchema;
		onSchemaChange: (schema: UISchema) => void;
	}

	let { schema, onSchemaChange }: Props = $props();

	function updateViewerOptions(updates: Partial<ViewerOptions>) {
		onSchemaChange({ ...schema, viewerOptions: { ...schema.viewerOptions, ...updates } });
	}

	function updateLocalOptions(updates: Partial<LocalOptions>) {
		onSchemaChange({ ...schema, localOptions: { ...schema.localOptions, ...updates } });
	}
</script>

<ScopeNote scope="local">
	Used by the preview this Grasshopper session serves. Selva ignores these.
</ScopeNote>

<SettingsSection id="local.preview" title="Live preview">
	<SettingRow
		label="Local render"
		for="enable-local-rendering"
		layout="inline"
		hint="Grasshopper streams display meshes to this preview. No server needed."
	>
		<Switch
			id="enable-local-rendering"
			checked={schema.viewerOptions?.enableLocal ?? false}
			onCheckedChange={(checked) => updateViewerOptions({ enableLocal: checked })}
		/>
	</SettingRow>
</SettingsSection>

<SettingsSection id="local.rhino" title="Rhino">
	<SettingRow
		label="Track picked objects"
		for="track-picked-objects"
		layout="inline"
		hint="Geometry picked in the viewport follows its Rhino objects: editing one re-solves, deleting one drops it. Off, a pick is a snapshot."
	>
		<Switch
			id="track-picked-objects"
			checked={schema.localOptions?.trackPickedObjects ?? false}
			onCheckedChange={(checked) => updateLocalOptions({ trackPickedObjects: checked })}
		/>
	</SettingRow>
</SettingsSection>
