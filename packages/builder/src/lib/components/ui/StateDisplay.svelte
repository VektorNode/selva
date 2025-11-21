<script lang="ts">
  import { Loader, AlertCircle, AlertTriangle, Inbox } from '@lucide/svelte';
  import * as Card from '$lib/components/ui/card';

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
    class: className = '',
  }: StateDisplayProps = $props();

  const sizeClasses = {
    small: {
      container: 'p-4 gap-2',
      icon: 'h-6 w-6',
      title: 'text-sm font-semibold',
      message: 'text-xs',
    },
    medium: {
      container: 'p-8 gap-3',
      icon: 'h-10 w-10',
      title: 'text-base font-semibold',
      message: 'text-sm',
    },
    large: {
      container: 'p-16 gap-4',
      icon: 'h-16 w-16',
      title: 'text-2xl font-bold',
      message: 'text-base',
    },
  };

  const typeClasses = {
    loading: {
      icon: 'text-blue-500',
      title: 'text-blue-900',
      message: 'text-blue-700',
      border: 'border-blue-200',
    },
    error: {
      icon: 'text-red-500',
      title: 'text-red-900',
      message: 'text-red-700',
      border: 'border-red-200',
    },
    warning: {
      icon: 'text-yellow-500',
      title: 'text-yellow-900',
      message: 'text-yellow-700',
      border: 'border-yellow-200',
    },
    empty: {
      icon: 'text-gray-500',
      title: 'text-gray-900',
      message: 'text-gray-700',
      border: 'border-gray-200',
    },
  };

  const sizeConfig = $derived(sizeClasses[size]);
  const typeConfig = $derived(typeClasses[type]);

  const containerClass = $derived(
    `flex flex-col items-center justify-center text-center ${sizeConfig.container}`
  );
</script>

<Card.Root class="border-2 {typeConfig.border} {className}">
  <Card.Content class={containerClass}>
    {#if type === 'loading'}
      <div class="{sizeConfig.icon} {typeConfig.icon}">
        <Loader class="animate-spin" />
      </div>
    {:else if type === 'error'}
      <AlertCircle class="{sizeConfig.icon} {typeConfig.icon}" />
    {:else if type === 'warning'}
      <AlertTriangle class="{sizeConfig.icon} {typeConfig.icon}" />
    {:else if type === 'empty'}
      <Inbox class="{sizeConfig.icon} {typeConfig.icon}" />
    {/if}

    {#if title}
      <h3 class="{sizeConfig.title} {typeConfig.title}">{title}</h3>
    {/if}

    {#if message}
      <p class="{sizeConfig.message} {typeConfig.message} max-w-md">{message}</p>
    {/if}
  </Card.Content>
</Card.Root>
