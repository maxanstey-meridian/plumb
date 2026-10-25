using Written = Rivet.RivetActionResult;

namespace App.Modules.Common;

// Returning the adapter on every path doesn't make a helper that writes the adapter's status to the response
// itself any less of a bridge,
public static class StatusWriterExtensions
{
    public static IResult ToHttp(this RivetResult result, HttpContext http)
    {
        var adapted = (RivetActionResult)result.ToActionResult();
        http.Response.StatusCode = adapted.StatusCode;
        return result.ToResult();
    }
}

// nor does reading it under an alias.
public static class AliasedStatusWriterExtensions
{
    public static IResult ToHttp(this RivetResult result, HttpContext http)
    {
        var adapted = (Written)result.ToActionResult();
        http.Response.StatusCode = adapted.StatusCode;
        return result.ToResult();
    }
}
