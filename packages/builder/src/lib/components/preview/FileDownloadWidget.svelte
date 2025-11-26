<script lang="ts">
  import type { FileData } from '$lib/utils/file-download';
  import {
    downloadFiles,
    isFileData,
    isFileDataArray,
    formatFileSize,
    getBase64FileSize,
  } from '$lib/utils/file-download';
  import { Button } from '../ui';

  interface Props {
    fileData: FileData | FileData[] | null;
    displayName?: string;
  }

  let { fileData, displayName }: Props = $props();
  let downloading = $state(false);
  let error = $state<string | null>(null);

  const filesArray = $derived(!fileData ? [] : Array.isArray(fileData) ? fileData : [fileData]);

  const fileCount = $derived(filesArray.length);
  const totalSize = $derived(
    filesArray.reduce((sum, file) => {
      return sum + getBase64FileSize(file.Data);
    }, 0)
  );

  async function handleDownload() {
    if (!fileData || fileCount === 0) return;

    downloading = true;
    error = null;

    try {
      const fileName = displayName
        ? displayName.replace(/[^a-z0-9]/gi, '_').toLowerCase()
        : 'download';

      await downloadFiles(fileData, fileName);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to download files';
      console.error('[FileDownloadWidget] Download error:', err);
    } finally {
      downloading = false;
    }
  }
</script>

<div class="flex flex-col gap-3">
  {#if !fileData || fileCount === 0}
    <div class="rounded border border-border bg-muted px-3 py-3 text-sm text-muted-foreground">
      Waiting for file data...
    </div>
  {:else}
    <div class="flex flex-col gap-2">
      <div class="rounded border border-border bg-muted px-3 py-2">
        <div class="flex items-center justify-between">
          <div class="text-sm font-medium text-foreground">
            {#if fileCount === 1}
              📄 {filesArray[0].FileName}{filesArray[0].FileType}
            {:else}
              📦 {fileCount} files
            {/if}
          </div>
          <div class="text-xs text-muted-foreground">
            {formatFileSize(totalSize)}
          </div>
        </div>
        {#if fileCount > 1}
          <div class="mt-2 flex flex-col gap-1">
            {#each filesArray as file}
              <div class="flex items-center justify-between text-xs text-muted-foreground">
                <span>{file.FileName}{file.FileType}</span>
                <span>{formatFileSize(getBase64FileSize(file.Data))}</span>
              </div>
            {/each}
          </div>
        {/if}
      </div>

      {#if error}
        <div
          class="rounded border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      {/if}

      <Button
        onclick={handleDownload}
        disabled={downloading || fileCount === 0}
        class="w-full"
        variant="default"
      >
        {#if downloading}
          ⏳ Downloading...
        {:else}
          ⬇️ Download {fileCount === 1 ? 'File' : `${fileCount} Files`}
        {/if}
      </Button>
    </div>
  {/if}
</div>
