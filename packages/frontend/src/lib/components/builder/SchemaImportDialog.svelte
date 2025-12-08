<script lang="ts">
  import type { UISchema, ValidationIssue } from '$lib/types/generated';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Alert from '$lib/components/ui/alert-dialog';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import { AlertCircle, AlertTriangle, CheckCircle2, Info } from '@lucide/svelte';
  import {
    validateImportedSchema,
    prepareImportedSchema,
    type ExportedSchema,
  } from '$lib/utils/schema-exporter';

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

  function handleConfirm() {
    if (!validation.canLoad) return;

    const prepared = prepareImportedSchema(importedSchema.schema, {
      updateTimestamp: true,
    });

    onConfirm(prepared);
  }

  function getIssueIcon(severity: 'error' | 'warning') {
    return severity === 'error' ? AlertCircle : AlertTriangle;
  }

  function getIssueColorClass(severity: 'error' | 'warning') {
    return severity === 'error' ? 'text-destructive' : 'text-yellow-600';
  }
</script>

<Dialog.Root open={true} onOpenChange={(open) => !open && onCancel()}>
  <Dialog.Content class="max-w-2xl max-h-[80vh] overflow-y-auto">
    <Dialog.Header>
      <Dialog.Title>Import Schema</Dialog.Title>
      <Dialog.Description>
        Review the schema before importing. The schema will replace your current layout
        configuration.
      </Dialog.Description>
    </Dialog.Header>

    <div class="space-y-4">
      <!-- Schema Info -->
      <div class="rounded-lg border bg-muted/50 p-4">
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
            <dt class="text-muted-foreground">Tabs:</dt>
            <dd class="font-medium">{importedSchema.schema.layout.tabs.length}</dd>
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

      <!-- Validation Status -->
      {#if validation.isValid}
        <Alert.Root>
          <CheckCircle2 class="h-4 w-4 text-green-600" />
          <Alert.Title>Schema Valid</Alert.Title>
          <Alert.Description>
            This schema is compatible with your current document and can be safely imported.
          </Alert.Description>
        </Alert.Root>
      {:else if validation.canLoad}
        <Alert.Root>
          <AlertTriangle class="h-4 w-4 text-yellow-600" />
          <Alert.Title>Warnings Found</Alert.Title>
          <Alert.Description>
            The schema can be imported but has some warnings. Review them below.
          </Alert.Description>
        </Alert.Root>
      {:else}
        <Alert.Root>
          <AlertCircle class="h-4 w-4" />
          <Alert.Title>Cannot Import</Alert.Title>
          <Alert.Description>
            This schema has validation errors and cannot be imported. See details below.
          </Alert.Description>
        </Alert.Root>
      {/if}

      <!-- Validation Issues -->
      {#if validation.issues.length > 0}
        <div class="space-y-2">
          <h3 class="text-sm font-semibold">
            Validation Issues
            <Badge variant="outline" class="ml-2">
              {errors.length} errors, {warnings.length} warnings
            </Badge>
          </h3>

          <div class="max-h-60 space-y-2 overflow-y-auto rounded-lg border p-3">
            {#each validation.issues as issue}
              {@const Icon = getIssueIcon(issue.severity)}
              <div class="flex gap-2 text-sm">
                <Icon class="mt-0.5 h-4 w-4 flex-shrink-0 {getIssueColorClass(issue.severity)}" />
                <div class="flex-1">
                  <p class="font-medium {getIssueColorClass(issue.severity)}">
                    {issue.message}
                  </p>
                  {#if issue.details}
                    <dl class="mt-1 space-y-0.5 text-xs text-muted-foreground">
                      {#each Object.entries(issue.details) as [key, value]}
                        {#if value !== undefined}
                          <div class="flex gap-2">
                            <dt class="font-medium">{key}:</dt>
                            <dd class="font-mono">{String(value)}</dd>
                          </div>
                        {/if}
                      {/each}
                    </dl>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Additional Information -->
      <Alert.Root>
        <Info class="h-4 w-4" />
        <Alert.Title>What happens when you import?</Alert.Title>
        <Alert.Description class="space-y-1 text-sm">
          <p>• Your current layout configuration will be completely replaced</p>
          <p>• All tabs, groups, and widget arrangements will be updated</p>
          <p>• Parameter values are NOT affected (only the layout)</p>
          <p>• The schema will be saved to your Grasshopper document</p>
        </Alert.Description>
      </Alert.Root>
    </div>

    <Dialog.Footer class="flex gap-2">
      <Button variant="outline" onclick={onCancel}>Cancel</Button>
      <Button onclick={handleConfirm} disabled={!validation.canLoad}>
        {validation.canLoad ? 'Import Schema' : 'Cannot Import'}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
