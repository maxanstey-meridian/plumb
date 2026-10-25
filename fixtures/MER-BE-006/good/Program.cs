// The host (top-level statements beside Common/ and Modules/) is a consumer: ClientAddress also has Users.
using Acme.Common;
var address = ClientAddress.Of("127.0.0.1");
var settings = new HostSettings(new(30));
// The host serves the health contract, so BuildStamp, which it names, is shared.
var health = new Acme.Contracts.Health.HealthResponse(new("1.0"));
