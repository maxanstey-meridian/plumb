using App.Stubs;

namespace App.Modules.Areas.Application;

public static class AreaAccess
{
    public static bool Allows(UserRole role) => role >= UserRole.Editor;
}
