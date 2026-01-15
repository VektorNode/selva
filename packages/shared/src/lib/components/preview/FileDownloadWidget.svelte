<script lang="ts">
	import { downloadFiles, formatFileSize, getBase64FileSize } from '$lib/utils/file-download';
	import type { FileData } from 'selva-compute';
	import { Button } from '../ui';

	interface Props {
		fileData: FileData | FileData[] | null;
		displayName?: string;
	}

	let { fileData, displayName }: Props = $props();
	let downloading = $state(false);
	let error = $state<string | null>(null);

	// Validate file data structure
	function validateFileData(data: any): data is FileData {
		return data && typeof data === 'object' && 'fileName' in data && 'data' in data;
	}

	const filesArray = $derived(
		!fileData
			? []
			: Array.isArray(fileData)
				? fileData.filter(validateFileData)
				: validateFileData(fileData) ? [fileData] : []
	);

	const fileCount = $derived(filesArray.length);
	const totalSize = $derived(
		filesArray.reduce((sum, file) => {
			return sum + getBase64FileSize(file.data);
		}, 0)
	);

	async function handleDownload() {
		if (!fileData || fileCount === 0) return;

		downloading = true;
		error = null;

		try {
			if (filesArray.length === 1) {
				await downloadFiles(filesArray[0], filesArray[0].fileName);
			} else {
				const fileName = displayName
					? displayName.replace(/[^a-z0-9]/gi, '_').toLowerCase()
					: 'download';
				await downloadFiles(filesArray, fileName);
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to download files';
			console.error('[FileDownloadWidget] Download error:', err);
		} finally {
			downloading = false;
		}
	}
</script>

<div class="gap-3 flex flex-col">
	{#if !fileData || fileCount === 0}
		<div class="rounded px-3 py-3 text-sm border border-border bg-muted text-muted-foreground">
			Waiting for file data...
		</div>
	{:else}
		<div class="gap-2 flex flex-col">
			<div class="rounded px-3 py-2 border border-border bg-muted">
				<div class="flex items-center justify-between">
					<div class="text-sm font-medium text-foreground">
						{#if fileCount === 1}
							{filesArray[0].fileName}{filesArray[0].fileType}
						{:else}
							{fileCount} files
						{/if}
					</div>
					<div class="text-xs text-muted-foreground">
						{formatFileSize(totalSize)}
					</div>
				</div>
				{#if fileCount > 1}
					<div class="mt-2 gap-1 flex flex-col">
						{#each filesArray as file}
							<div class="text-xs flex items-center justify-between text-muted-foreground">
								<span>{file.fileName}{file.fileType}</span>
								<span>{formatFileSize(getBase64FileSize(file.data))}</span>
							</div>
						{/each}
					</div>
				{/if}
			</div>

			{#if error}
				<div
					class="rounded px-3 py-2 text-sm border border-destructive bg-destructive/10 text-destructive"
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
					Downloading...
				{:else}
					Download {fileCount === 1 ? 'File' : `${fileCount} Files`}
				{/if}
			</Button>
		</div>
	{/if}
</div>
