using App.Stubs;

namespace App.Modules.Areas.Application;

public abstract record ManageMemberOutcome
{
    public sealed record Allowed : ManageMemberOutcome;

    public sealed record Forbidden : ManageMemberOutcome;
}

public static class OrgUserHierarchy
{
    public static ManageMemberOutcome CanManage(Guid actorId, UserRole actorRole, Guid targetId, UserRole targetRole)
    {
        if (actorId != targetId && (actorRole == UserRole.Owner || actorRole.Outranks(targetRole)))
        {
            return new ManageMemberOutcome.Allowed();
        }

        return new ManageMemberOutcome.Forbidden();
    }
}
