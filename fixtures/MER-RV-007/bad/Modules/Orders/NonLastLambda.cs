namespace App.Modules.Orders;

public sealed record Entry(string Name);

// A lambda that shadows the local ends at its argument's `,`: the next argument's local is the outer one.
public sealed class NonLastLambda
{
    public IResult Send(RivetActionResult adapted, List<Entry> entries)
    {
        var value = adapted.Value;
        return Results.Ok(entries.ToDictionary(value => value.Name, entry => value));
    }
}
