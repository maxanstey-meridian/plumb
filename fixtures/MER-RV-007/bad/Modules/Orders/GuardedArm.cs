namespace App.Modules.Orders;

// A switch arm's `when Allowed(status) =>` is no lambda taking status: the arm's result still copies it.
public sealed class GuardedArm
{
    private static bool Allowed(int status) => status < 500;

    public IResult Send(RivetActionResult adapted, string kind)
    {
        var status = adapted.StatusCode;
        return kind switch
        {
            _ when Allowed(status) => Results.StatusCode(status),
            _ => Results.Ok(),
        };
    }
}
