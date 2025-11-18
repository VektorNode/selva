<script lang="ts">
	import type { Snippet } from 'svelte';

	interface BadgeProps {
		variant?:
			| 'connected'
			| 'disconnected'
			| 'solving'
			| 'compute'
			| 'info'
			| 'success'
			| 'warning'
			| 'error';
		size?: 'small' | 'medium' | 'large';
		icon?: string;
		class?: string;
		children: Snippet;
	}

	let {
		variant = 'info',
		size = 'medium',
		icon,
		class: className = '',
		children
	}: BadgeProps = $props();

	const baseClasses = 'inline-flex items-center gap-1.5 font-semibold rounded-full';

	const variantClasses = {
		connected: 'bg-green-500 text-white',
		disconnected: 'bg-red-500 text-white',
		solving: 'bg-orange-500 text-white',
		compute: 'bg-blue-500 text-white',
		info: 'bg-blue-100 text-blue-800',
		success: 'bg-green-100 text-green-800',
		warning: 'bg-yellow-100 text-yellow-800',
		error: 'bg-red-100 text-red-800'
	};

	const sizeClasses = {
		small: 'px-2 py-0.5 text-xs',
		medium: 'px-3 py-1 text-sm',
		large: 'px-4 py-1.5 text-base'
	};

	const combinedClasses = $derived(
		`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`
	);
</script>

<span class={combinedClasses}>
	{#if icon}
		<span>{icon}</span>
	{/if}
	{@render children()}
</span>
