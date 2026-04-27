<script lang="ts">
	import type { UISchema, ViewerOptions } from '@selvajs/schemas';
	import { Card, Input, Textarea, Label, Checkbox, Button, toast } from '@selvajs/ui';
	import { Download, Upload } from '@lucide/svelte';
	import { exportSchemaAsFile, importSchemaFromFile } from '$lib/utils/schema-exporter';
	import SchemaImportDialog from './SchemaImportDialog.svelte';
	import type { ExportedSchema } from '$lib/utils/schema-exporter';

	interface SchemaInfoPanelProps {
		schema: UISchema;
		onSchemaChange?: (schema: UISchema) => void;
	}

	let { schema, onSchemaChange }: SchemaInfoPanelProps = $props();

	let fileInput: HTMLInputElement;
	let showImportDialog = $state(false);
	let pendingImport: ExportedSchema | null = $state(null);

	function updateSchema(updates: Partial<UISchema>) {
		const updatedSchema = Object.assign({}, schema, updates);
		onSchemaChange?.(updatedSchema);
	}

	function updateViewerOptions(updates: Partial<ViewerOptions>) {
		const currentOptions = schema.viewerOptions ?? {};
		updateSchema({
			viewerOptions: Object.assign({}, currentOptions, updates)
		});
	}

	function handleExport() {
		try {
			exportSchemaAsFile(schema);
			toast.success('Schema exported successfully');
		} catch (error) {
			toast.error(`Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	}

	function handleImportClick() {
		fileInput?.click();
	}

	async function handleFileSelected(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];

		if (!file) return;

		try {
			const imported = await importSchemaFromFile(file);
			pendingImport = imported;
			showImportDialog = true;
		} catch (error) {
			toast.error(`Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
		} finally {
			input.value = '';
		}
	}

	function handleImportConfirm(importedSchema: UISchema) {
		onSchemaChange?.(importedSchema);
		showImportDialog = false;
		pendingImport = null;
		toast.success('Schema imported successfully');
	}

	function handleImportCancel() {
		showImportDialog = false;
		pendingImport = null;
	}
</script>

<Card.Root class="shadow-sm">
	<Card.Header>
		<Card.Title class="text-xl">Schema Information</Card.Title>
	</Card.Header>
	<Card.Content>
		<div class="flex flex-col gap-4">
			<div class="flex flex-col gap-2">
				<Label for="schema-name">Name</Label>
				<Input
					id="schema-name"
					value={schema.name}
					oninput={(e) => updateSchema({ name: e.currentTarget.value })}
				/>
			</div>
			<div class="flex flex-col gap-2">
				<Label for="schema-description">Description</Label>
				<Textarea
					id="schema-description"
					value={schema.description}
					oninput={(e) => updateSchema({ description: e.currentTarget.value })}
				/>
			</div>
			<div class="flex items-center gap-2">
				<Checkbox
					id="enable-local-rendering"
					checked={schema.viewerOptions?.enableLocal ?? false}
					onCheckedChange={(checked) => updateViewerOptions({ enableLocal: !!checked })}
				/>
				<Label for="enable-local-rendering" class="cursor-pointer">Enable Local Render</Label>
			</div>
			<p class="text-muted-foreground text-xs">
				When enabled, users can render geometry locally in their browser without needing a remote
				server.
			</p>
			<div class="flex items-center gap-2">
				<Checkbox
					id="enable-remote-rendering"
					checked={schema.viewerOptions?.enableRemote ?? false}
					onCheckedChange={(checked) => updateViewerOptions({ enableRemote: !!checked })}
				/>
				<Label for="enable-remote-rendering" class="cursor-pointer">Enable Compute Render</Label>
			</div>
			<p class="text-muted-foreground text-xs">
				When enabled, geometry can be rendered remotely via Rhino Compute.
			</p>
			<div class="flex flex-col gap-2">
				<Label for="viewer-background">Viewer Background Color</Label>
				<div class="flex items-center gap-2">
					<Input
						id="viewer-background"
						type="color"
						class="h-10 w-16 cursor-pointer p-1"
						value={schema.viewerOptions?.backgroundColor ?? '#E0E0E0'}
						oninput={(e) => updateViewerOptions({ backgroundColor: e.currentTarget.value })}
					/>
					<Input
						type="text"
						class="flex-1 font-mono"
						value={schema.viewerOptions?.backgroundColor ?? '#E0E0E0'}
						oninput={(e) => updateViewerOptions({ backgroundColor: e.currentTarget.value })}
						placeholder="#E0E0E0"
					/>
				</div>
			</div>
			<div class="flex items-center gap-2">
				<Checkbox
					id="instance-solve"
					checked={schema.instanceSolve ?? true}
					onCheckedChange={(checked) => updateSchema({ instanceSolve: !!checked })}
				/>
				<Label for="instance-solve" class="cursor-pointer">Instant Solve</Label>
			</div>
			<p class="text-muted-foreground text-xs">
				When disabled, users must press a "Calculate" button to trigger solving instead of automatic
				updates.
			</p>

			<!-- Import/Export Section -->
			<div class="mt-4 flex flex-col gap-2 border-t pt-4">
				<Label class="text-sm font-semibold">Schema Management</Label>
				<div class="flex gap-2">
					<Button variant="outline" size="sm" onclick={handleExport} class="flex-1">
						<Download class="mr-2 h-4 w-4" />
						Export Schema
					</Button>
					<Button variant="outline" size="sm" onclick={handleImportClick} class="flex-1">
						<Upload class="mr-2 h-4 w-4" />
						Import Schema
					</Button>
				</div>
				<p class="text-muted-foreground text-xs">
					Export your schema layout to share or back up. Import schemas to load saved layouts (.sls
					files).
				</p>
			</div>
		</div>
	</Card.Content>
</Card.Root>

<!-- Hidden file input -->
<input
	type="file"
	accept=".sls"
	bind:this={fileInput}
	onchange={handleFileSelected}
	class="hidden"
/>

<!-- Import validation dialog -->
{#if showImportDialog && pendingImport}
	<SchemaImportDialog
		importedSchema={pendingImport}
		currentSchema={schema}
		onConfirm={handleImportConfirm}
		onCancel={handleImportCancel}
	/>
{/if}
