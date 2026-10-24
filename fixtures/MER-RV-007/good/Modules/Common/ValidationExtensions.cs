namespace App.Modules.Common;

// Converts something other than a RivetResult.
public static class UnrelatedResultExtensions
{
    public static IResult ToResult(this ValidationResult result) => Results.Ok();
}
