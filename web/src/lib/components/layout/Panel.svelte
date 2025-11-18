<script lang="ts">
	import type { Snippet } from 'svelte';

	interface PanelProps {
		title?: string;
		headerActions?: Snippet;
		padding?: 'none' | 'small' | 'medium' | 'large';
		border?: boolean;
		shadow?: boolean;
		class?: string;
		children: Snippet;
	}

	let {
		title,
		headerActions,
		padding = 'medium',
		border = true,
		shadow = true,
		class: className = '',
		children
	}: PanelProps = $props();

	const paddingClasses = {
		none: '',
		small: 'p-4',
		medium: 'p-6',
		large: 'p-8'
	};

	const baseClasses = 'bg-white rounded-lg';
	const borderClass = border ? 'border border-gray-200' : '';
	const shadowClass = shadow ? 'shadow-sm' : '';

	const combinedClasses = $derived(
		`${baseClasses} ${borderClass} ${shadowClass} ${paddingClasses[padding]} ${className}`
	);
</script>

<div class={combinedClasses}>
	{#if title || headerActions}
		<div class="flex justify-between items-center mb-6 {padding !== 'none' ? '-mt-2' : ''}">
			{#if title}
				<h2 class="text-xl font-semibold text-gray-900">{title}</h2>
			{/if}

			{#if headerActions}
				<div class="flex gap-2">
					{@render headerActions()}
				</div>
			{/if}
		</div>
	{/if}

	{@render children()}
</div>
