using App.Stubs;

namespace App.Modules.Areas.Application;

public sealed class VisiblePeople(IUserContext userContext)
{
    public IReadOnlyList<string> Filter(IReadOnlyList<string> allPeople, IReadOnlyList<string> ownedPeople) =>
        userContext.Role == UserRole.Admin ? allPeople : ownedPeople;
}
