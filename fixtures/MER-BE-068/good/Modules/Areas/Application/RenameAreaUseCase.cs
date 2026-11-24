using App.Stubs;

namespace App.Modules.Areas.Application;

public abstract record RenameAreaOutcome
{
    public sealed record Renamed : RenameAreaOutcome;
}

public abstract record RemoveMemberOutcome
{
    public sealed record Removed : RemoveMemberOutcome;

    public sealed record Forbidden : RemoveMemberOutcome;
}

public sealed record OrgMember(Guid Id, UserRole Role);

public sealed class RenameAreaUseCase
{
    public RenameAreaOutcome Execute(Guid areaId) => new RenameAreaOutcome.Renamed();

    public RemoveMemberOutcome RemoveMember(Guid memberId)
    {
        var targetUser = LoadMember(memberId);
        if (targetUser.Role == UserRole.Owner)
        {
            return new RemoveMemberOutcome.Forbidden();
        }

        return new RemoveMemberOutcome.Removed();
    }

    private static OrgMember LoadMember(Guid memberId) => new(memberId, UserRole.Viewer);
}
