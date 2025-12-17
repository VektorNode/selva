<script lang="ts">
  import { ModeWatcher } from 'mode-watcher';
  import '@selva/ui-shared/app.css';
  import '../app.css';

  let { children } = $props();
</script>

<ModeWatcher />
{@render children?.()}
