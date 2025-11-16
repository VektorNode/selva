<script lang="ts">
	import type { Snippet } from 'svelte';
	import Badge from './Badge.svelte';

	interface BadgeConfig {
		label: string;
		variant: 'connected' | 'disconnected' | 'solving' | 'compute';
	}

	interface PageHeaderProps {
		title: string;
		sessionId?: string;
		badge?: BadgeConfig;
		children?: Snippet;
		class?: string;
	}

	let {
		title,
		sessionId,
		badge,
		children,
		class: className = ''
	}: PageHeaderProps = $props();
</script>

<header
	class={`bg-white border-b border-gray-200 px-8 py-6 shadow-sm ${className}`}
>
	<h1 class="text-3xl font-bold text-gray-900 mb-2">{title}</h1>

	{#if sessionId || badge || children}
		<div class="flex items-center gap-4 text-gray-600 text-sm">
			{#if sessionId}
				<span>Session: <span class="font-mono">{sessionId}</span></span>
			{/if}

			{#if badge}
				<Badge variant={badge.variant} size="small">
					{badge.label}
				</Badge>
			{/if}

			{#if children}
				{@render children()}
			{/if}
		</div>
	{/if}
</header>
