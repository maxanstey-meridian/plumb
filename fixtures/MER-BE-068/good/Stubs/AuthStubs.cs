namespace Microsoft.AspNetCore.Authorization
{
    [AttributeUsage(AttributeTargets.Class | AttributeTargets.Method, AllowMultiple = true)]
    public sealed class AuthorizeAttribute : Attribute
    {
        public string? Policy { get; set; }
    }
}

namespace Microsoft.AspNetCore.Mvc
{
    public abstract class ControllerBase { }
}

namespace App.Stubs
{
    public enum UserRole
    {
        Viewer,
        Editor,
        Admin,
        Owner,
    }

    public static class UserRoleExtensions
    {
        public static bool Outranks(this UserRole actor, UserRole target) => actor > target;
    }

    public interface IUserContext
    {
        UserRole Role { get; }
    }
}
