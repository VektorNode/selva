<script lang="ts">
	import { Loader, AlertCircle, AlertTriangle, Inbox } from '@lucide/svelte';
	import * as Card from '$lib/components/primitives/card';

	interface StateDisplayProps {
		type: 'loading' | 'error' | 'warning' | 'empty';
		message?: string;
		title?: string;
		size?: 'small' | 'medium' | 'large';
		class?: string;
	}

	let {
		type,
		message = '',
		title,
		size = 'medium',
		class: className = ''
	}: StateDisplayProps = $props();

	const sizeClasses = {
		small: {
			container: 'p-6 gap-3',
			icon: 'w-8 h-8',
			title: 'text-sm font-semibold',
			message: 'text-xs'
		},
		medium: {
			container: 'p-12 gap-4',
			icon: 'w-12 h-12',
			title: 'text-lg font-semibold',
			message: 'text-sm'
		},
		large: {
			container: 'p-16 gap-6',
			icon: 'w-16 h-16',
			title: 'text-2xl font-bold',
			message: 'text-base'
		}
	};

	/* Fully semantic, contrast-safe mappings */
	const typeClasses = {
		loading: {
			icon: 'text-primary',
			title: 'text-primary-foreground',
			message: 'text-primary-foreground/80',
			border: 'border-primary',
			background: 'bg-primary/15'
		},
		error: {
			icon: 'text-destructive',
			title: 'text-destructive-foreground',
			message: 'text-destructive-foreground/80',
			border: 'border-destructive',
			background: 'bg-destructive/15'
		},
		warning: {
			icon: 'text-accent',
			title: 'text-accent-foreground',
			message: 'text-accent-foreground/80',
			border: 'border-accent',
			background: 'bg-accent/15'
		},
		empty: {
			icon: 'text-neutral',
			title: 'text-neutral-foreground',
			message: 'text-neutral-foreground/80',
			border: 'border-neutral',
			background: 'bg-neutral/15'
		}
	};

	const sizeConfig = $derived(sizeClasses[size]);
	const typeConfig = $derived(typeClasses[type]);
</script>

<Card.Root class="rounded-lg border-2 {typeConfig.border} {typeConfig.background} {className}">
	<Card.Content
		class="flex flex-col items-center justify-center text-center {sizeConfig.container}"
	>
		<div class="{sizeConfig.icon} {typeConfig.icon}">
			{#if type === 'loading'}
				<Loader class="animate-spin h-full w-full" />
			{:else if type === 'error'}
				<AlertCircle class="h-full w-full" />
			{:else if type === 'warning'}
				<AlertTriangle class="h-full w-full" />
			{:else if type === 'empty'}
				<Inbox class="h-full w-full" />
			{/if}
		</div>

		{#if title}
			<h3 class="{sizeConfig.title} {typeConfig.title} mt-1">
				{title}
			</h3>
		{/if}

		{#if message}
			<p class="{sizeConfig.message} {typeConfig.message} max-w-md leading-relaxed">
				{message}
			</p>
		{/if}
	</Card.Content>
</Card.Root>
