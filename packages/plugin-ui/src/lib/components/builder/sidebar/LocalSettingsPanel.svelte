<script lang="ts">
	import type { LocalOptions, UISchema, ViewerOptions } from '@selvajs/schemas';
	import { Switch } from '@selvajs/ui';
	import ScopeNote from '../scope/ScopeNote.svelte';
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

<ScopeNote scope="local">Only the preview in Rhino uses these. Selva ignores them.</ScopeNote>

<div class="divide-border flex flex-col divide-y">
	<div class="py-4">
		<SettingRow
			label="Local render"
			for="enable-local-rendering"
			layout="inline"
			hint="Stream Grasshopper meshes to this preview."
		>
			<Switch
				id="enable-local-rendering"
				checked={schema.viewerOptions?.enableLocal ?? false}
				onCheckedChange={(checked) => updateViewerOptions({ enableLocal: checked })}
			/>
		</SettingRow>
	</div>
	<div class="py-4">
		<SettingRow
			label="Track picked objects"
			for="track-picked-objects"
			layout="inline"
			hint="Picked geometry follows its Rhino objects. Off keeps a snapshot."
		>
			<Switch
				id="track-picked-objects"
				checked={schema.localOptions?.trackPickedObjects ?? false}
				onCheckedChange={(checked) => updateLocalOptions({ trackPickedObjects: checked })}
			/>
		</SettingRow>
	</div>
</div>
