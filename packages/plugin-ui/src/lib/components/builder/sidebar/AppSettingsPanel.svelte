<script lang="ts">
	import type { UISchema, DiscoveredInput, DiscoveredOutput } from '@selvajs/schemas';
	import { Input, Textarea, Switch, Button, toast } from '@selvajs/ui';
	import { Download, Upload } from '@lucide/svelte';
	import { exportSchemaAsFile, importSchemaFromFile } from '$lib/utils/schema-exporter';
	import type { ExportedSchema } from '$lib/utils/schema-exporter';
	import { remapImportedSchema } from '$lib/utils/schema-remap';
	import SchemaImportDialog from '../SchemaImportDialog.svelte';
	import SettingsSection from './SettingsSection.svelte';
	import SettingRow from './SettingRow.svelte';

	interface Props {
		schema: UISchema;
		onSchemaChange: (schema: UISchema) => void;
		liveInputs: DiscoveredInput[];
		liveOutputs: DiscoveredOutput[];
	}

	let { schema, onSchemaChange, liveInputs, liveOutputs }: Props = $props();

	let fileInput: HTMLInputElement;
	let pendingImport: ExportedSchema | null = $state(null);

	function updateSchema(updates: Partial<UISchema>) {
		onSchemaChange({ ...schema, ...updates });
	}

	function handleExport() {
		try {
			exportSchemaAsFile(schema);
			toast.success('Schema exported');
		} catch (error) {
			toast.error(`Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	}

	async function handleFileSelected(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		try {
			pendingImport = await importSchemaFromFile(file);
		} catch (error) {
			toast.error(`Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
		} finally {
			input.value = '';
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

<SettingsSection id="app.general" title="General">
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
		<Button variant="outline" size="sm" onclick={() => fileInput?.click()}>
			<Upload />
			Import
		</Button>
	</div>
</SettingsSection>

<input
	type="file"
	accept=".sls"
	bind:this={fileInput}
	onchange={handleFileSelected}
	class="hidden"
/>

{#if pendingImport}
	<SchemaImportDialog
		importedSchema={pendingImport}
		currentSchema={schema}
		onConfirm={handleImportConfirm}
		onCancel={() => (pendingImport = null)}
	/>
{/if}
