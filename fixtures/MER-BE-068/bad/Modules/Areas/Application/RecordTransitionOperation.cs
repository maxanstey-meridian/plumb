using App.Stubs;

namespace App.Modules.Areas.Application;

public abstract record TransitionOutcome
{
    public sealed record Applied : TransitionOutcome;

    public sealed record Forbidden : TransitionOutcome;
}

public sealed class RecordTransitionOperation(IUserContext userContext)
{
    public TransitionOutcome Execute()
    {
        var role = userContext.Role;
        if (!AreaAccess.Allows(role))
        {
            return new TransitionOutcome.Forbidden();
        }

        return new TransitionOutcome.Applied();
    }
}
