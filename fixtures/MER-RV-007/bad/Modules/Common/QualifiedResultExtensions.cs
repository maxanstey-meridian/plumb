namespace App.Modules.Common;

// A bridge off RivetResult qualified by Rivet's namespace,
public static class QualifiedResultExtensions
{
    public static IResult ToHttp(this Rivet.RivetResult result) => Results.Json(result);
}

// or after global:: and that namespace.
public static class GlobalQualifiedResultExtensions
{
    public static IResult ToHttp(this global::Rivet.RivetResult result) => Results.Json(result);
}
