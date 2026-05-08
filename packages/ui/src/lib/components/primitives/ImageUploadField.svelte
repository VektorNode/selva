<script lang="ts">
	import { Button } from './button';
	import { Input } from './input';
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
	<div class="gap-1 p-0.5 flex rounded-md border">
		<Button
			size="sm"
			variant={mode !== 'upload' ? 'default' : 'ghost'}
			onclick={() => onModeChange?.('url')}
			class="h-7 text-xs flex-1"
		>
			URL
		</Button>
		<Button
			size="sm"
			variant={mode === 'upload' ? 'default' : 'ghost'}
			onclick={() => onModeChange?.('upload')}
			class="h-7 text-xs flex-1"
		>
			Upload File
		</Button>
	</div>

	<!-- Content -->
	{#if mode === 'upload'}
		<div class="gap-2 sm:flex-row sm:items-center flex flex-col">
			<input
				type="file"
				bind:this={inputRef}
				accept="image/*"
				{disabled}
				onchange={onFileSelected}
				class="h-10 px-3 py-2 text-sm file:text-sm file:font-medium flex flex-1 rounded-md border border-input bg-background file:border-0 file:bg-transparent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
			/>
			<Button
				size="sm"
				disabled={disabled || !hasFile || isUploading}
				onclick={onUpload}
				class="shrink-0"
			>
				<Upload class="mr-2 h-4 w-4" />
				<span class="sm:inline hidden">{isUploading ? 'Uploading…' : 'Upload'}</span>
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
