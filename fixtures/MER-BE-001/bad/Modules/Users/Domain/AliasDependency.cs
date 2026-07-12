using Ef = Microsoft.EntityFrameworkCore;

namespace Acme.Modules.Users.Domain;
public sealed class AliasDependency(Ef.DbContext context) { }
