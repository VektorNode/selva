<script lang="ts">
  type Props = {
    isOpen: boolean;
    size?: string;
    strokeWidth?: number;
    color?: string;
    animationDuration?: string;
    class?: string;
  };

  let {
    isOpen,
    size = '1em',
    strokeWidth = 2,
    color = 'currentColor',
    animationDuration,
    class: customClass = '',
  }: Props = $props();

  // Use custom duration or default
  const duration = $derived(animationDuration ?? '200ms');

  // Rotation angle based on open state
  const rotation = $derived(isOpen ? 90 : 0);

  // Build style string
  const iconStyle = $derived(
    `vertical-align: middle; transition: transform ${duration} ease-in-out; transform: rotate(${rotation}deg);`
  );
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 16 16"
  fill="none"
  style={iconStyle}
  class={customClass}
  aria-hidden="true"
>
  <!-- Single right-pointing chevron that rotates -->
  <polyline
    points="6,4 10,8 6,12"
    stroke={color}
    stroke-width={strokeWidth}
    fill="none"
    stroke-linecap="round"
    stroke-linejoin="round"
  />
</svg>
