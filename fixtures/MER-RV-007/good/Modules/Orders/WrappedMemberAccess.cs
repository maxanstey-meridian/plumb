namespace App.Modules.Orders;

public sealed record Holder(Order adapted);

// A member access whose name follows its dot on the next line is another object's member, not the local or the
// helper of that name: here a holder's `adapted`,
public sealed class WrappedMemberRead
{
    public IResult Send(RivetActionResult adapted, Holder holder) => Results.Json(holder.
        adapted.Value);
}

public sealed class Meter
{
    public int Status() => 0;
}

// and a meter's Status(), not the member that returns a read.
public sealed class WrappedForeignCall(Meter meter, RivetActionResult adapted)
{
    private int Status() => adapted.StatusCode;

    public IResult Send() => Results.StatusCode(meter.
        Status());
}
