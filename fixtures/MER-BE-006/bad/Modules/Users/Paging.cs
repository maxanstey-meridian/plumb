// Users' own Paging shares the Common type's name; it doesn't make Users a consumer of Acme.Common.Paging.
namespace Acme.Modules.Users;
public sealed record Paging(int Cursor);
public sealed record UsersQuery(Paging Paging);
