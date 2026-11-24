using App.Stubs;

namespace App.Modules.Areas.Application;

public sealed record RetentionPolicyView(bool CanEdit);

public sealed class RetentionPolicyProjection(IUserContext userContext)
{
    public RetentionPolicyView Project()
    {
        if (userContext.Role == UserRole.Admin)
        {
            return new RetentionPolicyView(true);
        }

        return new RetentionPolicyView(AreaAccess.Allows(userContext.Role));
    }
}
