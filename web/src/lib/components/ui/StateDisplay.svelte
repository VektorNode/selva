<script lang="ts">
	import Icon from '@iconify/svelte';

	interface StateDisplayProps {
		type: 'loading' | 'error' | 'warning' | 'empty';
		message?: string;
		icon?: string; // Iconify icon name or custom icon
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
		loading: 'mynaui:spinner',
		error: 'material-symbols:error-outline-rounded',
		warning: 'material-symbols:warning-rounded',
		empty: 'ph:empty'
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
		loading: 'bg-card text-muted-foreground',
		error: 'bg-destructive/10 text-destructive',
		warning: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-500',
		empty: 'bg-muted text-muted-foreground'
	};

	const combinedClasses = $derived(
		`flex flex-col items-center justify-center text-center rounded-lg ${containerClasses[size]} ${typeClasses[type]} ${className}`
	);
</script>

<div class={combinedClasses}>
	{#if displayIcon}
		<div class={`${iconSizes[size]} mb-3`}>
			{#if type === 'loading'}
				<div class="animate-spin">
					<Icon icon={defaultIcons.loading}></Icon>
				</div>
			{:else}
				<Icon icon={displayIcon} />
			{/if}
		</div>
	{/if}

	{#if title}
		<h3 class="mb-2 text-xl font-semibold">{title}</h3>
	{/if}

	{#if message}
		<p class="max-w-md">{message}</p>
	{/if}
</div>
