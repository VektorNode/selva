import type { Component } from 'svelte';
import { CircleAlert, CircleCheck, Info, Lightbulb, TriangleAlert } from '@lucide/svelte';

/** How serious a message is. Every status icon, callout and issue row takes its look from here. */
export type Severity = 'error' | 'warning' | 'info' | 'success' | 'note';

export const SEVERITY_ICON: Record<Severity, Component> = {
	error: CircleAlert,
	warning: TriangleAlert,
	info: Info,
	success: CircleCheck,
	note: Lightbulb
};

// Written out, never built from the key: Tailwind scans source text, so a constructed class
// name is never emitted and the icon would render colourless.
export const SEVERITY_TEXT: Record<Severity, string> = {
	error: 'text-destructive',
	warning: 'text-warning',
	info: 'text-info',
	success: 'text-success',
	note: 'text-muted-foreground'
};

/** Most severe first, for sorting mixed lists. */
export const SEVERITY_ORDER: readonly Severity[] = ['error', 'warning', 'info', 'success', 'note'];
