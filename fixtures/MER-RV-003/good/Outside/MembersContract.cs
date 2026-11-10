namespace App;

// Outside the scan (.plumbignore) but compiled: MembersContract.cs names a contract the rule reads no fields of.
public static class MembersContract
{
    public const string BaseRoute = "/api/members";
    public const string ListRoute = "/api/members";

    public static readonly RouteDefinition<ListMembersResponse> List = Define.Get<ListMembersResponse>(ListRoute);
}
