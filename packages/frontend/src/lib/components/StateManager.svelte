<script lang="ts">
  import { Download, Upload, AlertTriangle, CheckCircle } from '@lucide/svelte';
  import type { UISchema, SavedState } from '$lib/types/generated';
  import {
    createSavedState,
    validateSavedState,
    extractLoadableValues,
    exportStateAsJson,
    importStateFromJson,
  } from '$lib/utils/param-exporter';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Textarea } from '$lib/components/ui/textarea';
  import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
  } from '$lib/components/ui/dialog';
  import { Card } from '$lib/components/ui/card';

  interface Props {
    schema: UISchema;
    currentValues: Record<string, unknown>;
    onLoadValues: (values: Record<string, unknown>) => void;
  }

  let { schema, currentValues, onLoadValues }: Props = $props();

  // Save dialog state
  let showExportDialog = $state(false);
  let exportName = $state('');
  let exportDescription = $state('');
  let exportAuthor = $state('');
  let exportTags = $state('');

  // Import/validation state
  let showValidationDialog = $state(false);
  let showLoadDialog = $state(false);
  let importedState = $state<SavedState | null>(null);
  let validationResult = $state<ReturnType<typeof validateSavedState> | null>(null);
  let fileInputRef = $state<HTMLInputElement | null>(null);

  function openExportDialog() {
    exportName = `State ${new Date().toLocaleDateString()}`;
    exportDescription = '';
    exportAuthor = schema.author || '';
    exportTags = '';
    showExportDialog = true;
  }

  function handleExport() {
    if (!exportName.trim()) {
      alert('Please enter a name for this state');
      return;
    }

    const state = createSavedState(schema, currentValues, {
      name: exportName.trim(),
      description: exportDescription.trim() || undefined,
      author: exportAuthor.trim() || undefined,
      tags: exportTags
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t.length > 0),
    });

    exportStateAsJson(state);
    showExportDialog = false;
  }

  async function handleImport(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    try {
      const file = input.files[0];
      const imported = await importStateFromJson(file);

      // Validate before loading
      const validation = validateSavedState(imported, schema);

      if (!validation.canLoad) {
        // Show validation errors
        importedState = imported;
        validationResult = validation;
        showValidationDialog = true;
        return;
      }

      // Warnings only - show validation but allow load
      if (!validation.isValid) {
        importedState = imported;
        validationResult = validation;
        showValidationDialog = true;
        return;
      }

      // No issues - load immediately
      const values = extractLoadableValues(imported, schema, validation);
      onLoadValues(values);
    } catch (error) {
      alert('Failed to import state: ' + (error as Error).message);
    }

    // Reset input
    input.value = '';
  }

  function confirmLoad() {
    if (!importedState || !validationResult) return;

    if (validationResult.canLoad) {
      const values = extractLoadableValues(importedState, schema, validationResult);
      onLoadValues(values);
      showValidationDialog = false;
      importedState = null;
      validationResult = null;
    }
  }

  function cancelImport() {
    showValidationDialog = false;
    importedState = null;
    validationResult = null;
  }

  function openLoadDialog() {
    showLoadDialog = true;
  }

  function handleLoadClick() {
    fileInputRef?.click();
    showLoadDialog = false;
  }
</script>

<div class="flex items-center gap-2">
  <Button variant="default" size="sm" onclick={openExportDialog}>
    <Download class="mr-2 h-4 w-4" />
    Save State
  </Button>

  <Button variant="outline" size="sm" onclick={openLoadDialog}>
    <Upload class="mr-2 h-4 w-4" />
    Load State
  </Button>

  <input
    bind:this={fileInputRef}
    type="file"
    accept=".sps"
    onchange={handleImport}
    class="hidden"
  />
</div>

<!-- Save Dialog -->
<Dialog bind:open={showExportDialog}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Save Parameter State</DialogTitle>
      <DialogDescription>Save the current parameter values as a .sps file</DialogDescription>
    </DialogHeader>

    <div class="grid gap-4 py-4">
      <div class="grid gap-2">
        <Label for="export-name">State Name *</Label>
        <Input id="export-name" bind:value={exportName} placeholder="e.g., Design Option A" />
      </div>

      <div class="grid gap-2">
        <Label for="export-description">Description</Label>
        <Textarea
          id="export-description"
          bind:value={exportDescription}
          placeholder="Optional description of this state"
          rows={3}
        />
      </div>

      <div class="grid gap-2">
        <Label for="export-author">Author</Label>
        <Input id="export-author" bind:value={exportAuthor} placeholder="Your name or email" />
      </div>

      <div class="grid gap-2">
        <Label for="export-tags">Tags</Label>
        <Input
          id="export-tags"
          bind:value={exportTags}
          placeholder="facade, option-a, client-approved (comma-separated)"
        />
      </div>
    </div>

    <DialogFooter>
      <Button variant="outline" onclick={() => (showExportDialog = false)}>Cancel</Button>
      <Button onclick={handleExport}>Save State</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>

<!-- Load Dialog -->
<Dialog bind:open={showLoadDialog}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Load Parameter State</DialogTitle>
      <DialogDescription>Select a .sps state file from your drive to load</DialogDescription>
    </DialogHeader>

    <div class="py-8">
      <Button onclick={handleLoadClick} class="w-full" size="lg">
        <Upload class="mr-2 h-4 w-4" />
        Select .sps File
      </Button>
    </div>

    <DialogFooter>
      <Button variant="outline" onclick={() => (showLoadDialog = false)}>Cancel</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>

<!-- Validation Dialog -->
<Dialog bind:open={showValidationDialog}>
  <DialogContent class="max-w-2xl max-h-[80vh] overflow-y-auto">
    <DialogHeader>
      <DialogTitle>State Validation Report</DialogTitle>
      <DialogDescription>
        {#if importedState}
          Validating state: {importedState.name}
        {/if}
      </DialogDescription>
    </DialogHeader>

    {#if validationResult}
      <div class="grid gap-4 py-4">
        <!-- Summary Alert -->
        {#if validationResult.isValid}
          <Card class="border-green-200 bg-green-50 p-4 dark:border-green-900 dark:bg-green-950">
            <div class="flex items-start gap-3">
              <CheckCircle class="h-5 w-5 text-green-600 dark:text-green-400" />
              <div>
                <h4 class="text-sm font-semibold text-green-900 dark:text-green-100">
                  No Issues Found
                </h4>
                <p class="text-sm text-green-700 mt-1 dark:text-green-300">
                  This state can be loaded safely.
                </p>
              </div>
            </div>
          </Card>
        {:else if validationResult.canLoad}
          <Card
            class="border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-900 dark:bg-yellow-950"
          >
            <div class="flex items-start gap-3">
              <AlertTriangle class="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
              <div>
                <h4 class="text-sm font-semibold text-yellow-900 dark:text-yellow-100">
                  Warnings Detected
                </h4>
                <p class="text-sm text-yellow-700 mt-1 dark:text-yellow-300">
                  {validationResult.issues.length} warning(s) found, but state can still be loaded.
                </p>
              </div>
            </div>
          </Card>
        {:else}
          <Card class="border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950">
            <div class="flex items-start gap-3">
              <AlertTriangle class="h-5 w-5 text-red-600 dark:text-red-400" />
              <div>
                <h4 class="text-sm font-semibold text-red-900 dark:text-red-100">
                  Critical Errors
                </h4>
                <p class="text-sm text-red-700 mt-1 dark:text-red-300">
                  Cannot load this state due to critical incompatibilities.
                </p>
              </div>
            </div>
          </Card>
        {/if}

        <!-- Issues List -->
        {#if !validationResult.isValid}
          <div class="space-y-2">
            <h4 class="text-sm font-medium">Issues:</h4>
            {#each validationResult.issues as issue}
              <div
                class="rounded-lg border p-3 {issue.severity === 'error'
                  ? 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950'
                  : 'border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950'}"
              >
                <div class="flex items-start gap-2">
                  <AlertTriangle
                    class="h-4 w-4 mt-0.5 {issue.severity === 'error'
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-yellow-600 dark:text-yellow-400'}"
                  />
                  <div class="flex-1">
                    <p class="text-sm font-medium">{issue.message}</p>
                    {#if issue.details}
                      <p class="text-xs text-muted-foreground mt-1">
                        Expected: {issue.details.expected} → Actual: {issue.details.actual}
                      </p>
                    {/if}
                  </div>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    <DialogFooter>
      <Button variant="outline" onclick={cancelImport}>Cancel</Button>
      {#if validationResult?.canLoad}
        <Button onclick={confirmLoad}>Load Anyway</Button>
      {/if}
    </DialogFooter>
  </DialogContent>
</Dialog>
