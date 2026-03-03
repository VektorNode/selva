<script lang="ts">
	import { Button, Input } from '@selva/shared';
	import { Upload } from '@lucide/svelte';

	interface Props {
		mode?: 'url' | 'upload';
		value?: string;
		disabled?: boolean;
		isUploading?: boolean;
		hasFile?: boolean;
		onModeChange?: (mode: 'url' | 'upload') => void;
		onUpload?: () => void;
		onUrlChange?: (url: string) => void;
		onFileSelected?: () => void;
		inputRef?: HTMLInputElement;
	}

	let {
		mode = 'url',
		value = '',
		disabled = false,
		isUploading = false,
		hasFile = false,
		onModeChange,
		onUpload,
		onUrlChange,
		onFileSelected,
		inputRef = $bindable()
	}: Props = $props();
</script>

<div class="space-y-2">
	<!-- Mode toggle -->
	<div class="flex gap-1 rounded-md border p-0.5">
		<Button
			size="sm"
			variant={mode !== 'upload' ? 'default' : 'ghost'}
			onclick={() => onModeChange?.('url')}
			class="h-7 flex-1 text-xs"
		>
			URL
		</Button>
		<Button
			size="sm"
			variant={mode === 'upload' ? 'default' : 'ghost'}
			onclick={() => onModeChange?.('upload')}
			class="h-7 flex-1 text-xs"
		>
			Upload File
		</Button>
	</div>

	<!-- Content -->
	{#if mode === 'upload'}
		<div class="flex flex-col gap-2 sm:flex-row sm:items-center">
			<input
				type="file"
				bind:this={inputRef}
				accept="image/*"
				{disabled}
				onchange={onFileSelected}
				class="border-input bg-background focus-visible:ring-ring flex h-10 flex-1 rounded-md border px-3 py-2 text-sm file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
			/>
			<Button
				size="sm"
				disabled={disabled || !hasFile || isUploading}
				onclick={onUpload}
				class="shrink-0"
			>
				<Upload class="mr-2 h-4 w-4" />
				<span class="hidden sm:inline">{isUploading ? 'Uploading…' : 'Upload'}</span>
			</Button>
		</div>
	{:else}
		<Input
			type="text"
			{value}
			{disabled}
			oninput={(e) => onUrlChange?.((e.target as HTMLInputElement).value)}
			placeholder="https://..."
		/>
	{/if}
</div>
