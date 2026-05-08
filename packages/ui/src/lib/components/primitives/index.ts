// UI Primitives - Reusable design system components

// shadcn-svelte components
export {
	Button,
	buttonVariants,
	type ButtonProps,
	type ButtonVariant,
	type ButtonSize
} from './button';
export { Badge, badgeVariants, type BadgeVariant } from './badge';
export { Input } from './input';
export { Search } from './search';
export { Textarea } from './textarea';
export { Label } from './label';
export { Checkbox } from './checkbox';
export { Slider } from './slider';
export * as Select from './select';
export * as Card from './card';
export * as Tabs from './tabs';
export * as Dialog from './dialog';
export { Drawer } from './drawer';
export * as Alert from './alert';
export * as AlertDialog from './alert-dialog';
export * as ContextMenu from './context-menu';
export * as Collapsible from './collapsible';
export { ScrollArea } from './scroll-area';
export * as Resizable from './resizable';

export { Separator } from './separator';
export { Switch } from './switch';
export { Toaster, toast } from './sonner';
export { ThemeSwitcher } from './theme-switcher';

// Custom components (not replaced by shadcn)
export { default as StateDisplay } from './StateDisplay.svelte';
export { default as CalculateButton } from './CalculateButton.svelte';
export { ModeToggle } from './mode-toggle';
export { default as ViewToggle } from './ViewToggle.svelte';
export { default as ImageUploadField } from './ImageUploadField.svelte';
export { default as DataTable, type DataTableColumn } from './DataTable.svelte';
