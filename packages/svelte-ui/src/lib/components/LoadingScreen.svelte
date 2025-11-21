<script lang="ts">
  import { fade } from 'svelte/transition';

  interface Props {
    isVisible?: boolean;
    message?: string;
    progress?: number;
    showProgress?: boolean;
    backdrop?: 'blur' | 'solid' | 'transparent';
    spinnerSize?: 'small' | 'medium' | 'large';
    className?: string;
  }

  let {
    isVisible = false,
    message = 'Computing...',
    progress = undefined,
    showProgress = false,
    backdrop = 'blur',
    spinnerSize = 'large',
    className = '',
  }: Props = $props();

  // Spinner sizes
  const spinnerSizes = {
    small: '32px',
    medium: '48px',
    large: '64px',
  };

  const spinnerDimensions = $derived(spinnerSizes[spinnerSize]);
</script>

{#if isVisible}
  <div
    class="loading-screen {className}"
    transition:fade={{ duration: 200 }}
    style="--spinner-size: {spinnerDimensions};"
    role="status"
    aria-live="polite"
    aria-busy="true"
  >
    <!-- Blurred backdrop layer -->
    {#if backdrop === 'blur'}
      <div class="backdrop-blur"></div>
    {/if}

    <div class="loading-content">
      <!-- Animated Spinner -->
      <div class="spinner">
        <svg
          class="spinner-svg"
          viewBox="0 0 50 50"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <circle class="spinner-track" cx="25" cy="25" r="20" />
          <circle class="spinner-path" cx="25" cy="25" r="20" />
        </svg>
      </div>

      <!-- Message -->
      {#if message}
        <p class="loading-message" transition:fade={{ duration: 150 }}>
          {message}
        </p>
      {/if}

      <!-- Progress Bar -->
      {#if showProgress && progress !== undefined}
        <div class="progress-container" transition:fade={{ duration: 150 }}>
          <div class="progress-bar">
            <div
              class="progress-fill"
              style="width: {Math.min(100, Math.max(0, progress))}%"
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
            ></div>
          </div>
          <span class="progress-text">{Math.round(progress)}%</span>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .loading-screen {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: hsl(var(--background) / 0.8);
    z-index: 9999;
    transition: background-color 200ms ease;
  }

  .backdrop-blur {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    z-index: 0;
  }

  .loading-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.5rem;
    padding: 2rem;
    max-width: 24rem;
    text-align: center;
    position: relative;
    z-index: 10;
  }

  /* Spinner Styles */
  .spinner {
    width: var(--spinner-size);
    height: var(--spinner-size);
    position: relative;
  }

  .spinner-svg {
    width: 100%;
    height: 100%;
    animation: rotate 2s linear infinite;
    transform-origin: center;
  }

  .spinner-track {
    fill: none;
    stroke: hsl(var(--muted-foreground));
    stroke-width: 3;
    opacity: 0.2;
  }

  .spinner-path {
    fill: none;
    stroke: hsl(var(--primary));
    stroke-width: 3;
    stroke-linecap: round;
    stroke-dasharray: 90, 150;
    stroke-dashoffset: 0;
    animation: dash 1.5s ease-in-out infinite;
  }

  @keyframes rotate {
    100% {
      transform: rotate(360deg);
    }
  }

  @keyframes dash {
    0% {
      stroke-dasharray: 1, 150;
      stroke-dashoffset: 0;
    }
    50% {
      stroke-dasharray: 90, 150;
      stroke-dashoffset: -35;
    }
    100% {
      stroke-dasharray: 90, 150;
      stroke-dashoffset: -124;
    }
  }

  /* Message Styles */
  .loading-message {
    margin: 0;
    font-size: 1.125rem;
    font-weight: 500;
    color: hsl(var(--foreground));
    animation: pulse 2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.7;
    }
  }

  /* Progress Bar Styles */
  .progress-container {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    align-items: center;
  }

  .progress-bar {
    width: 100%;
    height: 8px;
    background-color: hsl(var(--muted-foreground));
    border-radius: 9999px;
    overflow: hidden;
    opacity: 0.3;
  }

  .progress-fill {
    height: 100%;
    background-color: hsl(var(--primary));
    border-radius: 9999px;
    transition: width 300ms ease;
    position: relative;
    overflow: hidden;
  }

  .progress-fill::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    bottom: 0;
    right: 0;
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.3), transparent);
    animation: shimmer 1.5s infinite;
  }

  @keyframes shimmer {
    0% {
      transform: translateX(-100%);
    }
    100% {
      transform: translateX(100%);
    }
  }

  .progress-text {
    font-size: 0.875rem;
    font-weight: 600;
    color: hsl(var(--foreground));
    opacity: 0.8;
  } /* Dark mode adjustments */
  .loading-screen.dark .spinner-track {
    opacity: 0.15;
  }

  /* Accessibility */
  @media (prefers-reduced-motion: reduce) {
    .spinner-svg,
    .spinner-path,
    .loading-message,
    .progress-fill::after {
      animation: none;
    }

    .progress-fill {
      transition: none;
    }
  }

  /* High contrast mode */
  @media (prefers-contrast: high) {
    .loading-screen {
      background-color: rgba(0, 0, 0, 0.98);
    }

    .spinner-track {
      opacity: 0.5;
    }

    .progress-bar {
      opacity: 0.6;
    }
  }
</style>
