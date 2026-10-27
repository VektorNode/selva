<script lang="ts">
	import { Inbox } from '@lucide/svelte';
	import { cn } from '#lib/utils.js';
	import * as Empty from './empty';
	import { Spinner } from './spinner';
	import SeverityIcon from './SeverityIcon.svelte';

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

	// Size only changes the breathing room; the look comes from Empty and the severity tokens.
	const PADDING = { small: 'p-4', medium: 'p-8', large: 'p-12' } as const;
</script>

<Empty.Root class={cn(PADDING[size], className)}>
	<Empty.Header>
		<Empty.Media variant="icon">
			{#if type === 'loading'}
				<Spinner />
			{:else if type === 'empty'}
				<Inbox />
			{:else}
				<SeverityIcon severity={type} />
			{/if}
		</Empty.Media>
		{#if title}
			<Empty.Title>{title}</Empty.Title>
		{/if}
		{#if message}
			<Empty.Description>{message}</Empty.Description>
		{/if}
	</Empty.Header>
</Empty.Root>
