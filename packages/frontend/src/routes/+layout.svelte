<script lang="ts">
  import '../app.css';
  import { ModeWatcher } from 'mode-watcher';
  import Sonner from '$lib/components/ui/sonner/sonner.svelte';
  import { themeStore } from '$lib/stores/themeStore.svelte';
  import { onMount } from 'svelte';

  let { children } = $props();

  // Apply theme on mount and when it changes
  $effect(() => {
    if (typeof document !== 'undefined') {
      const theme = themeStore.current;
      document.documentElement.setAttribute('data-theme', theme);

      // Dynamically load the appropriate theme CSS
      const existingLink = document.querySelector('link[data-theme-link]');
      if (existingLink) {
        existingLink.remove();
      }

      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = `/styles/themes/${theme}.css`;
      link.setAttribute('data-theme-link', 'true');
      document.head.appendChild(link);
    }
  });
</script>

<ModeWatcher />
<Sonner />
{@render children?.()}
