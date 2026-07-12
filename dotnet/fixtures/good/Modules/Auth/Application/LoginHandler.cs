using FluentResults;                   // application result abstraction — allowed
using Microsoft.Extensions.Logging;   // application logging abstraction — allowed
using Modules.Auth.Domain;             // own Domain from Application — allowed direction
using Modules.Billing.Contracts;       // sibling published contract — allowed
using System;

namespace Modules.Auth.Application;

public sealed class LoginHandler
{
    public User Handle(string email, AccountStatus status) => new(status.Id, email);
}
