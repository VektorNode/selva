// Polyfill so init-only setters and record types compile against netstandard2.0,
// which doesn't ship the IsExternalInit modreq the C# 9+ compiler emits.
// The type must live in the System.Runtime.CompilerServices namespace.
namespace System.Runtime.CompilerServices
{
	internal static class IsExternalInit { }
}
