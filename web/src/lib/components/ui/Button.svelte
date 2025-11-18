<script lang="ts">
  import type { Snippet } from "svelte";

  interface ButtonProps {
    variant?: "primary" | "secondary" | "success" | "danger" | "ghost" | "icon";
    size?: "mini" | "small" | "medium" | "large";
    disabled?: boolean;
    loading?: boolean;
    icon?: string;
    onclick?: (e: Event) => void;
    type?: "button" | "submit" | "reset";
    class?: string;
    children: Snippet;
  }

  let {
    variant = "primary",
    size = "medium",
    disabled = false,
    loading = false,
    icon,
    onclick,
    type = "button",
    class: className = "",
    children,
  }: ButtonProps = $props();

  const baseClasses =
    "inline-flex items-center justify-center gap-2 font-medium transition-all rounded-md border focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed";

  const variantClasses = {
    primary:
      "bg-blue-600 text-white border-transparent hover:bg-blue-700 focus:ring-blue-500",
    secondary:
      "bg-gray-100 text-gray-900 border-gray-300 hover:bg-gray-200 focus:ring-gray-500",
    success:
      "bg-green-600 text-white border-transparent hover:bg-green-700 focus:ring-green-500",
    danger:
      "bg-red-600 text-white border-transparent hover:bg-red-700 focus:ring-red-500",
    ghost:
      "bg-transparent text-gray-700 border-transparent hover:bg-gray-100 focus:ring-gray-500",
    icon: "bg-transparent text-gray-600 border-transparent hover:bg-gray-100 focus:ring-gray-500 p-1",
  };

  const sizeClasses = {
    mini: "px-2 py-1 text-xs",
    small: "px-3 py-1.5 text-sm",
    medium: "px-4 py-2 text-base",
    large: "px-6 py-3 text-lg",
  };

  const combinedClasses = $derived(
    `${baseClasses} ${variantClasses[variant]} ${variant !== "icon" ? sizeClasses[size] : ""} ${className}`
  );
</script>

<button {type} class={combinedClasses} {disabled} {onclick}>
  {#if loading}
    <svg
      class="animate-spin h-4 w-4"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        class="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        stroke-width="4"
      ></circle>
      <path
        class="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      ></path>
    </svg>
  {:else if icon}
    <span>{icon}</span>
  {/if}
  {@render children()}
</button>
