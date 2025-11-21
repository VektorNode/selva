<script lang="ts">
  type Props = {
    errorMessage: string | null;
    warnings: string[];
    computeErrors: string[];
    showMessages: boolean;
    onShowMessagesToggle: (show: boolean) => void;
    onDismissMessage: (type: 'error' | 'warning' | 'computeError', index?: number) => void;
    onClearAllMessages: () => void;
  };

  let {
    errorMessage,
    warnings,
    computeErrors,
    showMessages,
    onShowMessagesToggle,
    onDismissMessage,
    onClearAllMessages,
  }: Props = $props();
</script>

<!-- Messages Overlay -->
{#if showMessages && (errorMessage || warnings.length > 0 || computeErrors.length > 0)}
  <div class="absolute right-4 top-4 z-10 w-96 space-y-2">
    <!-- Toggle Button -->
    <div class="flex justify-end">
      <button
        onclick={() => onShowMessagesToggle(!showMessages)}
        class="rounded-full bg-gray-800 p-2 text-white transition-colors hover:bg-gray-700"
        title="Toggle messages"
        aria-label="Toggle messages"
      >
        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
    </div>

    <!-- Network/API Errors -->
    {#if errorMessage}
      <div class="rounded-lg border border-red-200 bg-red-50 p-4 shadow-lg">
        <div class="flex items-start">
          <svg
            class="mr-3 mt-0.5 h-5 w-5 shrink-0 text-red-600"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fill-rule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
              clip-rule="evenodd"
            />
          </svg>
          <div class="flex-1">
            <h3 class="text-sm font-medium text-red-800">Network Error</h3>
            <p class="mt-1 text-sm text-red-700">{errorMessage}</p>
          </div>
          <button
            onclick={() => onDismissMessage('error')}
            class="ml-2 text-red-600 hover:text-red-800"
            aria-label="Dismiss network error"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      </div>
    {/if}

    <!-- Compute Errors -->
    {#each computeErrors as error, index (index)}
      <div class="rounded-lg border border-red-200 bg-red-50 p-4 shadow-lg">
        <div class="flex items-start">
          <svg
            class="mr-3 mt-0.5 h-5 w-5 shrink-0 text-red-600"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fill-rule="evenodd"
              d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
              clip-rule="evenodd"
            />
          </svg>
          <div class="flex-1">
            <h3 class="text-sm font-medium text-red-800">Compute Error</h3>
            <p class="mt-1 text-sm text-red-700">{error}</p>
          </div>
          <button
            onclick={() => onDismissMessage('computeError', index)}
            class="ml-2 text-red-600 hover:text-red-800"
            aria-label="Dismiss compute error"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      </div>
    {/each}

    <!-- Warnings -->
    {#each warnings as warning, index (index)}
      <div class="rounded-lg border border-amber-200 bg-amber-50 p-4 shadow-lg">
        <div class="flex items-start">
          <svg
            class="mr-3 mt-0.5 h-5 w-5 shrink-0 text-amber-600"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fill-rule="evenodd"
              d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
              clip-rule="evenodd"
            />
          </svg>
          <div class="flex-1">
            <h3 class="text-sm font-medium text-amber-800">Warning</h3>
            <p class="mt-1 text-sm text-amber-700">{warning}</p>
          </div>
          <button
            onclick={() => onDismissMessage('warning', index)}
            class="ml-2 text-amber-600 hover:text-amber-800"
            aria-label="Dismiss warning"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      </div>
    {/each}

    <!-- Clear All Button -->
    {#if errorMessage || warnings.length > 0 || computeErrors.length > 0}
      <div class="flex justify-center">
        <button
          onclick={onClearAllMessages}
          class="rounded-md bg-gray-800 px-3 py-1 text-sm text-white transition-colors hover:bg-gray-700"
        >
          Clear All
        </button>
      </div>
    {/if}
  </div>
{/if}

<!-- Minimized Messages Indicator -->
{#if !showMessages && (errorMessage || warnings.length > 0 || computeErrors.length > 0)}
  <div class="absolute right-4 top-4 z-10">
    <button
      onclick={() => onShowMessagesToggle(true)}
      class="animate-pulse rounded-full bg-red-600 p-3 text-white shadow-lg transition-colors hover:bg-red-700"
      title="Show messages"
    >
      <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
        />
      </svg>
      <span
        class="absolute -right-1 -top-1 rounded-full bg-white px-1.5 py-0.5 text-xs font-bold text-red-600"
      >
        {(errorMessage ? 1 : 0) + warnings.length + computeErrors.length}
      </span>
    </button>
  </div>
{/if}
