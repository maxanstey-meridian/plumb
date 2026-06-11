using Modules.Billing.Domain;          // MERBE005 — never cross
using Modules.Auth.Application;        // MERBE001 — Domain reaching up a layer
using Microsoft.EntityFrameworkCore;   // MERBE001 — framework in Domain

namespace Modules.Auth.Domain;

public sealed record User(string Id, string Email);
