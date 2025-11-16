<script lang="ts" context="module">
  import { writable } from 'svelte/store';

  export interface DragData {
    type: 'parameter' | 'group-item' | 'group' | 'tab';
    data: any;
    sourceType?: string;
  }

  export const dragStore = writable<DragData | null>(null);
</script>

<script lang="ts">
  import { setContext } from 'svelte';

  setContext('dragdrop', dragStore);
</script>

<slot />
