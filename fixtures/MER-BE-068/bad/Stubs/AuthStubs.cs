namespace App.Stubs;

public enum UserRole
{
    Viewer,
    Editor,
    Admin,
    Owner,
}

public interface IUserContext
{
    UserRole Role { get; }
}

public interface IAudiencePolicy
{
    bool AllowsAny(UserRole role, IReadOnlyList<UserRole> allowed);
}
