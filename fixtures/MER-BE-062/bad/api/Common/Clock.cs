using App.Infrastructure;

namespace App.Common;

// Common names no module itself, but the host type it uses does.
public sealed class Clock
{
    public Calendar Calendar { get; } = new();
}
