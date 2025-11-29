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
      container: 'p-6 gap-3',
      icon: 'w-8 h-8',
      title: 'text-sm font-semibold',
      message: 'text-xs',
    },
    medium: {
      container: 'p-12 gap-4',
      icon: 'w-12 h-12',
      title: 'text-lg font-semibold',
      message: 'text-sm',
    },
    large: {
      container: 'p-16 gap-6',
      icon: 'w-16 h-16',
      title: 'text-2xl font-bold',
      message: 'text-base',
    },
  };

  const typeClasses = {
    loading: {
      icon: 'text-blue-500',
      title: 'text-blue-900 dark:text-blue-100',
      message: 'text-blue-700 dark:text-blue-300',
      border: 'border-blue-200 dark:border-blue-800',
      background: 'bg-blue-50/50 dark:bg-blue-950/20',
    },
    error: {
      icon: 'text-red-500',
      title: 'text-red-900 dark:text-red-100',
      message: 'text-red-700 dark:text-red-300',
      border: 'border-red-200 dark:border-red-800',
      background: 'bg-red-50/50 dark:bg-red-950/20',
    },
    warning: {
      icon: 'text-yellow-500',
      title: 'text-yellow-900 dark:text-yellow-100',
      message: 'text-yellow-700 dark:text-yellow-300',
      border: 'border-yellow-200 dark:border-yellow-800',
      background: 'bg-yellow-50/50 dark:bg-yellow-950/20',
    },
    empty: {
      icon: 'text-gray-400 dark:text-gray-500',
      title: 'text-gray-900 dark:text-gray-100',
      message: 'text-gray-600 dark:text-gray-400',
      border: 'border-gray-200 dark:border-gray-700',
      background: 'bg-gray-50/50 dark:bg-gray-900/20',
    },
  };

  const sizeConfig = $derived(sizeClasses[size]);
  const typeConfig = $derived(typeClasses[type]);
</script>

<Card.Root class="border-2 {typeConfig.border} {typeConfig.background} {className}">
  <Card.Content class="flex flex-col items-center justify-center text-center {sizeConfig.container}">
    <div class="flex items-center justify-center {sizeConfig.icon} {typeConfig.icon}">
      {#if type === 'loading'}
        <Loader class="w-full h-full animate-spin" />
      {:else if type === 'error'}
        <AlertCircle class="w-full h-full" />
      {:else if type === 'warning'}
        <AlertTriangle class="w-full h-full" />
      {:else if type === 'empty'}
        <Inbox class="w-full h-full" />
      {/if}
    </div>

    {#if title}
      <h3 class="{sizeConfig.title} {typeConfig.title} mt-1">{title}</h3>
    {/if}

    {#if message}
      <p class="{sizeConfig.message} {typeConfig.message} max-w-md leading-relaxed">
        {message}
      </p>
    {/if}
  </Card.Content>
</Card.Root>
