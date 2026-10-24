namespace App.Modules.Orders;

// A property pattern's braces end no member: the copy after them is still this member's.
public static class PatternRelay
{
    public static IActionResult Copy(IActionResult r) => r is RivetActionResult { StatusCode: 200 } a ? new ObjectResult(a.Value) : r;
}
