using System.Security.Claims;
using App.Stubs;

namespace App.Modules.Areas.Application;

public abstract record RenameAreaOutcome
{
    public sealed record Renamed : RenameAreaOutcome;

    public sealed record Forbidden : RenameAreaOutcome;
}

public abstract record ListAreasResult
{
    public sealed record Ok : ListAreasResult;

    public sealed record Forbidden : ListAreasResult;
}

public sealed class RenameAreaUseCase(IUserContext userContext, IAudiencePolicy audiences)
{
    public RenameAreaOutcome Execute()
    {
        if (!AreaAccess.Allows(userContext.Role))
        {
            return new RenameAreaOutcome.Forbidden();
        }

        return new RenameAreaOutcome.Renamed();
    }

    public ListAreasResult List()
    {
        if (!audiences.AllowsAny(userContext.Role, AreaAccess.Readers))
        {
            return new ListAreasResult.Forbidden();
        }

        return new ListAreasResult.Ok();
    }

    public void EnsureAdmin()
    {
        if (userContext.Role < UserRole.Admin)
        {
            throw new UnauthorizedAccessException();
        }
    }

    public RenameAreaOutcome ExecuteWithPrincipal(ClaimsPrincipal principal)
    {
        if (!principal.IsInRole("Admin"))
        {
            return new RenameAreaOutcome.Forbidden();
        }

        return new RenameAreaOutcome.Renamed();
    }
}
