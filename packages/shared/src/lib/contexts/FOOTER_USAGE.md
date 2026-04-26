# Dynamic Footer System

The footer now supports a dynamic, context-based approach for adding page-specific content without prop drilling.

## How It Works

1. **FooterContext** manages a store of footer items
2. **PageContainer** initializes the context
3. **PageFooter** renders items from the context, plus error/warning messages
4. Pages can register items using `useFooterItem()` hook

## Usage Example

### Basic Usage

In any page component that's wrapped by `PageContainer`:

```svelte
<script lang="ts">
	import { useFooterItem } from '@selvajs/shared';

	let currentStep = $state(1);

	// Define your footer item as a snippet
	const stepIndicator = {
		render: () => `Step ${currentStep} of 5`
	};

	// Register it with the footer
	useFooterItem('step-indicator', stepIndicator, 'left', 1);
</script>

<!-- Your page content here -->
```

### Advanced: Dynamic Footer Items

Register multiple items and update them reactively:

```svelte
<script lang="ts">
	import { useFooterItem } from '@selvajs/shared';

	let solveCount = $state(0);
	let lastSolveTime = $state<string | null>(null);

	// Define snippet for solve info
	const solveInfo = {
		render: () => `Solves: ${solveCount} ${lastSolveTime ? `at ${lastSolveTime}` : ''}`
	};

	// Register with right position to appear on the right side
	useFooterItem('solve-info', solveInfo, 'right', 10);
</script>
```

### Using Inside Templates

Since snippets are defined in the template in Svelte 5, you can also register them directly:

```svelte
<script lang="ts">
	import { useFooter } from '@selvajs/shared';

	const footer = useFooter();

	// You can call register/unregister manually if needed
	onMount(() => {
		footer.register('my-item', mySnippet, 'left', 5);
		return () => {
			footer.unregister('my-item');
		};
	});

	const mySnippet = {
		/* ... */
	};
</script>
```

## API Reference

### `useFooterItem(id, content, position?, priority?)`

Helper hook that automatically registers and cleans up footer items.

- **id** (string): Unique identifier for this footer item
- **content** (Snippet): Svelte snippet to render
- **position** ('left' | 'right'): Where to display, defaults to 'left'
- **priority** (number): Higher values render first within position, defaults to 0

Returns cleanup function (called automatically on unmount).

### `useFooter()`

Direct access to the footer store for manual management.

```typescript
const footer = useFooter();

// Register an item
footer.register('item-id', content, 'left', 5);

// Unregister an item
footer.unregister('item-id');

// Get items by position
const leftItems = footer.getItemsByPosition('left');
```

## Positioning

### Left Position

Items appear to the left side of the footer, before error/warning messages:

- Custom left items (sorted by priority, highest first)
- Error/warning indicator
- Legacy footerChildren snippet (if provided)

### Right Position

Items appear on the right side of the footer:

- Custom right items (sorted by priority, highest first)
- Copyright notice

## Priority

Priority determines render order within each position. Higher values render first:

```
Priority 10 → renders first
Priority 5  → renders second
Priority 0  → renders third (default)
Priority -1 → renders last
```

## Benefits

✅ **No prop drilling** - Add footer content from any child component
✅ **Automatic cleanup** - Items unregister when component unmounts
✅ **Reactive** - Footer updates automatically when reactive values change
✅ **Flexible positioning** - Place items on left or right
✅ **Backwards compatible** - Legacy `footerChildren` prop still works

## Migration from Props

### Before (Prop-based)

```svelte
<!-- Page level -->
<PageContainer {errors} {warnings} let:footerChildren>
	<!-- Child components have no way to add footer content -->
</PageContainer>
```

### After (Context-based)

```svelte
<!-- Child component can now add footer items -->
<script lang="ts">
	import { useFooterItem } from '@selvajs/shared';
	useFooterItem('my-item', mySnippet);
</script>

<!-- Page level - no changes needed -->
<PageContainer {errors} {warnings}>
	<!-- Anywhere in this tree -->
	<ChildComponent />
</PageContainer>
```
