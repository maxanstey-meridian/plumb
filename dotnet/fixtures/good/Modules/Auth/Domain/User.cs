using System;

namespace Modules.Auth.Domain;

public sealed record User(string Id, string Email)
{
    public bool HasEmail => !string.IsNullOrEmpty(Email);
}
