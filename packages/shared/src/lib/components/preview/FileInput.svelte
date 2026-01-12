<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import { FileUp, Link } from '@lucide/svelte';
	import { APP_CONSTANTS } from '$lib/constants';

	interface Props {
		value?: string;
		acceptedFormats?: string[];
		defaultInputMode?: 'upload' | 'url';
		onChange: (value: string) => void;
	}

	let {
		value = $bindable(),
		acceptedFormats = [],
		defaultInputMode = 'upload',
		onChange
	}: Props = $props();

	let fileInput: HTMLInputElement | null = $state(null);
	let uploadedFileName = $state('');
	let urlInput = $state('');
	let isDragging = $state(false);
	let isLoading = $state(false);

	// Parse existing value if it's JSON
	$effect(() => {
		if (value) {
			try {
				// Handle both string and object formats
				const parsed = typeof value === 'string' ? JSON.parse(value) : value;

				if (parsed.type === 'base64') {
					// Check if this is metadata-only (from backend after file applied)
					if (parsed._isMetadata && parsed._fileSize) {
						const sizeMB = (parsed._fileSize / 1024 / 1024).toFixed(2);
						uploadedFileName = `Uploaded file (${parsed.fileEnding}, ${sizeMB}MB)`;
					} else {
						// Full file data
						uploadedFileName = `Uploaded file (${parsed.fileEnding})`;
					}
				} else if (parsed.type === 'url') {
					urlInput = parsed.file;
				}
			} catch {
				// Not JSON, ignore
			}
		}
	});

	function getFileExtension(filename: string): string {
		const ext = filename.includes('.') ? '.' + filename.split('.').pop() : '.tmp';
		return ext.toLowerCase();
	}

	function isValidFileExtension(fileEnding: string): boolean {
		if (acceptedFormats.length === 0) return true;
		return acceptedFormats.includes(fileEnding.toLowerCase());
	}

	async function handleUrlChange() {
		if (!urlInput.trim()) return;

		isLoading = true;
		try {
			// Validate URL
			new URL(urlInput);

			// Fetch the file
			const response = await fetch(urlInput);
			if (!response.ok) {
				throw new Error(`Failed to fetch file: ${response.statusText}`);
			}

			const blob = await response.blob();
			const fileEnding = getFileExtension(urlInput);

			// Check file extension
			if (!isValidFileExtension(fileEnding)) {
				throw new Error(`File format not accepted: ${fileEnding}`);
			}

			// Check file size
			const maxSize = APP_CONSTANTS.FILE_UPLOAD.MAX_SIZE_BYTES;
			if (blob.size > maxSize) {
				throw new Error(
					`File too large: ${(blob.size / 1024 / 1024).toFixed(2)}MB (Max: ${APP_CONSTANTS.FILE_UPLOAD.MAX_SIZE_MB}MB)`
				);
			}

			// Convert to base64
			const reader = new FileReader();
			reader.onload = (e) => {
				const base64 = e.target?.result as string;
				const base64Data = base64.includes(',') ? base64.split(',')[1] : base64;

				const data = JSON.stringify({
					file: base64Data,
					type: 'base64',
					fileEnding
				});
				value = data;
				uploadedFileName = `Downloaded (${fileEnding})`;
				onChange(data);
				isLoading = false;
			};
			reader.readAsDataURL(blob);
		} catch (error) {
			console.error('URL fetch error:', error);
			isLoading = false;
			alert(`Error fetching file: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	}

	function handleFileUpload(event: Event) {
		const target = event.target as HTMLInputElement;
		const file = target.files?.[0];
		if (!file) return;

		const fileEnding = getFileExtension(file.name);

		// Check file extension
		if (!isValidFileExtension(fileEnding)) {
			alert(`File format not accepted: ${fileEnding}`);
			return;
		}

		uploadedFileName = file.name;

		// Convert to base64 for web usage
		const reader = new FileReader();
		reader.onload = (e) => {
			const base64 = e.target?.result as string;
			const base64Data = base64.includes(',') ? base64.split(',')[1] : base64;

			const data = JSON.stringify({
				file: base64Data,
				type: 'base64',
				fileEnding
			});
			value = data;
			onChange(data);
		};
		reader.readAsDataURL(file);
	}

	function openFilePicker() {
		fileInput?.click();
	}

	function handleDragOver(e: DragEvent) {
		e.preventDefault();
		isDragging = true;
	}

	function handleDragLeave() {
		isDragging = false;
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		isDragging = false;

		const files = e.dataTransfer?.files;
		if (files?.[0]) {
			const file = files[0];
			// Create a fake event to reuse handleFileUpload logic
			const fakeEvent = new Event('change');
			const fakeTarget = { files: files } as HTMLInputElement;
			Object.defineProperty(fakeEvent, 'target', { value: fakeTarget });
			handleFileUpload(fakeEvent);
		}
	}

	// Generate accept attribute for file input
	const acceptAttribute = $derived(acceptedFormats.length > 0 ? acceptedFormats.join(',') : '*');
</script>

<div class="gap-4 flex w-full flex-col">
	<!-- Hidden file input -->
	<input
		bind:this={fileInput}
		type="file"
		accept={acceptAttribute}
		onchange={handleFileUpload}
		class="hidden"
	/>

	{#if defaultInputMode === 'url'}
		<!-- URL Input -->
		<div class="gap-2 flex flex-col">
			<Label for="url-input" class="gap-2 flex items-center">
				<Link size={16} />
				File URL
			</Label>
			<div class="gap-2 flex">
				<Input
					id="url-input"
					type="url"
					bind:value={urlInput}
					placeholder="https://example.com/model.3dm"
					disabled={isLoading}
				/>
				<Button
					type="button"
					variant="outline"
					disabled={isLoading || !urlInput.trim()}
					onclick={handleUrlChange}
				>
					{isLoading ? 'Loading...' : 'Fetch'}
				</Button>
			</div>
			<p class="text-xs text-muted-foreground">
				Enter a URL and click Fetch to download and convert the file.
			</p>
		</div>
	{:else}
		<!-- File Upload (for web usage - base64) -->
		<div class="gap-2 flex flex-col">
			<Label for="file-upload" class="gap-2 flex items-center">
				<FileUp size={16} />
				Upload File
			</Label>
			<Button
				type="button"
				variant="outline"
				class="gap-2 w-full {isDragging ? 'border-blue-500' : ''}"
				onclick={openFilePicker}
				ondragover={handleDragOver}
				ondragleave={handleDragLeave}
				ondrop={handleDrop}
			>
				<FileUp size={16} />
				{uploadedFileName || 'Choose File or Drag & Drop'}
			</Button>
			{#if acceptedFormats.length > 0}
				<p class="text-xs text-muted-foreground">
					Accepted formats: {acceptedFormats.join(', ')}
				</p>
			{/if}
		</div>
	{/if}
</div>

<style>
	:global(.border-blue-500) {
		border-color: rgb(59, 130, 246);
	}
</style>
