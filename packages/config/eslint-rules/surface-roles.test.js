import { RuleTester } from 'eslint';
import svelte from 'eslint-plugin-svelte';
import { describe, it } from 'node:test';
import { surfaceRoles } from './surface-roles.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const svelteParser = svelte.configs.base.find((c) => c.languageOptions?.parser).languageOptions
	.parser;
const tester = new RuleTester({ languageOptions: { parser: svelteParser } });

tester.run('surface-roles', surfaceRoles, {
	valid: [
		'<div class="bg-card border rounded-xl p-4"></div>',
		'<div class="hover:bg-hover data-[state=on]:bg-selected text-faint-foreground"></div>',
		// Opacity stays allowed on colour roles and on glass surfaces.
		'<div class="bg-primary/15 ring-destructive/20 bg-background/80 backdrop-blur"></div>',
		'<div class="rounded-inner rounded-t-md rounded-full rounded-inherit"></div>',
		"<script>const mode = 'rounded';</script>",
		{ code: '<div class="rounded-2xl"></div>', options: [{ radius: false }] }
	],
	invalid: [
		{ code: '<div class="border-border/60"></div>', errors: [{ messageId: 'dimmedRole' }] },
		{ code: '<div class="hover:bg-muted/50"></div>', errors: [{ messageId: 'dimmedRole' }] },
		{ code: '<div class="text-muted-foreground/70"></div>', errors: [{ messageId: 'dimmedRole' }] },
		{
			code: "<script>const c = cn('p-2', active && 'bg-accent text-accent-foreground');</script>",
			errors: [{ messageId: 'removedToken' }, { messageId: 'removedToken' }]
		},
		{ code: '<div class:bg-accent={on}></div>', errors: [{ messageId: 'removedToken' }] },
		{ code: '<div class="p-2 rounded"></div>', errors: [{ messageId: 'offScaleRadius' }] },
		{ code: '<div class="md:rounded-t-3xl"></div>', errors: [{ messageId: 'offScaleRadius' }] }
	]
});
