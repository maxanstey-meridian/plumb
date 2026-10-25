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

// nor does reading it under an alias,
public static class AliasedStatusWriterExtensions
{
    public static IResult ToHttp(this RivetResult result, HttpContext http)
    {
        var adapted = (Written)result.ToActionResult();
        http.Response.StatusCode = adapted.StatusCode;
        return result.ToResult();
    }
}

// through a property pattern's binding,
public static class PatternStatusWriterExtensions
{
    public static IResult ToHttp(this RivetResult result, HttpContext http)
    {
        if (result.ToActionResult() is RivetActionResult { StatusCode: var status }) http.Response.StatusCode = status;
        return result.ToResult();
    }
}

// in an interpolated string's hole,
public static class InterpolatedValueWriterExtensions
{
    public static async Task<IResult> ToHttp(this RivetResult result, HttpContext http)
    {
        var adapted = result.ToActionResult();
        await http.Response.WriteAsync($"{((RivetActionResult)adapted).Value}");
        return result.ToResult();
    }
}

// or through an extension helper.
public static class HelperStatusWriterExtensions
{
    static int Code(this RivetActionResult adapted) => adapted.StatusCode;

    public static IResult ToHttp(this RivetResult result, HttpContext http)
    {
        var adapted = (RivetActionResult)result.ToActionResult();
        http.Response.StatusCode = adapted.Code();
        return result.ToResult();
    }
}
