using System;

namespace Acme.Modules.Users.Domain;
public sealed class User
{
    public required string Email { get; init; }
    public void Touch()
    {
        using var _ = new Reader(); // disposal `using` must not match
    }
}
public sealed class Reader : IDisposable { public void Dispose() { } }
// Microsoft.EntityFrameworkCore.DbContext is documentation, not a dependency.
public static class Examples
{
    public const string FrameworkType = "Microsoft.EntityFrameworkCore.DbContext";
}
