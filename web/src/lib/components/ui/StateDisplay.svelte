<script lang="ts">
	interface StateDisplayProps {
		type: 'loading' | 'error' | 'warning' | 'empty';
		message?: string;
		icon?: string;
		title?: string;
		size?: 'small' | 'medium' | 'large';
		class?: string;
	}

	let {
		type,
		message = '',
		icon,
		title,
		size = 'medium',
		class: className = ''
	}: StateDisplayProps = $props();

	const defaultIcons = {
		loading: '⏳',
		error: '❌',
		warning: '⚠️',
		empty: '📭'
	};

	const displayIcon = $derived(icon || defaultIcons[type]);

	const containerClasses = {
		small: 'p-4 text-sm',
		medium: 'p-8 text-base',
		large: 'p-16 text-lg'
	};

	const iconSizes = {
		small: 'text-2xl',
		medium: 'text-4xl',
		large: 'text-6xl'
	};

	const typeClasses = {
		loading: 'bg-white text-gray-600',
		error: 'bg-red-50 text-red-600',
		warning: 'bg-yellow-50 text-yellow-600',
		empty: 'bg-gray-50 text-gray-500'
	};

	const combinedClasses = $derived(
		`flex flex-col items-center justify-center text-center rounded-lg ${containerClasses[size]} ${typeClasses[type]} ${className}`
	);
</script>

<div class={combinedClasses}>
	{#if displayIcon}
		<div class={`${iconSizes[size]} mb-3`}>
			{#if type === 'loading'}
				<div class="animate-spin">⏳</div>
			{:else}
				{displayIcon}
			{/if}
		</div>
	{/if}

	{#if title}
		<h3 class="text-xl font-semibold mb-2">{title}</h3>
	{/if}

	{#if message}
		<p class="max-w-md">{message}</p>
	{/if}
</div>
