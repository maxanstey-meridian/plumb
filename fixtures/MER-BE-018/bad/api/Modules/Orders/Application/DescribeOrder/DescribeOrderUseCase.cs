using App.Modules.Orders.Contracts;

namespace App.Modules.Orders.Application.DescribeOrder;

// A dependency inside a method body: no using in this file and no transport namespace on any line. The mapper comes in
// through the project's global using, and the wire type through `var`.
public sealed class DescribeOrderUseCase
{
    public string Execute(OrderSummary summary)
    {
        var wire = OrderTransportMapper.ToDto(summary);
        return wire.Reference;
    }
}
