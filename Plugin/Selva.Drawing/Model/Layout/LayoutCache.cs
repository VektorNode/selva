using System;
using System.Collections.Generic;
using System.Runtime.CompilerServices;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;

namespace Selva.Drawing.Model.Layout;

// Per-thread memo of LayoutElement.Resolve, alive only while a layout pass runs. Outside a pass
// every call resolves afresh, so an element built, resolved and then mutated by a caller is
// never served a stale result.
internal static class LayoutCache
{
	[ThreadStatic] private static Dictionary<Key, DrawElement> _memo;
	[ThreadStatic] private static int _depth;

	public static Scope Begin()
	{
		_depth++;
		return new Scope();
	}

	public static DrawElement Resolve(LayoutElement element, LayoutContext context)
	{
		if (_depth == 0) return element.ResolveUncached(context);
		// Created on first use: most scopes cover trees with no LayoutElement at all.
		var memo = _memo ??= new Dictionary<Key, DrawElement>(KeyComparer.Instance);

		var key = new Key(element, context.Available);
		if (memo.TryGetValue(key, out var resolved)) return resolved;

		resolved = element.ResolveUncached(context);
		memo[key] = resolved;
		return resolved;
	}

	public readonly struct Scope : IDisposable
	{
		public void Dispose()
		{
			if (--_depth == 0) _memo = null;
		}
	}

	private readonly struct Key
	{
		public readonly LayoutElement Element;
		public readonly BoundingBox Available;

		public Key(LayoutElement element, BoundingBox available)
		{
			Element = element;
			Available = available;
		}
	}

	// By reference: two equal-looking elements may still sit in different places of the tree.
	private sealed class KeyComparer : IEqualityComparer<Key>
	{
		public static readonly KeyComparer Instance = new KeyComparer();

		public bool Equals(Key a, Key b) =>
			ReferenceEquals(a.Element, b.Element) && a.Available.Equals(b.Available);

		public int GetHashCode(Key key)
		{
			unchecked
			{
				return (RuntimeHelpers.GetHashCode(key.Element) * 397) ^ key.Available.GetHashCode();
			}
		}
	}
}
