namespace App.Modules.Orders;

// A pattern on a generic type opens no block: the copy after its braces is still this member's.
public static class GenericPattern
{
    public static IActionResult Copy(IActionResult r, object o) =>
        r is RivetActionResult a && o is List<int> { Count: 0 } ? new ObjectResult(a.Value) : r;
}
