import type { Component } from 'svelte';
import { Cloud, Monitor, Settings2 } from '@lucide/svelte';

/**
 * Where a builder setting takes effect. `shared` settings apply wherever the schema runs,
 * `local` ones only in the preview the plugin serves, `compute` ones only on Selva.
 */
export type Scope = 'shared' | 'local' | 'compute';

interface ScopeMark {
	label: string;
	icon: Component;
	text: string;
	surface: string;
	chip: string;
}

export const SCOPES: Record<Scope, ScopeMark> = {
	shared: {
		label: 'Shared',
		icon: Settings2,
		text: 'text-foreground',
		surface: 'border-border bg-muted/50',
		chip: 'bg-muted text-foreground'
	},
	local: {
		label: 'Local only',
		icon: Monitor,
		text: 'text-scope-local',
		surface: 'border-scope-local/30 bg-scope-local/8',
		chip: 'bg-scope-local/12 text-scope-local'
	},
	compute: {
		label: 'Compute only',
		icon: Cloud,
		text: 'text-scope-compute',
		surface: 'border-scope-compute/30 bg-scope-compute/8',
		chip: 'bg-scope-compute/12 text-scope-compute'
	}
};
