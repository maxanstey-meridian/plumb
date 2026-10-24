// Constraint keywords (`class`, `struct`) declare no type: the finding names ConstrainedRelay.
public sealed class ConstrainedRelay<T, U> where T : class where U : struct
{
    public IActionResult Copy(IActionResult adapted)
    {
        var a = (RivetActionResult)adapted;
        return new ObjectResult(a.Value) { StatusCode = a.StatusCode };
    }
}
