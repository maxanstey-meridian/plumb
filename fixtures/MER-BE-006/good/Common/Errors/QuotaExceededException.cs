// An *Exception type is no candidate, but passes its consumers on: Users throwing it consumes QuotaLimit too.
namespace Acme.Common.Errors;
public sealed class QuotaExceededException(Acme.Common.QuotaLimit limit) : System.Exception($"over {limit.Max}");
