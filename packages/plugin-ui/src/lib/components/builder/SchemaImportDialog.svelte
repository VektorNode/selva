<script lang="ts">
	import type { UISchema } from '@selvajs/schemas';
	import { Dialog, Callout, IssueList, Button, Badge, type Issue } from '@selvajs/ui';
	import {
		validateImportedSchema,
		prepareImportedSchema,
		type ExportedSchema
	} from '#lib/utils/schema-exporter.js';

	interface SchemaImportDialogProps {
		importedSchema: ExportedSchema;
		currentSchema: UISchema;
		onConfirm: (schema: UISchema) => void;
		onCancel: () => void;
	}

	let { importedSchema, currentSchema, onConfirm, onCancel }: SchemaImportDialogProps = $props();

	const validation = $derived(
		validateImportedSchema(
			importedSchema.schema,
			currentSchema.documentId || '',
			currentSchema.projectFileName
		)
	);

	const errors = $derived(validation.issues.filter((i) => i.severity === 'error'));
	const warnings = $derived(validation.issues.filter((i) => i.severity === 'warning'));
	const issues = $derived<Issue[]>(
		validation.issues.map((issue) => ({
			severity: issue.severity,
			message: issue.message,
			detail: issue.details
				? Object.entries(issue.details)
						.filter(([, value]) => value !== undefined)
						.map(([key, value]) => `${key}: ${String(value)}`)
						.join(' · ')
				: undefined
		}))
	);

	function handleConfirm() {
		if (!validation.canLoad) return;

		const prepared = prepareImportedSchema(importedSchema.schema, {
			updateTimestamp: true
		});

		onConfirm(prepared);
	}
</script>

<Dialog.Root open={true} onOpenChange={(open) => !open && onCancel()}>
	<Dialog.Content class="max-h-[80vh] max-w-2xl overflow-y-auto">
		<Dialog.Header>
			<Dialog.Title>Import Schema</Dialog.Title>
			<Dialog.Description>
				Review the schema before importing. The schema will replace your current layout
				configuration.
			</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-4">
			<div class="bg-muted/50 rounded-lg border p-4">
				<h3 class="mb-2 font-semibold">Schema Details</h3>
				<dl class="space-y-1 text-sm">
					<div class="flex justify-between">
						<dt class="text-muted-foreground">Name:</dt>
						<dd class="font-medium">{importedSchema.schema.name}</dd>
					</div>
					{#if importedSchema.schema.description}
						<div class="flex justify-between">
							<dt class="text-muted-foreground">Description:</dt>
							<dd class="font-medium">{importedSchema.schema.description}</dd>
						</div>
					{/if}
					{#if importedSchema.schema.projectFileName}
						<div class="flex justify-between">
							<dt class="text-muted-foreground">Project File:</dt>
							<dd class="font-mono text-xs">{importedSchema.schema.projectFileName}</dd>
						</div>
					{/if}
					{#if importedSchema.schema.author}
						<div class="flex justify-between">
							<dt class="text-muted-foreground">Author:</dt>
							<dd class="font-medium">{importedSchema.schema.author}</dd>
						</div>
					{/if}
					<div class="flex justify-between">
						<dt class="text-muted-foreground">Inputs:</dt>
						<dd class="font-medium">{importedSchema.schema.inputs.length}</dd>
					</div>
					<div class="flex justify-between">
						<dt class="text-muted-foreground">Outputs:</dt>
						<dd class="font-medium">{importedSchema.schema.outputs.length}</dd>
					</div>
					<div class="flex justify-between">
						<dt class="text-muted-foreground">
							{importedSchema.schema.layout.type === 'tabbed' ? 'Tabs' : 'Groups'}:
						</dt>
						<dd class="font-medium">
							{importedSchema.schema.layout.type === 'tabbed'
								? importedSchema.schema.layout.tabs.length
								: importedSchema.schema.layout.groups.length}
						</dd>
					</div>
					{#if importedSchema.metadata.exportedAt}
						<div class="flex justify-between">
							<dt class="text-muted-foreground">Exported:</dt>
							<dd class="text-xs">
								{new Date(importedSchema.metadata.exportedAt).toLocaleString()}
							</dd>
						</div>
					{/if}
				</dl>
			</div>

			{#if validation.isValid}
				<Callout tone="success" title="Schema Valid">
					This schema is compatible with your current document and can be safely imported.
				</Callout>
			{:else if validation.canLoad}
				<Callout tone="warning" title="Warnings Found">
					The schema can be imported but has some warnings. Review them below.
				</Callout>
			{:else}
				<Callout tone="danger" title="Cannot Import">
					This schema has validation errors and cannot be imported. See details below.
				</Callout>
			{/if}

			{#if validation.issues.length > 0}
				<div class="space-y-2">
					<h3 class="text-sm font-semibold">
						Validation Issues
						<Badge variant="outline" class="ml-2">
							{errors.length} errors, {warnings.length} warnings
						</Badge>
					</h3>

					<IssueList {issues} class="max-h-60 overflow-y-auto" />
				</div>
			{/if}

			<Callout tone="info" title="What happens when you import?">
				<ul class="list-inside list-disc">
					<li>Your current layout configuration will be completely replaced</li>
					<li>All tabs, groups, and widget arrangements will be updated</li>
					<li>Parameter values are NOT affected (only the layout)</li>
					<li>The schema will be saved to your Grasshopper document</li>
				</ul>
			</Callout>
		</div>

		<Dialog.Footer class="flex gap-2">
			<Button variant="outline" onclick={onCancel}>Cancel</Button>
			<Button onclick={handleConfirm} disabled={!validation.canLoad}>
				{validation.canLoad ? 'Import Schema' : 'Cannot Import'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
