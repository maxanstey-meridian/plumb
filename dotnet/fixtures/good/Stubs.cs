namespace FluentResults { public sealed class Result { } }
namespace Microsoft.Extensions.Logging { public interface ILogger { } }
public sealed class RivetContractAttribute : System.Attribute { }
public sealed class RouteDefinition<TInput, TOutput>
{
    public RouteDefinition<TInput, TOutput> Returns<TError>(int status) => this;
}
public static class Define
{
    public static RouteDefinition<TInput, TOutput> Post<TInput, TOutput>(string route) => new();
}
