using App.Stubs;

namespace App.Modules.Areas.Application;

public static class AreaAccess
{
    public static readonly UserRole[] Readers = [UserRole.Viewer, UserRole.Editor, UserRole.Admin];

    public static bool Allows(UserRole role) => role >= UserRole.Editor;
}
