// Only Forms uses Lookup. Its private Cache is no candidate: nothing outside Lookup can name it.
namespace Acme.Common;
public sealed class Lookup
{
    private sealed record Cache(int Size);
    private Cache? cache;
}
