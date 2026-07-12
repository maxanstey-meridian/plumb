namespace Acme.Modules.Users.Domain;

public sealed class FullyQualifiedDependency(
    global::Microsoft.EntityFrameworkCore.DbContext context,
    Acme.Modules.Users.Application.Ports.IUserRepository repository) { }
