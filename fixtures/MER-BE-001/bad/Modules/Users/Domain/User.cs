using Microsoft.EntityFrameworkCore;
using Acme.Modules.Users.Application.Ports;

namespace Acme.Modules.Users.Domain;
public sealed class User { public required string Email { get; init; } }
