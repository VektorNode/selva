// Polyfill so init-only setters and records compile on net48, which doesn't
// ship the IsExternalInit modreq the C# 9+ compiler emits. Must stay in
// System.Runtime.CompilerServices — the compiler looks for it by full name.
namespace System.Runtime.CompilerServices
{
    internal static class IsExternalInit { }
}
