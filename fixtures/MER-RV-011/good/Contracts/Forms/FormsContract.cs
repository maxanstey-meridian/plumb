namespace App.Contracts.Forms;
[RivetContract]
public static class FormsContract
{
    public static readonly RouteDefinition<CreateFormRequest, FormResponse> Create = Define.Post<CreateFormRequest, FormResponse>("/api/forms").Returns<ErrorResponse>(422);
    public static readonly RouteDefinition<List<FormResponse>> List = Define.Get<List<FormResponse>>("/api/forms");
    public static readonly RouteDefinition<PaginatedResponse<FormResponse>> Page = Define.Get<PaginatedResponse<FormResponse>>("/api/forms/page");
}
