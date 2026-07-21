using App.Modules.Forms.Domain;
using App.Modules.Forms.Application.CreateForm;
using App.Modules.Forms;
namespace App.Contracts.Forms;
public sealed record FormResponse(Form Entity, CreateFormResult Result, FormsController Controller);
