namespace App.Modules.Orders;

// A nested reader is seen from its sibling: the type around both declares it, and hides nothing.
public sealed class SiblingNestedReader
{
    sealed class Reader
    {
        public int Status(RivetActionResult adapted) => adapted.StatusCode;
    }

    sealed class Inner
    {
        public IResult Send(RivetActionResult adapted) => Results.StatusCode(new Reader().Status(adapted));
    }
}
