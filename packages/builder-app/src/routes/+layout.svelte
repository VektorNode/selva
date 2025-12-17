<script lang="ts">
  import '../app.css';
  import { ModeWatcher } from 'mode-watcher';
  import { Toaster } from '@selva/ui-shared';

  let { children } = $props();
</script>

<ModeWatcher />
<Toaster />
{@render children?.()}
