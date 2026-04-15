export interface ActionButton {
	id: string;
	label: string;
	icon?: any;
	variant?: 'default' | 'outline' | 'destructive' | 'secondary' | 'ghost';
	size?: 'default' | 'sm' | 'lg';
	onclick: () => void | Promise<void>;
}
