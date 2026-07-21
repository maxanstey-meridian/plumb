using App.Contracts.Auth;
using App.Modules.Forms.Application;
using App.Modules.Forms.Contracts;
namespace App.Contracts.Forms;
[RivetContract]
public static class FormsContract
{
    public static readonly RouteDefinition<CreateFormCommand, ModuleFormSummary> Create = Define.Post<CreateFormCommand, ModuleFormSummary>("/api/forms").Returns<AuthError>(422);
}
