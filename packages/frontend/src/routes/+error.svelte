<script>
  import { page } from '$app/state';
  import * as Card from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import { AlertCircle } from '@lucide/svelte';
</script>

<div
  class="min-h-screen flex items-center justify-center bg-linear-to-br from-slate-900 to-slate-800 p-4"
>
  <Card.Root class="max-w-md w-full">
    <Card.Header class="text-center">
      <div class="flex justify-center mb-4">
        <div class="rounded-full bg-destructive/10 p-3">
          <AlertCircle class="h-8 w-8 text-destructive" />
        </div>
      </div>
      <Card.Title class="text-3xl">{page.status}</Card.Title>
    </Card.Header>
    <Card.Content class="space-y-4">
      <div class="border border-destructive/50 bg-destructive/10 rounded-lg p-4">
        <div class="flex gap-3">
          <AlertCircle class="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <div class="flex-1">
            <p class="font-semibold text-sm text-destructive">Error</p>
            {#if page.error}
              <p class="text-sm text-destructive/80">{page.error.message}</p>
            {/if}
          </div>
        </div>
      </div>

      {#if page.error && typeof page.error === 'object' && 'details' in page.error}
        <div class="rounded-lg bg-slate-100 dark:bg-slate-800 p-4">
          <p class="text-sm font-mono text-slate-600 dark:text-slate-400 break-all">
            {page.error.details}
          </p>
        </div>
      {/if}
    </Card.Content>
    <Card.Footer class="flex gap-2">
      <Button variant="outline" class="flex-1">
        <a href="/" class="w-full">Go Home</a>
      </Button>
    </Card.Footer>
  </Card.Root>
</div>
