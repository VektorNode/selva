<script lang="ts">
  import type { Snippet } from 'svelte';
  import { slide } from 'svelte/transition';
  import NestedAccordion from './NestedAccordion.svelte';
  import type { NestedGroupNode } from '$lib/utils/input-grouping.js';

  interface Props {
    node: NestedGroupNode;
    nodeChildren: Snippet<[NestedGroupNode]>;
    level?: number;
    defaultOpen?: boolean;
    animationDuration?: number;
  }

  let {
    node,
    nodeChildren: children,
    level = 0,
    defaultOpen = true,
    animationDuration = 300,
  }: Props = $props();

  // State - simple reactive state bound to defaultOpen
  let isOpen = $state(defaultOpen);

  // Calculate indentation based on level
  const indentPadding = $derived(`${0.75 + level * 1.5}rem`);

  // Visual indicators for nesting
  const fontSize = $derived(`${0.875 - level * 0.025}rem`);
  const fontWeight = $derived(level === 0 ? 600 : level === 1 ? 550 : 500);

  // Stronger color differentiation for each level
  const backgroundColor = $derived(`hsl(var(--muted) / ${0.5 + level * 0.15})`);

  // Get child nodes as array
  const childNodes = $derived(Array.from(node.children.values()));

  function toggleItem() {
    isOpen = !isOpen;
  }

  function handleKeydown(event: KeyboardEvent) {
    switch (event.key) {
      case 'Enter':
      case ' ':
        event.preventDefault();
        toggleItem();
        break;
    }
  }
</script>

<div class="nested-accordion" style="--indent-padding: {indentPadding}; --nesting-level: {level};">
  <div class="accordion-item" class:is-nested={level > 0} data-level={level}>
    <h3 class="accordion-header">
      <button
        type="button"
        class="accordion-trigger"
        class:expanded={isOpen}
        aria-expanded={isOpen}
        onclick={toggleItem}
        onkeydown={handleKeydown}
        data-level={level}
        style="padding-left: {indentPadding}; font-size: {fontSize}; font-weight: {fontWeight}; background-color: {backgroundColor};"
      >
        <!-- Nesting indicator -->
        {#if level > 0}
          <span class="nesting-indicator" aria-hidden="true"></span>
        {/if}

        <span class="accordion-title-wrapper">
          <span class="accordion-title">{node.name}</span>
          {#if node.inputs.length > 0}
            <span class="input-count" title="{node.inputs.length} input(s)">
              {node.inputs.length}
            </span>
          {/if}
        </span>

        <span class="accordion-controls">
          {#if childNodes.length > 0}
            <span class="child-count" title="{childNodes.length} nested group(s)">
              {childNodes.length}
            </span>
          {/if}
          <span class="accordion-icon" aria-hidden="true">
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              class="chevron"
              class:rotated={isOpen}
            >
              <path
                d="M4 6L8 10L12 6"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </span>
        </span>
      </button>
    </h3>

    {#if isOpen}
      <div class="accordion-content" transition:slide={{ duration: animationDuration }}>
        <div class="accordion-body">
          <!-- Render inputs at this level -->
          {#if node.inputs.length > 0}
            <div class="inputs-container" style="padding-left: {indentPadding}">
              {@render children(node)}
            </div>
          {/if}

          <!-- Recursively render child nodes -->
          {#if childNodes.length > 0}
            <div class="children-container">
              {#each childNodes as childNode (childNode.path)}
                <NestedAccordion
                  node={childNode}
                  nodeChildren={children}
                  level={level + 1}
                  {defaultOpen}
                  {animationDuration}
                />
              {/each}
            </div>
          {/if}
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .nested-accordion {
    --accordion-border: #e2e8f0;
    --accordion-text: #0f172a;
    --accordion-text-secondary: #64748b;
    --accordion-header-bg: #f8fafc;
    --accordion-content-bg: #ffffff;
    --accordion-hover-bg: #f1f5f9;
    --accordion-focus-color: #2563eb;
    --nesting-level: 0;
  }

  .accordion-item {
    border-bottom: 1px solid var(--accordion-border);
    position: relative;
  }

  .accordion-item:last-child {
    border-bottom: none;
  }

  .accordion-item.is-nested {
    border-bottom: 1px solid hsl(var(--border) / 0.5);
    border-left: 3px solid hsl(var(--primary));
    margin-left: 0.5rem;
  }

  .accordion-header {
    margin: 0;
  }

  .accordion-trigger {
    width: 100%;
    padding: 0.875rem 1.25rem;
    border: none;
    text-align: left;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-size: 0.875rem;
    font-weight: 500;
    color: hsl(var(--foreground));
    transition: all 200ms cubic-bezier(0.4, 0, 0.2, 1);
    position: relative;
    border-radius: 0.25rem;
  }

  .accordion-trigger:hover {
    background-color: hsl(var(--muted) / 0.5);
    transform: translateX(2px);
  }

  .accordion-trigger:focus-visible {
    outline: 2px solid hsl(var(--ring));
    outline-offset: -2px;
    z-index: 1;
  }

  .accordion-trigger.expanded {
    background-color: hsl(var(--muted) / 0.3);
    border-left: 3px solid hsl(var(--primary));
    padding-left: calc(1.25rem - 3px);
  }

  /* Nesting indicator */
  .nesting-indicator {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 3px;
    background: linear-gradient(
      to bottom,
      var(--accordion-focus-color),
      var(--accordion-text-secondary)
    );
    opacity: 0.3;
    border-radius: 0 2px 2px 0;
  }

  .accordion-title-wrapper {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }

  .accordion-title {
    color: var(--accordion-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Badge styles */
  .input-count,
  .child-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.5rem;
    height: 1.5rem;
    padding: 0 0.375rem;
    border-radius: 0.75rem;
    font-size: 0.6875rem;
    font-weight: 600;
    flex-shrink: 0;
  }

  .input-count {
    background-color: var(--accordion-focus-color);
    color: white;
  }

  .child-count {
    background-color: var(--accordion-text-secondary);
    color: white;
    opacity: 0.8;
  }

  .accordion-controls {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
  }

  .accordion-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--accordion-text-secondary);
    transition: transform 200ms ease;
    flex-shrink: 0;
  }

  .chevron {
    transition: transform 200ms ease;
  }

  .chevron.rotated {
    transform: rotate(180deg);
  }

  .accordion-content {
    background-color: var(--accordion-content-bg);
    border-top: 1px solid var(--accordion-border);
  }

  .accordion-body {
    color: var(--accordion-text);
  }

  .inputs-container {
    padding: 1rem 1.25rem;
    background: linear-gradient(to right, hsl(var(--primary) / 0.02), transparent 2rem);
  }

  .children-container {
    display: block;
    padding-top: 0.25rem;
  }

  @media (prefers-reduced-motion: reduce) {
    .accordion-trigger,
    .accordion-icon,
    .chevron {
      transition: none;
    }

    .accordion-trigger:hover {
      transform: none;
    }
  }
</style>
