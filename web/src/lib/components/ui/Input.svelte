<script lang="ts">
  interface InputProps {
    type?: "text" | "number" | "email" | "password" | "url";
    value?: string | number;
    placeholder?: string;
    disabled?: boolean;
    required?: boolean;
    min?: number;
    max?: number;
    step?: number;
    oninput?: (e: Event & { currentTarget: HTMLInputElement }) => void;
    onchange?: (e: Event & { currentTarget: HTMLInputElement }) => void;
    class?: string;
  }

  let {
    type = "text",
    value = $bindable(),
    placeholder,
    disabled = false,
    required = false,
    min,
    max,
    step,
    oninput,
    onchange,
    class: className = "",
  }: InputProps = $props();

  const baseClasses =
    "w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors disabled:bg-gray-100 disabled:cursor-not-allowed";

  const combinedClasses = $derived(`${baseClasses} ${className}`);
</script>

<input
  {type}
  bind:value
  {placeholder}
  {disabled}
  {required}
  {min}
  {max}
  {step}
  {oninput}
  {onchange}
  class={combinedClasses}
/>
