<script lang="ts">
	import { Button, Label } from '@selva/shared';
	import { Upload } from '@lucide/svelte';

	interface Props {
		id: string;
		label: string;
		accept?: string;
		disabled?: boolean;
		isUploading?: boolean;
		hasFile?: boolean;
		onFileSelected?: () => void;
		onUpload?: () => void;
		inputRef?: HTMLInputElement;
	}

	let { id, label, accept = '', disabled = false, isUploading = false, hasFile = false, onFileSelected, onUpload, inputRef }: Props = $props();
</script>

<div class="flex items-center gap-2">
	<input
		{id}
		type="file"
		bind:this={inputRef}
		{accept}
		{disabled}
		onchange={onFileSelected}
		class="border-input bg-background focus-visible:ring-ring flex h-10 flex-1 rounded-md border px-3 py-2 text-sm file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
	/>
	<Button
		size="sm"
		{disabled}
		onclick={onUpload}
	>
		<Upload class="mr-2 h-4 w-4" />
		{isUploading ? 'Uploading…' : 'Upload'}
	</Button>
</div>
