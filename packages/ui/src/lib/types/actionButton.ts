export interface ActionButton {
	id: string;
	label: string;
	/** A Svelte component, rendered before the label. */
	icon?: any;
	variant?: 'default' | 'outline' | 'destructive' | 'secondary' | 'ghost';
	size?: 'default' | 'sm' | 'lg';
	onclick: () => void | Promise<void>;
}
