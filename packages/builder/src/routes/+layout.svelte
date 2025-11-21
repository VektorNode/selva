<script lang="ts">
  import '../app.css';
  import { ModeWatcher } from 'mode-watcher';
  import Sonner from '$lib/components/ui/sonner/sonner.svelte';
  let { children } = $props();
</script>

<ModeWatcher />
<Sonner />
{@render children?.()}
