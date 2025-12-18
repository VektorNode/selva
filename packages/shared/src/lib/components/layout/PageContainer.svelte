<script lang="ts">
  import type { Snippet } from 'svelte';
  import PageFooter from './PageFooter.svelte';

  interface PageContainerProps {
    background?: 'default' | 'white' | 'gray';
    class?: string;
    children: Snippet;
  }

  let { background = 'default', class: className = '', children }: PageContainerProps = $props();

  const backgroundClasses = {
    default: 'bg-muted',
    white: 'bg-background',
    gray: 'bg-muted',
  };

  const combinedClasses = $derived(
    `flex flex-col h-screen overflow-hidden ${backgroundClasses[background]} ${className} `
  );
</script>

<div class={combinedClasses}>
  {@render children()}
  <div class="mt-auto shrink-0 z-50">
    <PageFooter />
  </div>
</div>
