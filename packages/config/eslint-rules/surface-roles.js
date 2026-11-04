// Keeps every class on the surface system in packages/ui/src/lib/styles/base.css: neutral
// greys come from a role, never from a token dimmed with an opacity modifier, and corners come
// from the radius scale. The roles themselves: docs/contributing/design-system.md.

const NEUTRAL_ROLES = new Set([
	'foreground',
	'card-foreground',
	'popover-foreground',
	'secondary-foreground',
	'muted',
	'muted-foreground',
	'faint-foreground',
	'border',
	'border-strong',
	'input',
	'secondary',
	'hover',
	'selected',
	'raised',
	'field'
]);

// Removed tokens and what replaced them.
const REMOVED = {
	accent: 'hover (a hover state) or selected (the current item)',
	'accent-foreground': 'foreground',
	sidebar: 'card'
};

const COLOR_UTILITY =
	/^(bg|text|border(?:-[xytrblse])?|divide|ring|ring-offset|outline|fill|stroke|from|via|to|shadow|decoration|placeholder|caret)-(.+)$/;
const OFF_SCALE_RADIUS =
	/^rounded(?:-(?:[trblse]|tl|tr|bl|br|ss|se|es|ee))?(?:-(?:xs|2xl|3xl|4xl))?$/;
const ON_SCALE_RADIUS = /-(?:none|sm|inner|md|lg|xl|full|inherit)$/;

/** The utility a class applies, without variants (`hover:`, `data-[x]:`) or `!`. */
function utilityOf(token) {
	let depth = 0;
	let start = 0;
	for (let i = 0; i < token.length; i++) {
		const c = token[i];
		if (c === '[' || c === '(') depth++;
		else if (c === ']' || c === ')') depth--;
		else if (c === ':' && depth === 0) start = i + 1;
	}
	return token.slice(start).replace(/^!|!$/g, '');
}

function problemsIn(token, { radius }) {
	const utility = utilityOf(token);
	const color = utility.match(COLOR_UTILITY);
	if (color) {
		const [, , rest] = color;
		const [name, opacity] = rest.split('/');
		if (opacity !== undefined && NEUTRAL_ROLES.has(name))
			return { messageId: 'dimmedRole', data: { token } };
		const removed = REMOVED[name] ?? (name.startsWith('sidebar') ? REMOVED.sidebar : undefined);
		if (removed) return { messageId: 'removedToken', data: { token, use: removed } };
	}
	if (radius && OFF_SCALE_RADIUS.test(utility) && !ON_SCALE_RADIUS.test(utility)) {
		return { messageId: 'offScaleRadius', data: { token } };
	}
	return null;
}

/** @type {import('eslint').Rule.RuleModule} */
export const surfaceRoles = {
	meta: {
		type: 'problem',
		docs: { description: 'Neutral colors and corner radii come from the surface system roles.' },
		schema: [
			{
				type: 'object',
				properties: { radius: { type: 'boolean' } },
				additionalProperties: false
			}
		],
		messages: {
			dimmedRole:
				'"{{token}}" dims a neutral role with an opacity modifier. Use the role for what it means instead: hover, selected, border, border-strong, faint-foreground, muted.',
			removedToken: '"{{token}}" uses a removed token. Use {{use}}.',
			offScaleRadius:
				'"{{token}}" is off the radius scale. Use rounded-sm (chips, checkboxes), rounded-inner (item inside a control or menu), rounded-md (controls, rows), rounded-lg (popovers, menus), rounded-xl (cards, dialogs) or rounded-full.'
		}
	},
	create(context) {
		const options = { radius: true, ...context.options[0] };
		const check = (node, text) => {
			if (typeof text !== 'string' || !text) return;
			const tokens = text.split(/\s+/).filter(Boolean);
			// A lone bare word ('rounded', 'border') is a value, not a class list.
			if (tokens.length === 1 && !/[-:]/.test(tokens[0])) return;
			for (const token of tokens) {
				const problem = problemsIn(token, options);
				if (problem) context.report({ node, ...problem });
			}
		};
		return {
			Literal: (node) => check(node, node.value),
			TemplateElement: (node) => check(node, node.value.cooked),
			SvelteLiteral: (node) => check(node, node.value),
			SvelteDirective(node) {
				if (node.kind === 'Class') check(node, node.key.name.name ?? node.key.name);
			}
		};
	}
};

export const plugin = { rules: { 'surface-roles': surfaceRoles } };
