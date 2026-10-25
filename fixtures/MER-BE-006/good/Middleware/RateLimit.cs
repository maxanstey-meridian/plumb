// A host file other than Program.cs: RequestQuota's second consumer, beside module Forms.
using Acme.Common;
namespace Acme.Middleware;
public sealed class RateLimit { public RequestQuota Quota { get; } = new(60); }
