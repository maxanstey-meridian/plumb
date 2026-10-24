using App.Modules.Connectors.Contracts;
using Rivet;

namespace App.Contracts.Orders;

[RivetContract]
public static class OrderConnectorsContract
{
    public static readonly RouteDefinition<OrderConnectorDto> Get = Define.Get<OrderConnectorDto>("/api/orders/{id}/connector");
}

// The module's published records, fully qualified and through the using, not the transport namesakes.
public sealed record OrderConnectorDto(App.Modules.Connectors.Contracts.ConnectorManifest Manifest, ConnectorStep Step);
