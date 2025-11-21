<script lang="ts">
  import type { Snippet } from "svelte";

  type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger";
  type ButtonSize = "sm" | "md" | "lg";
  type ButtonType = "button" | "submit" | "reset";

  interface Props {
    variant?: ButtonVariant;
    size?: ButtonSize;
    disabled?: boolean;
    fullWidth?: boolean;
    loading?: boolean;
    onclick?: () => void;
    type?: ButtonType;
    children: Snippet;
  }

  // Props with default values using Svelte 5 runes
  let {
    variant = "primary",
    size = "md",
    disabled = false,
    fullWidth = false,
    loading = false,
    onclick = () => {},
    type = "button",
    children,
  }: Props = $props();

  // Variant styles
  const variants: Record<ButtonVariant, string> = {
    primary: "bg-blue-600 hover:bg-blue-700 text-white",
    secondary: "bg-gray-600 hover:bg-gray-700 text-white",
    outline: "border-2 border-blue-600 text-blue-600 hover:bg-blue-50",
    ghost: "text-gray-700 hover:bg-gray-100",
    danger: "bg-red-600 hover:bg-red-700 text-white",
  };

  // Size styles
  const sizes: Record<ButtonSize, string> = {
    sm: "px-3 py-1.5 text-sm",
    md: "px-4 py-2 text-base",
    lg: "px-6 py-3 text-lg",
  };

  // Computed classes using $derived
  const buttonClasses = $derived(
    `inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${variants[variant]} ${sizes[size]} ${fullWidth ? "w-full" : ""} ${disabled || loading ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`,
  );
</script>

<button {type} class={buttonClasses} disabled={disabled || loading} {onclick}>
  {#if loading}
    <svg
      class="h-5 w-5 animate-spin"
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
  {/if}
  {@render children()}
</button>
