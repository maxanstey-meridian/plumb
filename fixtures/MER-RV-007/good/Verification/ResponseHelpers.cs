namespace App.Verification;

// Test code may also write the adapter's output to a response it builds for an assertion: its helpers are no
// bridges.
public static class ResponseHelpers
{
    public static IResult Echo(this RivetResult result, HttpContext http)
    {
        var adapted = (RivetActionResult)result.ToActionResult();
        http.Response.StatusCode = adapted.StatusCode;
        return result.ToResult();
    }
}
