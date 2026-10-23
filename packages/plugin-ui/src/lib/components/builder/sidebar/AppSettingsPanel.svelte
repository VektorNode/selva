<script lang="ts">
	import type {
		UISchema,
		DiscoveredInput,
		DiscoveredOutput,
		ViewerOptions
	} from '@selvajs/schemas';
	import { MAX_CATEGORY_LENGTH, MAX_TAGS } from '@selvajs/schemas';
	import { Input, Textarea, Switch, Button, toast, pickFile } from '@selvajs/ui';
	import { Download, Upload } from '@lucide/svelte';
	import { exportSchemaAsFile, importSchemaFromFile } from '$lib/utils/schema-exporter';
	import type { ExportedSchema } from '$lib/utils/schema-exporter';
	import { remapImportedSchema } from '$lib/utils/schema-remap';
	import SchemaImportDialog from '../SchemaImportDialog.svelte';
	import TagEditor from '../../TagEditor.svelte';
	import ScopeNote from '../scope/ScopeNote.svelte';
	import SettingsSection from './SettingsSection.svelte';
	import SettingRow from './SettingRow.svelte';

	interface Props {
		schema: UISchema;
		onSchemaChange: (schema: UISchema) => void;
		liveInputs: DiscoveredInput[];
		liveOutputs: DiscoveredOutput[];
	}

	let { schema, onSchemaChange, liveInputs, liveOutputs }: Props = $props();

	let pendingImport: ExportedSchema | null = $state(null);

	const DEFAULT_BACKGROUND = '#E0E0E0';
	const background = $derived(schema.viewerOptions?.backgroundColor ?? DEFAULT_BACKGROUND);

	function updateSchema(updates: Partial<UISchema>) {
		onSchemaChange({ ...schema, ...updates });
	}

	function updateViewerOptions(updates: Partial<ViewerOptions>) {
		updateSchema({ viewerOptions: { ...schema.viewerOptions, ...updates } });
	}

	const tags = $derived(schema.tags ?? []);

	function setTags(next: string[]) {
		updateSchema({ tags: next.length > 0 ? next : undefined });
	}

	async function handleExport() {
		try {
			if (await exportSchemaAsFile(schema)) toast.success('Schema exported');
		} catch (error) {
			toast.error(`Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	}

	async function handleImport() {
		const file = await pickFile({ accept: '.sls' });
		if (!file) return;

		try {
			pendingImport = await importSchemaFromFile(file);
		} catch (error) {
			toast.error(`Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	}

	function handleImportConfirm(importedSchema: UISchema) {
		// Rebind by nickname onto the live canvas: the imported ids come from the source document
		// and won't resolve on save, so the plugin would purge every input/output as stale.
		const { schema: remapped, unmatched } = remapImportedSchema(
			importedSchema,
			liveInputs,
			liveOutputs
		);

		onSchemaChange(remapped);
		pendingImport = null;

		if (unmatched.length > 0) {
			toast.warning(
				`Imported. ${unmatched.length} parameter${unmatched.length > 1 ? 's' : ''} had no match on the current document and will be dropped on save: ${unmatched.join(', ')}`
			);
		} else {
			toast.success('Schema imported');
		}
	}
</script>

<ScopeNote scope="shared">
	Saved with the schema. Applies in the local preview and on Selva.
</ScopeNote>

<SettingsSection
	id="app.general"
	title="General"
	description="Selva copies these into the definition when you upload it. Edit them in Selva after that."
>
	<SettingRow label="Name" for="schema-name">
		<Input
			id="schema-name"
			value={schema.name}
			oninput={(e) => updateSchema({ name: e.currentTarget.value })}
		/>
	</SettingRow>
	<SettingRow label="Description" for="schema-description">
		<Textarea
			id="schema-description"
			value={schema.description}
			oninput={(e) => updateSchema({ description: e.currentTarget.value })}
		/>
	</SettingRow>
	<SettingRow label="Category" for="schema-category" scope="compute">
		<Input
			id="schema-category"
			maxlength={MAX_CATEGORY_LENGTH}
			value={schema.category ?? ''}
			oninput={(e) => updateSchema({ category: e.currentTarget.value || undefined })}
			placeholder="e.g. Facade"
		/>
	</SettingRow>
	<SettingRow
		label="Tags"
		for="schema-tags"
		scope="compute"
		hint="Up to {MAX_TAGS}. Press Enter to add; a comma starts a new tag."
	>
		<TagEditor id="schema-tags" {tags} onChange={setTags} />
	</SettingRow>
</SettingsSection>

<SettingsSection id="app.solving" title="Solving">
	<SettingRow
		label="Instant solve"
		for="instance-solve"
		layout="inline"
		hint="Solve on every change. Off: users press Calculate."
	>
		<Switch
			id="instance-solve"
			checked={schema.instanceSolve ?? true}
			onCheckedChange={(checked) => updateSchema({ instanceSolve: checked })}
		/>
	</SettingRow>
</SettingsSection>

<SettingsSection id="app.viewer" title="Viewer">
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

<SettingsSection
	id="app.file"
	title="Schema file"
	description="Share or back up this layout as an .sls file."
>
	<div class="grid grid-cols-2 gap-2">
		<Button variant="outline" size="sm" onclick={handleExport}>
			<Download />
			Export
		</Button>
		<Button variant="outline" size="sm" onclick={handleImport}>
			<Upload />
			Import
		</Button>
	</div>
</SettingsSection>

{#if pendingImport}
	<SchemaImportDialog
		importedSchema={pendingImport}
		currentSchema={schema}
		onConfirm={handleImportConfirm}
		onCancel={() => (pendingImport = null)}
	/>
{/if}
