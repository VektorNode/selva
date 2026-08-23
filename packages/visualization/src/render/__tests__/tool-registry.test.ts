import { describe, expect, it, vi } from 'vitest';

import { createToolRegistry, type PointerTool } from '../tool-registry';

function fakeTool(overrides: Partial<PointerTool> = {}): PointerTool {
	return {
		handleClick: () => false,
		...overrides
	};
}

// The registry only routes events, never reads them, so a stand-in keeps this suite off the DOM.
const click = () => ({ type: 'click' }) as unknown as MouseEvent;
const move = () => ({ type: 'mousemove' }) as unknown as MouseEvent;

describe('createToolRegistry', () => {
	it('dispatches by descending priority', () => {
		const order: string[] = [];
		const registry = createToolRegistry();

		registry.register({
			id: 'low',
			priority: -100,
			tool: fakeTool({
				handleClick: () => {
					order.push('low');
					return false;
				}
			})
		});
		registry.register({
			id: 'high',
			priority: 10,
			tool: fakeTool({
				handleClick: () => {
					order.push('high');
					return false;
				}
			})
		});

		registry.handleClick(click());

		expect(order).toEqual(['high', 'low']);
	});

	it('stops at the first tool that consumes the click', () => {
		const later = vi.fn(() => false);
		const registry = createToolRegistry();

		registry.register({ id: 'claims', priority: 10, tool: fakeTool({ handleClick: () => true }) });
		registry.register({ id: 'later', priority: 0, tool: fakeTool({ handleClick: later }) });

		expect(registry.handleClick(click())).toBe(true);
		expect(later).not.toHaveBeenCalled();
	});

	it('keeps registration order among equal priorities', () => {
		const order: string[] = [];
		const registry = createToolRegistry();

		for (const id of ['a', 'b', 'c']) {
			registry.register({
				id,
				tool: fakeTool({
					handleClick: () => {
						order.push(id);
						return false;
					}
				})
			});
		}

		registry.handleClick(click());

		expect(order).toEqual(['a', 'b', 'c']);
	});

	it('delivers moves to every tool regardless of what consumed the click', () => {
		const consumerMove = vi.fn();
		const otherMove = vi.fn();
		const registry = createToolRegistry();

		registry.register({
			id: 'consumer',
			priority: 10,
			tool: fakeTool({ handleClick: () => true, handleMove: consumerMove })
		});
		registry.register({ id: 'other', tool: fakeTool({ handleMove: otherMove }) });

		registry.handleMove(move());

		expect(consumerMove).toHaveBeenCalledOnce();
		expect(otherMove).toHaveBeenCalledOnce();
	});

	it('setActive enables one tool and disables the rest', () => {
		const a = vi.fn();
		const b = vi.fn();
		const registry = createToolRegistry();

		registry.register({ id: 'a', tool: fakeTool({ setEnabled: a }) });
		registry.register({ id: 'b', tool: fakeTool({ setEnabled: b }) });

		registry.setActive('a');

		expect(a).toHaveBeenCalledWith(true);
		expect(b).toHaveBeenCalledWith(false);
		expect(registry.getActive()).toBe('a');

		registry.setActive(null);

		expect(a).toHaveBeenLastCalledWith(false);
		expect(registry.getActive()).toBeNull();
	});

	it('registering a duplicate id replaces the earlier tool', () => {
		const first = vi.fn(() => false);
		const second = vi.fn(() => false);
		const registry = createToolRegistry();

		registry.register({ id: 'tool', tool: fakeTool({ handleClick: first }) });
		registry.register({ id: 'tool', tool: fakeTool({ handleClick: second }) });

		registry.handleClick(click());

		expect(first).not.toHaveBeenCalled();
		expect(second).toHaveBeenCalledOnce();
	});

	it('unregister stops dispatch and clears the tool if it was active', () => {
		const handleClick = vi.fn(() => false);
		const registry = createToolRegistry();

		const unregister = registry.register({ id: 'tool', tool: fakeTool({ handleClick }) });
		registry.setActive('tool');
		unregister();

		registry.handleClick(click());

		expect(handleClick).not.toHaveBeenCalled();
		expect(registry.getActive()).toBeNull();
		expect(registry.get('tool')).toBeNull();
	});

	it('survives a tool unregistering itself mid-dispatch', () => {
		const registry = createToolRegistry();
		const second = vi.fn(() => false);

		registry.register({
			id: 'first',
			priority: 10,
			tool: fakeTool({
				handleClick: () => {
					registry.unregister('first');
					return false;
				}
			})
		});
		registry.register({ id: 'second', tool: fakeTool({ handleClick: second }) });

		expect(() => registry.handleClick(click())).not.toThrow();
		expect(second).toHaveBeenCalledOnce();
	});
});
