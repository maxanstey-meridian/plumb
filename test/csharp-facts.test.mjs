import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { Capability, createRuleDescriptor, defineRepositoryRule, planCapabilities } from "../lib/engine/contracts.mjs";
import { createRepositoryContext } from "../lib/engine/repository-context.mjs";
import { createRepositorySnapshot } from "../lib/engine/repository-snapshot.mjs";
import { APPLICATION_HIGHER_LAYERS, DOMAIN_HIGHER_LAYERS, EXTERNAL_PREFIXES, EXTERNAL_SEGMENTS, isFileLocalName, TOOL_STAMP, toolSourceHash } from "../lib/engine/csharp-facts.mjs";
import { restoreProjects } from "../scripts/dotnet-restore.mjs";

// Needs the .NET 10 SDK and the built tool (pnpm build:csharp). The cases run the tool through context.csharpFacts over
// temp repositories of package-free net10.0 projects. A repository is built and run once, on the first case that needs
// it, and the cases that can share one do.

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "plumb-csharp-facts-test-"));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

const lazy = (build) => {
  let value;
  return () => (value ??= build());
};

const project = (extra = "", sdk = "Microsoft.NET.Sdk", implicitUsings = "enable") => `<Project Sdk="${sdk}">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>${implicitUsings}</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>${extra}
</Project>
`;

function write(root, files) {
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
}

function inventoryOf(root, hidden = []) {
  const found = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "obj" && entry.name !== "bin") walk(full);
      } else {
        const relative = path.relative(root, full).split(path.sep).join("/");
        if (!hidden.includes(relative)) found.push(relative);
      }
    }
  };
  walk(root);
  return found.sort();
}

// A copy of the tool to run in place of the built one, for trying a change to it without touching the built tool.
const toolOverride = process.env.PLUMB_CSHARP_FACTS_TOOL ? { toolFolder: process.env.PLUMB_CSHARP_FACTS_TOOL } : {};

const factsRule = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-TO-901", source: "test" }),
  requirements: [Capability.CSHARP_FACTS],
  analyze() {},
});

// Runs the capability over a snapshot. `handed` collects the arguments the tool was run with.
function loadSnapshot(snapshot, runtime = {}) {
  const handed = [];
  const run = (command, args) => {
    handed.push(args);
    return spawnSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  };
  const repository = createRepositoryContext(snapshot, planCapabilities([factsRule]), { csharpFactsRuntime: { run, ...toolOverride, ...runtime } });
  const facts = repository.context.csharpFacts;
  return { facts, context: repository.context, diagnostics: repository.diagnostics(), handed };
}

// The project files the tool was asked to open: what follows its flags.
const projectsHanded = (args) => {
  const found = [];
  for (let index = args.findIndex((value) => value.endsWith(".dll")) + 1; index < args.length; index++) {
    if (args[index].startsWith("--")) index++;
    else found.push(args[index]);
  }
  return found;
};

// Builds a repository on disk, restores its projects, and runs the facts over it. `hidden` files are left out of the
// inventory altogether; `outOfScope` files are left out of `files` but still in the repository's inventory, as
// `.plumbignore` and `--exclude` leave them.
function repository(name, files, { restore = [""], hidden = [], outOfScope = [], runtime = {}, after = () => {} } = {}) {
  const root = path.join(scratch, name);
  write(root, files);
  for (const directory of restore) restoreProjects(path.join(root, directory));
  // What happens to the repository after its restore and before the run: a deleted file, or one added.
  after(root);
  const snapshot = createRepositorySnapshot({ root, mode: "test", files: inventoryOf(root, [...hidden, ...outOfScope]), outOfScope });
  return { root, ...loadSnapshot(snapshot, runtime) };
}

const refsOf = (repo, file) => repo.facts.references(repo.context.file(file) ?? file);
const sourceOf = (repo, file) => fs.readFileSync(path.join(repo.root, file), "utf8");
const lineAt = (source, offset) => source.slice(0, offset).split("\n").length;
const toName = (use) => use.to.replace(/^.*\./, "");

const modules = "App.Modules";
const mainFiles = {
  "api/Api.csproj": project(),
  "api/GlobalUsings.cs": "global using global::App.Modules.Forms.Contracts;\n",
  "api/Stubs/EfCore.cs": `namespace Microsoft.EntityFrameworkCore
{
    public class DbContext { public virtual int Save() => 0; }
    public class DbSet<T> where T : class { }
    public class ModelBuilder
    {
        public ModelBuilder HasDefaultSchema(string? schema) => this;
        public ModelBuilder Entity(string name, Action<Metadata.Builders.EntityTypeBuilder> build) => this;
    }
    public static class RelationalEntityTypeBuilderExtensions
    {
        public static Metadata.Builders.EntityTypeBuilder<T> ToTable<T>(this Metadata.Builders.EntityTypeBuilder<T> builder, string name) where T : class => builder;
        public static Metadata.Builders.EntityTypeBuilder<T> ToTable<T>(this Metadata.Builders.EntityTypeBuilder<T> builder, string name, string? schema) where T : class => builder;
        public static Metadata.Builders.EntityTypeBuilder<T> ToView<T>(this Metadata.Builders.EntityTypeBuilder<T> builder, string name, string? schema) where T : class => builder;
        public static Metadata.Builders.EntityTypeBuilder ToTable(this Metadata.Builders.EntityTypeBuilder builder, string name) => builder;
        public static Metadata.Builders.EntityTypeBuilder ToView(this Metadata.Builders.EntityTypeBuilder builder, string name) => builder;
        public static Metadata.Builders.OtherBuilder ToTable(this Metadata.Builders.OtherBuilder builder, string name) => builder;
    }
    public static class RelationalOwnedNavigationBuilderExtensions
    {
        public static Metadata.Builders.OwnedNavigationBuilder<TOwner, T> ToTable<TOwner, T>(this Metadata.Builders.OwnedNavigationBuilder<TOwner, T> builder, string name) where TOwner : class where T : class => builder;
        public static Metadata.Builders.OwnedNavigationBuilder ToTable(this Metadata.Builders.OwnedNavigationBuilder builder, string name) => builder;
        public static Metadata.Builders.OwnedNavigationBuilder ToView(this Metadata.Builders.OwnedNavigationBuilder builder, string name) => builder;
    }
}
namespace Microsoft.EntityFrameworkCore.Metadata.Builders
{
    public class EntityTypeBuilder
    {
        public EntityTypeBuilder OwnsOne(string ownedTypeName, string navigationName, Action<OwnedNavigationBuilder> buildAction) => this;
        public EntityTypeBuilder OwnsMany(string ownedTypeName, string navigationName, Action<OwnedNavigationBuilder> buildAction) => this;
    }
    public class EntityTypeBuilder<T> : EntityTypeBuilder where T : class
    {
        public EntityTypeBuilder<T> OwnsMany<TRelated>(System.Linq.Expressions.Expression<Func<T, System.Collections.Generic.IEnumerable<TRelated>>> navigation, Action<OwnedNavigationBuilder<T, TRelated>> buildAction) where TRelated : class => this;
    }
    public class OwnedNavigationBuilder
    {
        public OwnedNavigationBuilder OwnsOne(string ownedTypeName, string navigationName, Action<OwnedNavigationBuilder> buildAction) => this;
    }
    public class OwnedNavigationBuilder<TOwner, T> : OwnedNavigationBuilder where TOwner : class where T : class { }
    public class OtherBuilder { }
}
namespace Microsoft.EntityFrameworkCore.Migrations { public abstract class Migration { } }
namespace Microsoft.EntityFrameworkCore.Infrastructure { public abstract class ModelSnapshot { } }
namespace Rivet { public class RivetResult<T> { } }
`,
  "api/Modules/Ledger/Contracts/Entry.cs": `namespace ${modules}.Ledger.Contracts;
public sealed record Entry(int Id);
public interface IEntryPort { Entry Latest(); }
`,
  "api/Modules/Forms/Contracts/FormSummary.cs": `namespace ${modules}.Forms.Contracts;
public sealed record FormSummary(string Name);
public class Outer { public class Inner { } }
public static class Statics { public static int Count => 1; }
`,
  "api/Modules/Forms/Domain/FormEntity.cs": `namespace ${modules}.Forms.Domain;
public class FormEntity { public int Id; }
`,
  "api/Modules/Forms/Infrastructure/FormConfiguration.cs": `using ${modules}.Forms.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
namespace ${modules}.Forms.Infrastructure;
public sealed class FormConfiguration
{
    const string FormsView = "forms";
    static string Name() => "dynamic";
    public void Configure(EntityTypeBuilder<FormEntity> builder)
    {
        builder.ToTable("forms");
        builder.ToView(FormsView, "audit");
        var dynamicName = Name();
        builder.ToTable(dynamicName);
    }
}
[System.ComponentModel.DataAnnotations.Schema.Table("people")]
public sealed class PersonRow { }
[System.ComponentModel.DataAnnotations.Schema.Table("units", Schema = "dir")]
public sealed class UnitRow { }
[System.ComponentModel.DataAnnotations.Schema.Table(name: "named")]
public sealed class NamedRow { }
`,
  // An owned type's own table, through the owner's OwnsMany, is a mapping like an entity's.
  "api/Modules/Forms/Infrastructure/Owned.cs": `using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
namespace ${modules}.Forms.Infrastructure;
public sealed class LineRow { }
public sealed class Owner { public List<LineRow> Lines { get; } = []; }
public sealed class OwnedMapping
{
    public void Configure(EntityTypeBuilder<Owner> builder)
    {
        builder.OwnsMany(owner => owner.Lines, lines => lines.ToTable("form_lines"));
    }
}
`,
  // A ToView that isn't Entity Framework's, and a ToTable on a builder that isn't an EntityTypeBuilder: neither is a mapping.
  "api/Modules/Forms/Infrastructure/Mine.cs": `using ${modules}.Forms.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
namespace ${modules}.Forms.Infrastructure;
public static class MyExtensions { public static void ToView<T>(this EntityTypeBuilder<T> builder, string name, bool flag) where T : class { } }
public sealed class Mine
{
    public void Configure(EntityTypeBuilder<FormEntity> builder, OtherBuilder other)
    {
        builder.ToView("mine", true);
        other.ToTable("other");
    }
}
`,
  // A ToTable and a ToView whose schema is given and isn't a constant: the table is unknown, so neither is listed.
  "api/Modules/Forms/Infrastructure/Schemas.cs": `using ${modules}.Forms.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
namespace ${modules}.Forms.Infrastructure;
public sealed class Schemas
{
    static string Schema() => "dynamic";
    public void Configure(EntityTypeBuilder<FormEntity> builder)
    {
        builder.ToTable("in_schema", Schema());
        builder.ToView("view_in_schema", schema: Schema());
    }
}
`,
  "api/Persistence/AppDbContext.cs": `using ${modules}.Forms.Domain;
using Microsoft.EntityFrameworkCore;
namespace App.Persistence;
public abstract class AppDbContextBase : DbContext { }
public sealed class AppDbContext : AppDbContextBase
{
    public DbSet<FormEntity> Forms { get; set; } = null!;
    public override int Save() { FormEntity? f = null; return f is null ? 0 : 1; }
    public int CountOpenForms() { FormEntity? first = null; return first is null ? 0 : 1; }
    int A() => B();
    int B() => 1;
    protected void OnModelCreating(ModelBuilder modelBuilder) { modelBuilder.HasDefaultSchema("app"); }
}
`,
  "api/Migrations/AppModelSnapshot.cs": `using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
namespace App.Migrations;
public sealed class AppModelSnapshot : ModelSnapshot
{
    public void Build(ModelBuilder modelBuilder)
    {
        modelBuilder.HasDefaultSchema("snapshot");
        modelBuilder.Entity("${modules}.Forms.Domain.FormEntity", b => b.ToTable("forms"));
        modelBuilder.Entity("${modules}.Forms.Domain.Holder+Part", b => { b.ToTable("parts"); });
        // An owned type is written inside its owner's lambda, with a table of its own, and can own another.
        modelBuilder.Entity("${modules}.Forms.Domain.Orders", b =>
        {
            b.ToTable("orders");
            b.OwnsMany("${modules}.Forms.Domain.Orders+Line", "Lines", b1 =>
            {
                b1.ToTable("order_lines");
                b1.OwnsOne("${modules}.Forms.Domain.Deep", "Deep", b2 => { b2.ToView("deep_view"); });
            });
        });
    }
}
`,
  "api/Migrations/AddForms.cs": `using Microsoft.EntityFrameworkCore.Migrations;
namespace App.Migrations;
public partial class AddForms : Migration { }
`,
  "api/Migrations/AddForms.Designer.cs": `using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Migrations;
namespace App.Migrations;
public partial class AddForms : Migration
{
    void BuildTargetModel(ModelBuilder mb)
    {
        mb.HasDefaultSchema("designer");
        mb.Entity("A.B", b => b.ToTable("designer_table"));
    }
}
`,
  "api/Modules/Cases/Domain/Helper.cs": `namespace ${modules}.Cases.Application;
public sealed class Helper { }
public sealed class Order { }
`,
  "api/Modules/Cases/Application/Qualified.cs": `namespace ${modules}.Cases.Application;
public sealed class Qualified
{
    Forms.Contracts.FormSummary? a;
    Forms.Contracts.Outer.Inner? b;
    global::${modules}.Forms.Contracts.FormSummary? c;
    Helper? d;
}
`,
  "api/Modules/Cases/Application/Imported.cs": `using ${modules}.Forms.Contracts;
using Sum = ${modules}.Forms.Contracts.FormSummary;
using static ${modules}.Forms.Contracts.Statics;
namespace ${modules}.Cases.Application;
public sealed class Imported
{
    FormSummary? a;
    Sum? b;
    Outer.Inner? c;
    FormSummary? d; Forms.Contracts.FormSummary? e;
    int Total() => Count;
}
`,
  // `= null!` is two expressions of the field's type: `null!` and `null`.
  "api/Modules/Cases/Application/Literals.cs": `namespace ${modules}.Cases.Application;
public sealed class Literals
{
    Forms.Contracts.FormSummary a = null!;
}
`,
  "api/Modules/Cases/Application/RelativeUsing.cs": `namespace ${modules}.Cases.Application
{
    using Forms.Contracts;
    public sealed class RelativeUsing { FormSummary? a; }
}
`,
  "api/Modules/Cases/Application/UsingTargets.cs": `using G = global::App.Wire.Page<App.Wire.Item>;
namespace App.Wire { public class Page<T> { } public class Item { } }
`,
  "api/Modules/Billing/Application/Latest.cs": `using ${modules}.Ledger.Contracts;
namespace ${modules}.Billing.Application;
public sealed class Latest
{
    public void Run(IEntryPort ledger)
    {
        var entry = ledger.Latest();
    }
}
`,
  "api/Modules/Cases/Application/Ext.cs": `using ${modules}.Forms.Contracts;
namespace ${modules}.Cases.Application;
public static class FormExtensions { public static bool IsBlank(this FormSummary s) => s.Name.Length == 0; }
public static class FormBlock
{
    extension(FormSummary s)
    {
        public string Title => s.Name;
        public bool HasTitle() => s.Name.Length > 0;
        public Ledger.Contracts.Entry? Lookup() => null;
    }
}
public sealed class ExtUser
{
    public void Run(FormSummary form)
    {
        var a = form.IsBlank();
        var b = form.Title;
        var c = form.HasTitle();
    }
}
`,
  "api/Modules/Cases/Application/UsesDb.cs": `using App.Persistence;
namespace ${modules}.Cases.Application;
public sealed class UsesDb(AppDbContext db)
{
    public object Read() => db.Forms;
    public int Count() => db.CountOpenForms();
    public int Saved() => db.Save();
}
`,
  "api/Modules/Cases/Application/Marked.cs": `using App.Common;
namespace ${modules}.Cases.Application;
[Mark]
public sealed class Marked { }
`,
  "api/Common/Wrapper.cs": `namespace App.Common;
public sealed class MarkAttribute : Attribute { }
public class Wrapper
{
    [Mark]
    public class Nested { public ${modules}.Ledger.Contracts.Entry? Held; }
}
public class Holder
{
    [Obsolete("old")]
    private sealed record Hidden(int X);
}
public partial class Split { }
`,
  "api/Common/Split.More.cs": `namespace App.Common;
public partial class Split { }
`,
  "api/Common/Docs.cs": `namespace App.Common;
/// <summary>Uses <see cref="${modules}.Ledger.Contracts.Entry"/>.</summary>
public sealed class Docs { }
`,
  "api/Common/Results.cs": `using Rivet;
namespace App.Common;
public sealed class Results { RivetResult<${modules}.Cases.Application.Order>? r; }
`,
  "api/Common/Bom.cs": "﻿using App.Modules.Ledger.Contracts;\nnamespace App.Common;\npublic sealed class Bom\n{\n    Entry? e;\n    IEntryPort? p;\n}\n",
  "api/Common/Crlf.cs": "using App.Modules.Ledger.Contracts;\r\nnamespace App.Common;\r\npublic sealed class Crlf\r\n{\r\n    Entry? e;\r\n    IEntryPort? p;\r\n}\r\n",
  "api/Nested/Inner.csproj": project(),
  "api/Nested/Shared.cs": "namespace App.Nested;\npublic class Shared { Other? o; }\npublic class Other { }\n",
  "api/Ignored/Hidden.cs": `namespace App.Hidden;
public class Secret { ${modules}.Ledger.Contracts.Entry? e; }
`,
  "tests/Tests.csproj": project("\n  <PropertyGroup><IsTestProject>true</IsTestProject></PropertyGroup>"),
  "tests/Copy.cs": `namespace ${modules}.Forms.Contracts;
public sealed record FormSummary(string Name);
`,
  "loose/Loose.csproj": project(),
  "loose/Thing.cs": "namespace Loose;\npublic class Thing { }\n",
  "empty/Empty.csproj": project(),
  "orphan/Orphan.cs": "namespace Orphan;\npublic class Orphan { }\n",
};

const main = lazy(() => repository("main", mainFiles, { hidden: ["api/Ignored/Hidden.cs"] }));

test("the tool runs over a repository, passes only the projects of scanned files, and every project loads", () => {
  const repo = main();
  assert.deepEqual(repo.diagnostics, []);
  assert.equal(repo.facts.available, true);
  // A test project and a project with no backend root are passed; an empty project and a file in no project are not.
  assert.deepEqual(projectsHanded(repo.handed[0]), ["api/Api.csproj", "api/Nested/Inner.csproj", "loose/Loose.csproj", "tests/Tests.csproj"]);
  assert.deepEqual(repo.facts.projects.map((entry) => [entry.path, entry.loaded]), [
    ["api/Api.csproj", true],
    ["api/Nested/Inner.csproj", true],
    ["loose/Loose.csproj", true],
    ["tests/Tests.csproj", true],
  ]);
  assert.equal(repo.facts.hasFacts(repo.context.file("loose/Thing.cs")), true);
  assert.equal(repo.facts.hasFacts(repo.context.file("orphan/Orphan.cs")), false);
  assert.equal(repo.facts.hasFacts(repo.context.file("empty/Empty.csproj")), false);
  // The framework lists are passed to the tool, each prefix and segment as its own flag.
  const args = repo.handed[0];
  for (const prefix of EXTERNAL_PREFIXES) assert.ok(args.some((value, index) => value === prefix && args[index - 1] === "--external"), prefix);
  // The segments are the layers MER-BE-001 and MER-BE-002 judge, each rule's list once, in order.
  assert.deepEqual([DOMAIN_HIGHER_LAYERS, APPLICATION_HIGHER_LAYERS, EXTERNAL_SEGMENTS], [["Application", "Infrastructure"], ["Infrastructure"], ["Application", "Infrastructure"]]);
  for (const segment of EXTERNAL_SEGMENTS) assert.ok(args.some((value, index) => value === segment && args[index - 1] === "--external-segment"), segment);
});

test("usings come out with the full target the compiler binds", () => {
  const repo = main();
  const shape = (file) => repo.facts.usings(repo.context.file(file)).map(({ global, static: isStatic, alias, target, targetKind, type }) => ({ global, static: isStatic, alias, target, targetKind, type }));
  assert.deepEqual(shape("api/GlobalUsings.cs"), [{ global: true, static: false, alias: null, target: "App.Modules.Forms.Contracts", targetKind: "namespace", type: null }]);
  assert.deepEqual(shape("api/Modules/Cases/Application/Imported.cs"), [
    { global: false, static: false, alias: null, target: "App.Modules.Forms.Contracts", targetKind: "namespace", type: null },
    { global: false, static: false, alias: "Sum", target: "App.Modules.Forms.Contracts.FormSummary", targetKind: "type", type: "App.Modules.Forms.Contracts.FormSummary" },
    { global: false, static: true, alias: null, target: "App.Modules.Forms.Contracts.Statics", targetKind: "type", type: "App.Modules.Forms.Contracts.Statics" },
  ]);
  // A relative using inside a namespace block comes out in full.
  assert.deepEqual(shape("api/Modules/Cases/Application/RelativeUsing.cs"), [{ global: false, static: false, alias: null, target: "App.Modules.Forms.Contracts", targetKind: "namespace", type: null }]);
});

test("a using's target and type are the constructed alias's", () => {
  const repo = main();
  const [constructed] = repo.facts.usings(repo.context.file("api/Modules/Cases/Application/UsingTargets.cs"));
  assert.equal(constructed.target, "App.Wire.Page<App.Wire.Item>");
  assert.equal(constructed.targetKind, "type");
  assert.equal(constructed.type, "App.Wire.Page`1");
  assert.equal(constructed.assembly, "api/Api.csproj");
  assert.deepEqual(constructed.arguments, [{ type: "App.Wire.Item", assembly: "api/Api.csproj" }]);
});

// Aliases (and a `using static`) over types that hold another module's type: the using lists the types inside its target,
// and a use of the alias is a use of them too.
const aliasFiles = {
  "api/Api.csproj": project(),
  "api/Modules/Billing/Domain/Thing.cs": `namespace ${modules}.Billing.Domain;
public sealed class Thing { }
public struct Money { }
public static class Holder<T> { public static int Count = 0; }
public class Holder2<T> { public class Inner { } }
`,
  "api/Modules/Orders/Application/Aliases.cs": `using Bag = System.Collections.Generic.List<${modules}.Billing.Domain.Thing>;
using Arr = ${modules}.Billing.Domain.Thing[];
using Pair = (${modules}.Billing.Domain.Thing, int);
using Maybe = ${modules}.Billing.Domain.Money?;
using Plain = ${modules}.Billing.Domain.Thing;
using Deep = System.Collections.Generic.Dictionary<string, System.Collections.Generic.List<${modules}.Billing.Domain.Thing>>;
using static ${modules}.Billing.Domain.Holder<${modules}.Billing.Domain.Thing>;
using Keys = System.Collections.Generic.Dictionary<${modules}.Billing.Domain.Thing, int>.KeyCollection;
using Nested = ${modules}.Billing.Domain.Holder2<${modules}.Billing.Domain.Thing>.Inner;
namespace ${modules}.Orders.Application;
public sealed class Aliases
{
    Bag bag = new();
    Arr arr = [];
    Pair pair;
    Maybe maybe;
    Plain plain = new();
    Deep deep = new();
    Keys keys = null!;
    Nested nested = new();
    void Walk()
    {
        var e = bag.GetEnumerator();
    }
}
`,
};
const aliases = lazy(() => repository("aliasargs", aliasFiles));

test("a using over a type that holds other types lists them, and a plain alias lists none", () => {
  const repo = aliases();
  assert.deepEqual(repo.diagnostics, []);
  const thing = { type: `${modules}.Billing.Domain.Thing`, assembly: "api/Api.csproj" };
  const money = { type: `${modules}.Billing.Domain.Money`, assembly: "api/Api.csproj" };
  const usings = Object.fromEntries(repo.facts.usings(repo.context.file("api/Modules/Orders/Application/Aliases.cs")).map((using) => [using.alias ?? "static", using]));
  assert.deepEqual(usings.Bag.arguments, [thing]);
  assert.deepEqual(usings.Arr.arguments, [thing]);
  assert.deepEqual(usings.Pair.arguments, [thing]);
  assert.deepEqual(usings.Maybe.arguments, [money]);
  assert.deepEqual(usings.static.arguments, [thing]);
  // A type nested in a generic type holds that container's arguments: Thing is on Dictionary<Thing, int>, not on KeyCollection.
  assert.deepEqual(usings.Keys.arguments, [thing]);
  assert.deepEqual(usings.Nested.arguments, [thing]);
  // The outer type is left out (Holder is the repo's own, so it would be listed were it not), a type nested in a type
  // argument is listed, and an outside type nobody asked for (List, Dictionary, string) is not.
  assert.deepEqual(usings.Plain.arguments, []);
  assert.deepEqual(usings.Deep.arguments, [thing]);
});

test("a use of an alias is a use of the types inside its target, written as imported", () => {
  const repo = aliases();
  const file = "api/Modules/Orders/Application/Aliases.cs";
  const source = sourceOf(repo, file);
  const named = (alias) => refsOf(repo, file).filter((use) => source.slice(use.start, use.end) === alias && use.line > 11).map((use) => [use.to, use.written]);
  const thing = [`${modules}.Billing.Domain.Thing`, "imported"];
  // List itself is an outside type nobody asked for, so Thing is the one use.
  assert.deepEqual(named("Bag"), [thing]);
  assert.deepEqual(named("Arr"), [thing]);
  assert.deepEqual(named("Pair"), [thing]);
  assert.deepEqual(named("Maybe"), [[`${modules}.Billing.Domain.Money`, "imported"]]);
  assert.deepEqual(named("Plain"), [thing]);
  // An alias over a nested type of a generic type reaches the container's arguments; Keys's own type (Dictionary's
  // KeyCollection) is an outside type nobody asked for, and Nested's own type is the repo's.
  assert.deepEqual(named("Keys"), [thing]);
  assert.deepEqual(named("Nested"), [[`${modules}.Billing.Domain.Holder2\`1.Inner`, "imported"], thing]);
  // `var` over List<Thing>.Enumerator is a use of Thing though the enumerator's own type has no arguments.
  assert.deepEqual(named("var"), [[`${modules}.Billing.Domain.Thing`, "none"]]);
});

test("a using directive's names give no reference", () => {
  const repo = main();
  assert.deepEqual(refsOf(repo, "api/Modules/Cases/Application/UsingTargets.cs"), []);
  assert.deepEqual(refsOf(repo, "api/GlobalUsings.cs"), []);
});

test("a type name written qualified, through an enclosing namespace, or through a using says so", () => {
  const repo = main();
  // Every use in the file, in order: Forms.Contracts.* by its enclosing namespace's `App.Modules`, then global::, then a
  // type of the enclosing namespace that another folder declares.
  assert.deepEqual(refsOf(repo, "api/Modules/Cases/Application/Qualified.cs").map((use) => [toName(use), use.written, use.qualifier]), [
    ["FormSummary", "qualified", false],
    ["Outer", "qualified", true],
    ["Inner", "qualified", false],
    ["FormSummary", "qualified", false],
    ["Helper", "enclosing", false],
  ]);
  assert.deepEqual(refsOf(repo, "api/Modules/Cases/Application/Imported.cs").map((use) => [toName(use), use.member, use.written, use.qualifier]), [
    ["FormSummary", null, "imported", false],
    ["FormSummary", null, "imported", false],
    ["Outer", null, "imported", true],
    ["Inner", null, "imported", false],
    ["FormSummary", null, "imported", false],
    ["FormSummary", null, "qualified", false],
    ["Statics", "Count", "none", false],
  ]);
  assert.deepEqual(refsOf(repo, "api/Modules/Cases/Application/RelativeUsing.cs").map((use) => [toName(use), use.written]), [["FormSummary", "imported"]]);
});

test("a line with both a qualified and an imported use of one type gives two entries, each with its own span", () => {
  const repo = main();
  const file = "api/Modules/Cases/Application/Imported.cs";
  const source = sourceOf(repo, file);
  const both = refsOf(repo, file).filter((use) => use.line === 10);
  assert.deepEqual(both.map((use) => use.written), ["imported", "qualified"]);
  assert.deepEqual(both.map((use) => source.slice(use.start, use.end)), ["FormSummary", "FormSummary"]);
  assert.ok(both[0].end <= both[1].start);
  // The alias is its own use, spanning the alias as written.
  assert.deepEqual(refsOf(repo, file).filter((use) => use.line === 8).map((use) => source.slice(use.start, use.end)), ["Sum"]);
});

test("the expression pass records `= null!` as the field's type twice, with no name", () => {
  const repo = main();
  const file = "api/Modules/Cases/Application/Literals.cs";
  const source = sourceOf(repo, file);
  assert.deepEqual(refsOf(repo, file).map((use) => [toName(use), use.written, source.slice(use.start, use.end), use.fromMember]), [
    ["FormSummary", "qualified", "FormSummary", "a"],
    ["FormSummary", "none", "null!", "a"],
    ["FormSummary", "none", "null", "a"],
  ]);
});

test("an attribute name is a use of its class, written through the enclosing namespace or a using", () => {
  const repo = main();
  const wrapper = "api/Common/Wrapper.cs";
  const mark = refsOf(repo, wrapper).filter((use) => use.to === "App.Common.MarkAttribute");
  assert.equal(mark.length, 1);
  assert.equal(sourceOf(repo, wrapper).slice(mark[0].start, mark[0].end), "Mark");
  assert.equal(mark[0].written, "enclosing");
  // `from` is the innermost type: the nested class the attribute sits on.
  assert.equal(mark[0].from, "App.Common.Wrapper.Nested");
  const marked = refsOf(repo, "api/Modules/Cases/Application/Marked.cs");
  assert.deepEqual(marked.map((use) => [use.to, use.written, use.from]), [["App.Common.MarkAttribute", "imported", "App.Modules.Cases.Application.Marked"]]);
});

test("from is the innermost type, so a nested class's use is its own", () => {
  const repo = main();
  const held = refsOf(repo, "api/Common/Wrapper.cs").filter((use) => use.to === "App.Modules.Ledger.Contracts.Entry");
  assert.deepEqual(held.map((use) => [use.from, use.fromMember, use.written]), [["App.Common.Wrapper.Nested", "Held", "qualified"]]);
});

test("a type nobody writes is a use with no name: var, an expression's type, and a member through a value", () => {
  const repo = main();
  const file = "api/Modules/Billing/Application/Latest.cs";
  const source = sourceOf(repo, file);
  const entry = refsOf(repo, file).filter((use) => use.to === "App.Modules.Ledger.Contracts.Entry");
  assert.deepEqual(entry.map((use) => [source.slice(use.start, use.end), use.written]), [["var", "none"], ["ledger.Latest()", "none"]]);
  assert.deepEqual(refsOf(repo, file).filter((use) => use.member === "Latest").map((use) => [use.to, use.written]), [["App.Modules.Ledger.Contracts.IEntryPort", "none"]]);
});

test("a classic extension call and a C# 14 extension member are uses of their static class, with no name", () => {
  const repo = main();
  const file = "api/Modules/Cases/Application/Ext.cs";
  const callers = refsOf(repo, file).filter((use) => use.from === "App.Modules.Cases.Application.ExtUser" && use.member);
  assert.deepEqual(callers.map((use) => [use.member, use.to, use.written]), [
    ["IsBlank", "App.Modules.Cases.Application.FormExtensions", "none"],
    ["Title", "App.Modules.Cases.Application.FormBlock", "none"],
    ["HasTitle", "App.Modules.Cases.Application.FormBlock", "none"],
  ]);
});

test("inside a C# 14 extension block, from is the static class that holds it", () => {
  const repo = main();
  const inside = refsOf(repo, "api/Modules/Cases/Application/Ext.cs").filter((use) => use.fromMember === "Lookup" && use.written !== "none");
  assert.deepEqual(inside.map((use) => [toName(use), use.from]), [["Entry", "App.Modules.Cases.Application.FormBlock"]]);
});

test("db.Forms is a use of the entity inside its DbSet, with no name written", () => {
  const repo = main();
  const file = "api/Modules/Cases/Application/UsesDb.cs";
  const source = sourceOf(repo, file);
  const forms = refsOf(repo, file).filter((use) => use.to === "App.Modules.Forms.Domain.FormEntity");
  // The expression `db.Forms`, and its member name `Forms`, each of type DbSet<FormEntity>.
  assert.deepEqual(forms.map((use) => [source.slice(use.start, use.end), use.written, use.from, use.fromMember]), [
    ["db.Forms", "none", "App.Modules.Cases.Application.UsesDb", "Read"],
    ["Forms", "none", "App.Modules.Cases.Application.UsesDb", "Read"],
  ]);
});

test("a use of the root's members names the member, and an override is recorded as the member it overrides", () => {
  const repo = main();
  const uses = refsOf(repo, "api/Modules/Cases/Application/UsesDb.cs").filter((use) => use.member);
  assert.deepEqual(uses.map((use) => [use.member, use.to, use.fromMember]), [
    ["Forms", "App.Persistence.AppDbContext", "Read"],
    ["CountOpenForms", "App.Persistence.AppDbContext", "Count"],
    // `db.Save()` binds to the root's override; the compiler dispatches through the stub's `Save`.
    ["Save", "Microsoft.EntityFrameworkCore.DbContext", "Saved"],
  ]);
});

test("inside a root, a use of the entity names its member, and one member calling another is seen", () => {
  const repo = main();
  const db = "api/Persistence/AppDbContext.cs";
  const own = refsOf(repo, db).filter((use) => use.to === "App.Modules.Forms.Domain.FormEntity" && use.written === "imported");
  assert.deepEqual(own.map((use) => use.fromMember), ["Forms", "Save", "CountOpenForms"]);
  const calls = refsOf(repo, db).filter((use) => use.member === "B");
  assert.deepEqual(calls.map((use) => [use.from, use.fromMember, use.to]), [["App.Persistence.AppDbContext", "A", "App.Persistence.AppDbContext"]]);
});

test("a use of a type inside its own declaration isn't listed", () => {
  const repo = main();
  const own = refsOf(repo, "api/Persistence/AppDbContext.cs").filter((use) => use.from === use.to && !use.member);
  assert.deepEqual(own, []);
});

test("a type's base types include every base class and interface, in source or not", () => {
  const repo = main();
  const entry = repo.facts.types.get("App.Persistence.AppDbContext");
  assert.ok(entry.baseTypes.includes("Microsoft.EntityFrameworkCore.DbContext"));
  assert.ok(entry.baseTypes.includes("App.Persistence.AppDbContextBase"));
  assert.ok(entry.baseTypes.includes("System.Object"));
});

test("a partial type lists every part, and types carry access, namespace, containing, and the keyword's offset", () => {
  const repo = main();
  const split = repo.facts.types.get("App.Common.Split");
  assert.deepEqual(split.parts.map((part) => part.file.path).sort(), ["api/Common/Split.More.cs", "api/Common/Wrapper.cs"]);
  const hidden = repo.facts.types.get("App.Common.Holder.Hidden");
  assert.equal(hidden.kind, "record");
  assert.equal(hidden.access, "private");
  assert.equal(hidden.namespace, "App.Common");
  assert.equal(hidden.containing, "App.Common.Holder");
  const source = sourceOf(repo, "api/Common/Wrapper.cs");
  const [part] = hidden.parts;
  assert.equal(source.slice(part.start, part.start + "record".length), "record");
  assert.equal(source.slice(part.start, part.end), "record Hidden(int X);");
  assert.equal(part.line, lineAt(source, part.start));
  assert.equal(part.endLine, part.line);
  assert.equal(repo.facts.types.get("App.Common.Wrapper.Nested").access, "public");
  assert.equal(repo.facts.types.get("App.Common.Wrapper.Nested").containing, "App.Common.Wrapper");
});

test("a doc comment's cref is no use", () => {
  assert.deepEqual(refsOf(main(), "api/Common/Docs.cs"), []);
});

test("RivetResult<Order> is a use of RivetResult spanning only that identifier, and one of Order", () => {
  const repo = main();
  const file = "api/Common/Results.cs";
  const source = sourceOf(repo, file);
  assert.deepEqual(refsOf(repo, file).map((use) => [use.to, source.slice(use.start, use.end), use.written]), [
    ["Rivet.RivetResult`1", "RivetResult", "imported"],
    ["App.Modules.Cases.Application.Order", "Order", "qualified"],
  ]);
});

test("Outer.Inner is a use of Inner and a use of Outer with qualifier true", () => {
  const repo = main();
  const file = "api/Modules/Cases/Application/Imported.cs";
  const source = sourceOf(repo, file);
  const pair = refsOf(repo, file).filter((use) => use.line === 9);
  assert.deepEqual(pair.map((use) => [source.slice(use.start, use.end), use.to, use.qualifier]), [
    ["Outer", "App.Modules.Forms.Contracts.Outer", true],
    ["Inner", "App.Modules.Forms.Contracts.Outer.Inner", false],
  ]);
});

test("tables: ToTable and ToView on an EntityTypeBuilder, a [Table] attribute, and nothing else", () => {
  const repo = main();
  assert.deepEqual(repo.facts.tables.map((table) => [table.file.path, table.line, table.method, table.schema, table.table]), [
    ["api/Modules/Forms/Infrastructure/FormConfiguration.cs", 11, "ToTable", null, "forms"],
    // ToView("forms", "audit") through a const name; the dynamic name, `Mine.cs`'s ToView, and its OtherBuilder's ToTable give none.
    ["api/Modules/Forms/Infrastructure/FormConfiguration.cs", 12, "ToView", "audit", "forms"],
    ["api/Modules/Forms/Infrastructure/FormConfiguration.cs", 17, "Table", null, "people"],
    ["api/Modules/Forms/Infrastructure/FormConfiguration.cs", 19, "Table", "dir", "units"],
    // `[Table(name: "named")]` names the constructor's parameter.
    ["api/Modules/Forms/Infrastructure/FormConfiguration.cs", 21, "Table", null, "named"],
    // An owned type's own table, through the owner's OwnsMany.
    ["api/Modules/Forms/Infrastructure/Owned.cs", 10, "ToTable", null, "form_lines"],
  ]);
  // A ToTable or ToView whose schema argument isn't a constant leaves the table unknown, so Schemas.cs gives none.
  assert.ok(!repo.facts.tables.some((table) => table.file.path.endsWith("Schemas.cs")));
});

test("a migrations snapshot's entities are snapshotTables, not tables, and its nested entity's + is a dot", () => {
  const repo = main();
  assert.deepEqual(repo.facts.snapshotTables.map((table) => [table.file.path, table.entity, table.method, table.schema, table.table]), [
    ["api/Migrations/AppModelSnapshot.cs", "App.Modules.Forms.Domain.FormEntity", "ToTable", null, "forms"],
    ["api/Migrations/AppModelSnapshot.cs", "App.Modules.Forms.Domain.Holder.Part", "ToTable", null, "parts"],
    ["api/Migrations/AppModelSnapshot.cs", "App.Modules.Forms.Domain.Orders", "ToTable", null, "orders"],
    // An owned type's table is the owned type's, however deep it is owned.
    ["api/Migrations/AppModelSnapshot.cs", "App.Modules.Forms.Domain.Orders.Line", "ToTable", null, "order_lines"],
    ["api/Migrations/AppModelSnapshot.cs", "App.Modules.Forms.Domain.Deep", "ToView", null, "deep_view"],
  ]);
  assert.ok(repo.facts.tables.every((table) => !table.file.path.startsWith("api/Migrations/")));
});

test("HasDefaultSchema is a defaultSchema outside migrations code, and a migration's Designer gives no table or schema", () => {
  const repo = main();
  assert.deepEqual(repo.facts.defaultSchemas.map((entry) => [entry.file.path, entry.schema]), [["api/Persistence/AppDbContext.cs", "app"]]);
  const designer = (list) => list.filter((entry) => entry.file.path === "api/Migrations/AddForms.Designer.cs");
  assert.deepEqual(designer(repo.facts.tables), []);
  assert.deepEqual(designer(repo.facts.snapshotTables), []);
  assert.deepEqual(designer(repo.facts.defaultSchemas), []);
});

test("positions are offsets into Plumb's text: a BOM counts, and \\r\\n line ends don't move a line", () => {
  const repo = main();
  for (const file of ["api/Common/Bom.cs", "api/Common/Crlf.cs"]) {
    const source = sourceOf(repo, file);
    const named = refsOf(repo, file).filter((use) => use.written !== "none");
    assert.deepEqual(named.map((use) => source.slice(use.start, use.end)), ["Entry", "IEntryPort"]);
    for (const use of named) assert.equal(use.line, lineAt(source, use.start), `${file}: ${source.slice(use.start, use.end)}`);
  }
  assert.equal(sourceOf(repo, "api/Common/Bom.cs").charCodeAt(0), 0xfeff);
  assert.equal(refsOf(repo, "api/Common/Bom.cs").find((use) => use.written !== "none").line, 5);
  assert.equal(refsOf(repo, "api/Common/Crlf.cs").find((use) => use.written !== "none").line, 5);
  // A BOM file's usings and parts are shifted the same way.
  const [using] = repo.facts.usings(repo.context.file("api/Common/Bom.cs"));
  assert.equal(sourceOf(repo, "api/Common/Bom.cs").slice(using.start, using.start + 5), "using");
});

// The tool opens a passed project's whole reference closure and skips a passed project an earlier one opened, so the projects
// are handed referrers first: `top` references `mid`, which references `lib`, and path order would open each alone and again.
const referrers = lazy(() => repository("referrers-first", {
  "lib/Lib.csproj": project(),
  "lib/Lib.cs": "namespace Lib;\npublic class Thing { }\n",
  "mid/Mid.csproj": project('\n  <ItemGroup><ProjectReference Include="../lib/Lib.csproj" /></ItemGroup>'),
  "mid/Mid.cs": "namespace Mid;\npublic class Thing { Lib.Thing? lib; }\n",
  "other/Other.csproj": project(),
  "other/Other.cs": "namespace Other;\npublic class Thing { }\n",
  "top/Top.csproj": project('\n  <ItemGroup><ProjectReference Include="../mid/Mid.csproj" /></ItemGroup>'),
  "top/Top.cs": "namespace Top;\npublic class Thing { Mid.Thing? mid; }\n",
}));

test("a project is handed to the tool after every passed project that references it, ties by path", () => {
  const repo = referrers();
  assert.deepEqual(projectsHanded(repo.handed[0]), ["other/Other.csproj", "top/Top.csproj", "mid/Mid.csproj", "lib/Lib.csproj"]);
  assert.deepEqual(repo.diagnostics, []);
  assert.deepEqual(repo.facts.projects.map((entry) => [entry.path, entry.loaded]), [
    ["lib/Lib.csproj", true],
    ["mid/Mid.csproj", true],
    ["other/Other.csproj", true],
    ["top/Top.csproj", true],
  ]);
  // Every project's code is read, whichever project opened it.
  for (const name of ["Lib.Thing", "Mid.Thing", "Other.Thing", "Top.Thing"]) assert.ok(repo.facts.types.has(name), name);
});

test("a file under two projects' folders, compiled by both, is read once, from the nearer project", () => {
  const repo = main();
  const shared = repo.facts.types.get("App.Nested.Shared");
  // Read once, from the nearer project; the type is declared under each project that compiles the file.
  assert.deepEqual(shared.parts.map((part) => [part.assembly, part.file.path]), [["api/Api.csproj", "api/Nested/Shared.cs"], ["api/Nested/Inner.csproj", "api/Nested/Shared.cs"]]);
  // The nearer project owns it: its uses carry that project's assembly, not the outer project's.
  assert.deepEqual(refsOf(repo, "api/Nested/Shared.cs").filter((use) => use.to === "App.Nested.Other").map((use) => use.assembly), ["api/Nested/Inner.csproj"]);
});

test("a test project that redeclares a production type lists both parts, and a production use gets only its own", () => {
  const repo = main();
  const summary = repo.facts.types.get("App.Modules.Forms.Contracts.FormSummary");
  // An in-repo assembly is keyed by its project file; an outside one by its name.
  assert.deepEqual(summary.parts.map((part) => part.assembly).sort(), ["api/Api.csproj", "tests/Tests.csproj"]);
  const use = refsOf(repo, "api/Modules/Cases/Application/Qualified.cs").find((candidate) => toName(candidate) === "FormSummary");
  assert.equal(use.assembly, "api/Api.csproj");
  assert.deepEqual(repo.facts.partsOf(use).map((part) => [part.assembly, part.file.path]), [["api/Api.csproj", "api/Modules/Forms/Contracts/FormSummary.cs"]]);
  // A using whose target is a type gets its parts the same way.
  const alias = repo.facts.usings(repo.context.file("api/Modules/Cases/Application/Imported.cs"))[1];
  assert.deepEqual(repo.facts.partsOf(alias).map((part) => part.assembly), ["api/Api.csproj"]);
  assert.deepEqual(repo.facts.partsOf({ to: "System.String", assembly: "System.Runtime" }), []);
});

// A linking project declares the file's types from its own compilation: its defines decide which branch of an #if it
// compiles, its frameworks name the parts, and its code has to compile. Its usings, references, and tables are the owner's.
const linking = (file, extra = "") => project(`\n  <ItemGroup><Compile Include="../p1/Shared/${file}" /></ItemGroup>${extra}`);
const linkedFiles = lazy(() => repository("linked-file", {
  "p1/P1.csproj": project(),
  "p1/Shared/Dto.cs": "using System.Collections.Generic;\n\nnamespace P1.Shared;\n\npublic class Dto { public List<Item> Items { get; } = new(); }\n\npublic class Item { }\n\n#if LINKED\npublic class LinkedOnly { }\n#else\npublic class OwnerOnly { }\n#endif\n",
  "p2/P2.csproj": linking("Dto.cs", "\n  <PropertyGroup><DefineConstants>$(DefineConstants);LINKED</DefineConstants></PropertyGroup>"),
  "p2/Use.cs": "namespace P2;\n\npublic class Use { public System.Type Of() => typeof(P1.Shared.Dto); public System.Type Linked() => typeof(P1.Shared.LinkedOnly); }\n",
  // Compiles in P1 and not under P3's define; P3 owns no file of its own.
  "p1/Shared/Broken.cs": "namespace P1.Shared;\n\npublic class Broken\n{\n#if P3\n    int x = ;\n#endif\n}\n",
  "p3/P3.csproj": linking("Broken.cs", "\n  <PropertyGroup><DefineConstants>$(DefineConstants);P3</DefineConstants></PropertyGroup>"),
  // P4 targets two frameworks and links a file P1 owns; it declares Pick under each.
  "p1/Shared/Pick.cs": "namespace P1.Shared;\n\n#if NET10_0_OR_GREATER\npublic record Pick(int A);\n#else\npublic class Pick { }\n#endif\n",
  "p4/P4.csproj": `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFrameworks>net10.0;net9.0</TargetFrameworks>
    <ImplicitUsings>enable</ImplicitUsings>
  </PropertyGroup>
  <ItemGroup><Compile Include="../p1/Shared/Pick.cs" /></ItemGroup>
</Project>
`,
  // The tool is handed a project because a .cs file sits below it, so P3 and P4, which own none, are opened as P5's references.
  "p5/P5.csproj": project('\n  <ItemGroup><ProjectReference Include="../p3/P3.csproj" /><ProjectReference Include="../p4/P4.csproj" /><ProjectReference Include="../p7/P7.csproj" /></ItemGroup>'),
  "p5/Use.cs": "namespace P5;\n\npublic class Use { }\n",
  // P6 owns Ok.cs and doesn't compile (Bad.cs); P7, which compiles, links Ok.cs.
  "p6/P6.csproj": project(),
  "p6/Ok.cs": "namespace P6;\n\npublic class Ok { }\n",
  "p6/Bad.cs": "namespace P6;\n\npublic class Bad { int x = ; }\n",
  "p7/P7.csproj": project('\n  <ItemGroup><Compile Include="../p6/Ok.cs" /></ItemGroup>'),
}, { restore: ["p1", "p2", "p3", "p4", "p5", "p6", "p7"] }));

test("a file another project links is declared in that project too, from its own defines, and its usings and references stay once", () => {
  const repo = linkedFiles();
  const use = refsOf(repo, "p2/Use.cs").find((candidate) => candidate.to === "P1.Shared.Dto");
  assert.equal(use.assembly, "p2/P2.csproj");
  assert.deepEqual(repo.facts.partsOf(use).map((part) => [part.assembly, part.file.path]), [["p2/P2.csproj", "p1/Shared/Dto.cs"]]);
  assert.deepEqual(repo.facts.types.get("P1.Shared.Dto").parts.map((part) => part.assembly).sort(), ["p1/P1.csproj", "p2/P2.csproj"]);
  // P2 defines LINKED, so it compiles the other #if branch than the owner: each type has the parts of the projects that compile it.
  const assembliesOf = (name) => repo.facts.types.get(name).parts.map((part) => part.assembly);
  assert.deepEqual(assembliesOf("P1.Shared.LinkedOnly"), ["p2/P2.csproj"]);
  assert.deepEqual(assembliesOf("P1.Shared.OwnerOnly"), ["p1/P1.csproj"]);
  const linked = refsOf(repo, "p2/Use.cs").find((candidate) => candidate.to === "P1.Shared.LinkedOnly");
  assert.deepEqual(repo.facts.partsOf(linked).map((part) => [part.assembly, part.file.path]), [["p2/P2.csproj", "p1/Shared/Dto.cs"]]);
  const dto = repo.context.file("p1/Shared/Dto.cs");
  assert.equal(repo.facts.usings(dto).length, 1);
  // The file's uses of Item come from the chosen project only, not repeated per project.
  assert.deepEqual([...new Set(refsOf(repo, "p1/Shared/Dto.cs").filter((candidate) => toName(candidate) === "Item").map((candidate) => candidate.assembly))], ["p1/P1.csproj"]);
});

test("a project that links a file and owns none is compiled and checked: if it doesn't compile, it gives no parts", () => {
  const repo = linkedFiles();
  const entry = entryOf(repo, "p3/P3.csproj");
  assert.equal(entry.loaded, false);
  assert.match(entry.messages.join("\n"), /^does not compile: p1\/Shared\/Broken\.cs:6 CS/);
  assert.ok(repo.diagnostics.some((line) => line.startsWith("plumb: C# facts incomplete for p3/P3.csproj: does not compile: ")));
  // The owner compiles it, so it keeps its part; P3 has none.
  assert.deepEqual(repo.facts.types.get("P1.Shared.Broken").parts.map((part) => part.assembly), ["p1/P1.csproj"]);
});

test("a linker's declarations of a file are dropped with the owner's when the owner doesn't compile, so no file is half described", () => {
  const repo = linkedFiles();
  assert.equal(entryOf(repo, "p6/P6.csproj").loaded, false);
  assert.equal(entryOf(repo, "p7/P7.csproj").loaded, true);
  // P7 compiles Ok.cs, but the owner's facts of it are gone, so P7 has no part of it either.
  assert.equal(repo.facts.types.has("P6.Ok"), false);
  assert.equal(repo.facts.hasFacts("p6/Ok.cs"), false);
});

test("a multi-target project that links a file declares it under its own frameworks and spans", () => {
  const repo = linkedFiles();
  assert.deepEqual(entryOf(repo, "p4/P4.csproj").messages, []);
  const source = sourceOf(repo, "p1/Shared/Pick.cs");
  const parts = repo.facts.types.get("P1.Shared.Pick").parts.map((part) => [part.assembly, part.frameworks, source.slice(part.start, part.end)]);
  // The owner is single-target and lists none; P4's parts are one per framework's branch, each listing its framework.
  assert.deepEqual(parts, [
    ["p1/P1.csproj", [], "record Pick(int A);"],
    ["p4/P4.csproj", ["P4(net10.0)"], "record Pick(int A);"],
    ["p4/P4.csproj", ["P4(net9.0)"], "class Pick { }"],
  ]);
});

// A use at file level, in top-level statements or an assembly attribute, is from no type.
const fileLevel = lazy(() => repository("file-level", {
  "Exe.csproj": project("\n  <PropertyGroup><OutputType>Exe</OutputType></PropertyGroup>"),
  "Thing.cs": "namespace Lib;\n\npublic class Thing { public object Mark() => new MarkerAttribute(); }\n",
  "Marker.cs": "namespace Lib;\n\npublic sealed class MarkerAttribute : System.Attribute { }\n",
  "Assembly.cs": "[assembly: Lib.Marker]\n",
  "Program.cs": "var made = new Lib.Thing();\nmade.Mark();\n",
}));

test("a use at file level has no `from` type or member, and the same use inside a type has both", () => {
  const repo = fileLevel();
  complete(repo, "Exe.csproj", ["Thing.cs", "Marker.cs", "Assembly.cs", "Program.cs"]);
  const shape = (file, name) => [...new Set(refsOf(repo, file).filter((use) => use.to === name).map((use) => JSON.stringify([use.from, use.fromMember])))];
  assert.deepEqual(shape("Program.cs", "Lib.Thing"), ["[null,null]"]);
  assert.deepEqual(shape("Assembly.cs", "Lib.MarkerAttribute"), ["[null,null]"]);
  assert.deepEqual(shape("Thing.cs", "Lib.MarkerAttribute"), ['["Lib.Thing","Mark"]']);
});

test("a file outside the inventory keeps its facts, with its path and no line", () => {
  const repo = main();
  const hidden = repo.facts.references("api/Ignored/Hidden.cs");
  assert.equal(hidden.length, 1);
  assert.equal(hidden[0].to, "App.Modules.Ledger.Contracts.Entry");
  assert.ok(hidden.every((use) => use.line === null));
  // A file the inventory doesn't hold is described by its path, its name, and its directory.
  assert.ok(hidden.every((use) => use.file.path === "api/Ignored/Hidden.cs" && use.file.name === "Hidden.cs" && use.file.directory === "api/Ignored"));
  assert.deepEqual({ ...repo.facts.types.get("App.Hidden.Secret").parts[0].file }, { path: "api/Ignored/Hidden.cs", name: "Hidden.cs", directory: "api/Ignored" });
  assert.equal(repo.facts.hasFacts("api/Ignored/Hidden.cs"), true);
  assert.equal(repo.facts.types.get("App.Hidden.Secret").parts[0].line, null);
  assert.equal(repo.facts.displayName("App.Wire.Page`1"), "App.Wire.Page");
});

const webFiles = {
  "web/Web.csproj": project("", "Microsoft.NET.Sdk.Web", "disable"),
  "web/GlobalUsings.cs": "global using Microsoft.Extensions.Logging;\n",
  "web/Svc.cs": "namespace Web;\npublic sealed class Svc { private ILogger? log; private System.Guid id; private System.IServiceProvider? sp; }\n",
  "web/Http.cs": "namespace Web;\npublic sealed class Http { Microsoft.AspNetCore.Http.HttpContext? c; Microsoft.AspNetCore.Mvc.Infrastructure.IActionContextAccessor? a; }\n",
  "web/Stub.cs": "namespace Microsoft.EntityFrameworkCore.Migrations { public abstract class Migration { } }\n",
  "web/Mig.cs": "namespace Web;\npublic sealed class M : Microsoft.EntityFrameworkCore.Migrations.Migration { Microsoft.AspNetCore.Http.HttpContext? c; }\n",
};
const web = lazy(() => repository("web", webFiles));
const webSegments = lazy(() => repository("web-segments", webFiles, { runtime: { prefixes: [], segments: ["Infrastructure"] } }));
const outside = (repo) => repo.context.files.filter((file) => file.path.endsWith(".cs")).flatMap((file) => refsOf(repo, file.path).filter((use) => use.external).map((use) => [file.path, toName(use), use.namespace, use.written]));

test("an outside type is recorded for an external prefix, however it came into scope, and nothing else is", () => {
  const repo = web();
  assert.deepEqual(repo.diagnostics, []);
  // `ILogger` comes in through a global using in another file; `Guid`, written in the same file, gives no use. The
  // stub migration's own HttpContext is not recorded, and the same use outside it is.
  assert.deepEqual(outside(repo), [
    ["web/Http.cs", "HttpContext", "Microsoft.AspNetCore.Http", "qualified"],
    ["web/Http.cs", "IActionContextAccessor", "Microsoft.AspNetCore.Mvc.Infrastructure", "qualified"],
    ["web/Svc.cs", "ILogger", "Microsoft.Extensions.Logging", "imported"],
    // A prefix that is a whole type name: `System.IServiceProvider` equals its prefix.
    ["web/Svc.cs", "IServiceProvider", "System", "qualified"],
  ]);
  // An outside assembly is keyed by its name.
  assert.equal(refsOf(repo, "web/Svc.cs").find((use) => use.to === "Microsoft.Extensions.Logging.ILogger").assembly, "Microsoft.Extensions.Logging.Abstractions");
});

test("an in-source use is recorded inside migrations code, with external false and the type's own namespace", () => {
  const repo = web();
  const migration = refsOf(repo, "web/Mig.cs");
  assert.deepEqual(migration.map((use) => [toName(use), use.external, use.namespace]), [["Migration", false, "Microsoft.EntityFrameworkCore.Migrations"]]);
});

test("an external segment alone records an outside type with that segment in its name", () => {
  const repo = webSegments();
  assert.deepEqual(outside(repo), [["web/Http.cs", "IActionContextAccessor", "Microsoft.AspNetCore.Mvc.Infrastructure", "qualified"]]);
});

const failFiles = {
  "p/P.csproj": project(`\n  <ItemGroup><ProjectReference Include="../x/Util/Util.csproj" /><ProjectReference Include="../y/Util/Util.csproj" /></ItemGroup>`),
  "p/P.cs": "namespace P;\npublic class PClass { }\n",
  "x/Util/Util.csproj": project(),
  "x/Util/Util.cs": "namespace X;\npublic class XUtil { }\n",
  "y/Util/Util.csproj": project(),
  "y/Util/Util.cs": "namespace Y;\npublic class YUtil { }\n",
  // A restored opener whose referenced project file is deleted after the restore.
  "op/Op.csproj": project(`\n  <ItemGroup><ProjectReference Include="../gone/Gone.csproj" /></ItemGroup>`),
  "op/Op.cs": "namespace Op;\npublic class OpClass { }\n",
  "gone/Gone.csproj": project(),
  // The same one level down: a/A.csproj -> lib/b/B.csproj -> ../nope/Nope.csproj, which is lib/nope/ from B and nope/ from A.
  "a/A.csproj": project(`\n  <ItemGroup><ProjectReference Include="../lib/b/B.csproj" /></ItemGroup>`),
  "a/A.cs": "namespace A;\npublic class AClass { }\n",
  "lib/b/B.csproj": project(`\n  <ItemGroup><ProjectReference Include="../nope/Nope.csproj" /></ItemGroup>`),
  "lib/b/B.cs": "namespace B;\npublic class BClass { }\n",
  "lib/nope/Nope.csproj": project(),
  // The same, where B turns the missing reference's warning (MSB9008) into an error: B's own build then fails.
  "pa/A.csproj": project(`\n  <ItemGroup><ProjectReference Include="../plib/b/B.csproj" /></ItemGroup>`),
  "pa/A.cs": "namespace Pa;\npublic class PaClass { }\n",
  "plib/b/B.csproj": project(`\n  <PropertyGroup><MSBuildWarningsAsErrors>MSB9008</MSBuildWarningsAsErrors></PropertyGroup>\n  <ItemGroup><ProjectReference Include="../nope/Nope.csproj" /></ItemGroup>`),
  "plib/b/B.cs": "namespace Plib;\npublic class PlibClass { }\n",
  "plib/nope/Nope.csproj": project(),
};
const failing = lazy(() => repository("failing", failFiles, {
  restore: ["p", "x", "y", "op", "a", "pa"],
  after(root) {
    fs.rmSync(path.join(root, "gone", "Gone.csproj"));
    fs.rmSync(path.join(root, "lib", "nope", "Nope.csproj"));
    fs.rmSync(path.join(root, "plib", "nope", "Nope.csproj"));
    write(root, {
      "v/V.csproj": '<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup><TargetFramework>net10.0</TargetFramework>\n',
      "v/V.cs": "namespace V;\npublic class VClass { }\n",
    });
  },
}));

test("two referenced projects with one project name both load, each with its own facts", () => {
  const repo = failing();
  const entry = (name) => repo.facts.projects.find((candidate) => candidate.path === name);
  for (const name of ["x/Util/Util.csproj", "y/Util/Util.csproj", "p/P.csproj"]) {
    assert.deepEqual([entry(name).loaded, entry(name).messages], [true, []], name);
  }
  assert.equal(repo.facts.hasFacts(repo.context.file("x/Util/Util.cs")), true);
  assert.equal(repo.facts.hasFacts(repo.context.file("y/Util/Util.cs")), true);
  assert.ok(repo.facts.types.has("X.XUtil"));
  assert.ok(repo.facts.types.has("Y.YUtil"));
  assert.ok(!repo.diagnostics.some((line) => line.includes("Util.csproj")));
});

test("a project that fails to load is loaded false with its message, its files have no facts, and the run is degraded", () => {
  const repo = failing();
  const entry = repo.facts.projects.find((candidate) => candidate.path === "v/V.csproj");
  assert.equal(entry.loaded, false);
  assert.match(entry.messages[0], /The project file could not be loaded/);
  assert.equal(repo.facts.hasFacts(repo.context.file("v/V.cs")), false);
  assert.deepEqual(repo.facts.references(repo.context.file("v/V.cs")), []);
  assert.ok(repo.diagnostics.some((line) => line.startsWith("plumb: C# facts incomplete for v/V.csproj: ") && line.includes("The project file could not be loaded")));
});

test("a failing project reference is attributed to the referenced project, which wasn't passed, and not to the project that opened it", () => {
  const repo = failing();
  assert.ok(!projectsHanded(repo.handed[0]).includes("gone/Gone.csproj"));
  const missing = repo.facts.projects.find((candidate) => candidate.path === "gone/Gone.csproj");
  assert.equal(missing.loaded, false);
  assert.ok(missing.messages.some((message) => message.includes("Gone.csproj")));
  const opener = repo.facts.projects.find((candidate) => candidate.path === "op/Op.csproj");
  assert.equal(opener.loaded, true);
  assert.deepEqual(opener.messages, []);
  assert.equal(repo.facts.hasFacts(repo.context.file("op/Op.cs")), true);
  assert.ok(repo.diagnostics.some((line) => line.startsWith("plumb: C# facts incomplete for gone/Gone.csproj: ")));
  assert.ok(!repo.diagnostics.some((line) => line.includes("for op/Op.csproj")));
});

test("a missing reference whose warning B promotes to an error fails B too, and the missing project by the name B wrote", () => {
  const repo = failing();
  const entry = (name) => repo.facts.projects.find((candidate) => candidate.path === name);
  // B's MSB9008 arrives as an error naming `../nope/Nope.csproj`: from B's folder that is plib/nope/, from A's it would be nope/.
  assert.equal(entry("plib/nope/Nope.csproj").loaded, false);
  assert.equal(entry("nope/Nope.csproj"), undefined);
  assert.equal(entry("plib/b/B.csproj").loaded, false);
  assert.match(entry("plib/b/B.csproj").messages[0], /^Msbuild failed when processing the file '.*plib\/b\/B\.csproj' with message: .*\.\.\/nope\/Nope\.csproj.*does not exist/);
  assert.equal(entry("pa/A.csproj").loaded, true);
  assert.deepEqual(entry("pa/A.csproj").messages, []);
  assert.equal(repo.facts.hasFacts(repo.context.file("pa/A.cs")), true);
  assert.equal(repo.facts.hasFacts(repo.context.file("plib/b/B.cs")), false);
});

test("a missing reference two levels down is the missing project's, resolved from the project that wrote it", () => {
  const repo = failing();
  const entry = (name) => repo.facts.projects.find((candidate) => candidate.path === name);
  // B wrote `../nope/Nope.csproj` from lib/b/, so it is lib/nope/; resolved from A it would be nope/.
  assert.equal(entry("lib/nope/Nope.csproj").loaded, false);
  assert.equal(entry("nope/Nope.csproj"), undefined);
  assert.equal(entry("a/A.csproj").loaded, true);
  assert.deepEqual(entry("a/A.csproj").messages, []);
  assert.equal(entry("lib/b/B.csproj").loaded, true);
  assert.deepEqual(entry("lib/b/B.csproj").messages, []);
  assert.equal(repo.facts.hasFacts(repo.context.file("a/A.cs")), true);
  assert.equal(repo.facts.hasFacts(repo.context.file("lib/b/B.cs")), true);
  assert.ok(repo.diagnostics.some((line) => line.startsWith("plumb: C# facts incomplete for lib/nope/Nope.csproj: ")));
  assert.deepEqual(repo.diagnostics.filter((line) => line.includes("for a/A.csproj") || line.includes("for lib/b/B.csproj")), []);
});

// Restore: an unrestored project opens with no error, and the tool reports it and reads none of its files.
const locator = "Microsoft.Build.Locator";
const withLocator = (extra = "") => project(`\n  <ItemGroup><PackageReference Include="${locator}" Version="1.11.2" /></ItemGroup>${extra}`);
const usesLocator = (namespace) => `namespace ${namespace};\npublic class Uses { public System.Type Kind() => typeof(${locator}.MSBuildLocator); }\n`;
const tfm = (frameworks) => `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFrameworks>${frameworks}</TargetFrameworks>
    <ImplicitUsings>enable</ImplicitUsings>
  </PropertyGroup>
</Project>
`;
const restoreFiles = {
  "ok/Ok.csproj": project(),
  "ok/Ok.cs": "namespace Ok;\npublic class OkClass { }\n",
  "a/A.csproj": project(),
  "a/A.cs": "namespace A;\npublic class AClass { }\n",
  "pk/Pk.csproj": withLocator(),
  "pk/Pk.cs": usesLocator("Pk"),
  "pkr/Pkr.csproj": withLocator(),
  "pkr/Pkr.cs": usesLocator("Pkr"),
  "tf/Tf.csproj": tfm("net10.0;net9.0"),
  "tf/Tf.cs": "namespace Tf;\npublic class TfClass { }\n",
  "tfr/Tfr.csproj": tfm("net10.0;net9.0"),
  "tfr/Tfr.cs": "namespace Tfr;\npublic class TfrClass { }\n",
  "tf1/Tf1.csproj": tfm("net10.0"),
  "tf1/Tf1.cs": "namespace Tf1;\npublic class Tf1Class { }\n",
  "imp/Imp.csproj": project('\n  <Import Project="missing.props" />'),
  "imp/Imp.cs": "namespace Imp;\npublic class ImpClass { }\n",
  "rsp/R.csproj": project(),
  "rsp/R.cs": "namespace R;\npublic class RClass { }\n",
};
// The restored project's package use is recorded with its namespace, because a prefix asks for it.
const unrestored = lazy(() => repository("unrestored", restoreFiles, {
  restore: ["ok", "pkr", "rsp", "tfr"],
  // A Directory.Build.rsp holding `-bl` beside a project: the evaluation must not read it, or it writes a binlog.
  after: (root) => write(root, { "rsp/Directory.Build.rsp": "-bl\n" }),
  runtime: { prefixes: [...EXTERNAL_PREFIXES, locator] },
}));
const entryOf = (repo, name) => repo.facts.projects.find((candidate) => candidate.path === name);

test("an unrestored project is loaded false with where its restore output should be, whatever it references, and its files have no facts", () => {
  const repo = unrestored();
  for (const [name, file] of [["a/A.csproj", "a/A.cs"], ["pk/Pk.csproj", "pk/Pk.cs"], ["tf/Tf.csproj", "tf/Tf.cs"], ["tf1/Tf1.csproj", "tf1/Tf1.cs"]]) {
    const message = `not restored: ${name.replace(/[^/]*$/, "")}obj/project.assets.json is missing (run dotnet restore)`;
    assert.deepEqual([entryOf(repo, name).loaded, entryOf(repo, name).messages], [false, [message]], name);
    assert.equal(repo.facts.hasFacts(repo.context.file(file)), false, file);
    assert.deepEqual(refsOf(repo, file), [], file);
    assert.ok(repo.diagnostics.includes(`plumb: C# facts incomplete for ${name}: ${message}`), name);
  }
  assert.ok(![...repo.facts.types.keys()].some((name) => /^(A|Pk|Tf|Tf1)\./.test(name)));
});

test("a restored project loads, and the restore is what makes its package's types bind", () => {
  const repo = unrestored();
  for (const name of ["ok/Ok.csproj", "pkr/Pkr.csproj", "rsp/R.csproj", "tfr/Tfr.csproj"]) assert.deepEqual([entryOf(repo, name).loaded, entryOf(repo, name).messages], [true, []], name);
  // A restored project with two target frameworks opens as both, and is no failure; a type both compile is one part.
  assert.equal(repo.facts.types.get("Tfr.TfrClass").parts.length, 1);
  assert.equal(repo.facts.hasFacts(repo.context.file("pkr/Pkr.cs")), true);
  const use = refsOf(repo, "pkr/Pkr.cs").find((candidate) => candidate.to === `${locator}.MSBuildLocator`);
  assert.deepEqual([use.external, use.namespace, use.written], [true, locator, "qualified"]);
  // The same package used from a project that was never restored gives no use: its files have no facts at all.
  assert.deepEqual(refsOf(repo, "pk/Pk.cs"), []);
});

test("a project whose evaluation fails is loaded false with MSBuild's own error, found by running the evaluation again", () => {
  const repo = unrestored();
  const entry = entryOf(repo, "imp/Imp.csproj");
  assert.equal(entry.loaded, false);
  assert.equal(entry.messages.length, 1);
  assert.match(entry.messages[0], /^evaluation failed: .*MSB4019.*missing\.props/);
  assert.equal(repo.facts.hasFacts(repo.context.file("imp/Imp.cs")), false);
  assert.ok(repo.diagnostics.some((line) => line.startsWith("plumb: C# facts incomplete for imp/Imp.csproj: evaluation failed: ")));
});

test("a Directory.Build.rsp holding -bl is not read", () => {
  const repo = unrestored();
  assert.ok(fs.existsSync(path.join(repo.root, "rsp", "Directory.Build.rsp")));
  const binlogs = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(directory, entry.name));
      else if (entry.name === "msbuild.binlog") binlogs.push(path.relative(repo.root, path.join(directory, entry.name)));
    }
  };
  walk(path.join(repo.root, "rsp"));
  assert.deepEqual(binlogs, []);
  assert.deepEqual(entryOf(repo, "rsp/R.csproj").messages, []);
});

const nearestFiles = {
  "outer/Outer.csproj": project(),
  "outer/Plain.cs": "namespace Outer;\npublic class Plain { }\n",
  // Compiled by Outer too (its default globs reach down), but nearer to Unres, which is never restored, and to Bad.
  "outer/Unres/Unres.csproj": project(),
  "outer/Unres/Shared.cs": "namespace Outer.Unres;\npublic class Shared { }\n",
  "outer/Bad/BadFile.cs": "namespace Outer.Bad;\npublic class BadFile { }\n",
  // A loaded project referencing an unrestored one.
  "ref/Ref.csproj": project('\n  <ItemGroup><ProjectReference Include="../dep/Dep.csproj" /></ItemGroup>'),
  "ref/Ref.cs": "namespace Ref;\npublic class RefClass { Dep.DepClass? d; }\n",
  "dep/Dep.csproj": project(),
  "dep/Dep.cs": "namespace Dep;\npublic class DepClass { }\n",
};
const nearest = lazy(() => repository("nearest", nearestFiles, {
  restore: ["outer", "ref"],
  after(root) {
    fs.rmSync(path.join(root, "outer", "Unres", "obj"), { recursive: true });
    fs.rmSync(path.join(root, "dep", "obj"), { recursive: true });
    write(root, { "outer/Bad/Bad.csproj": '<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n' });
  },
}));

test("a file whose nearest project is loaded false gets no facts, though a loaded outer project compiles it too", () => {
  const repo = nearest();
  assert.equal(entryOf(repo, "outer/Outer.csproj").loaded, true);
  assert.equal(entryOf(repo, "outer/Unres/Unres.csproj").loaded, false);
  assert.equal(entryOf(repo, "outer/Bad/Bad.csproj").loaded, false);
  // Unres is restorable but not restored, Bad never opened: both are nearer than Outer.
  assert.equal(repo.facts.hasFacts(repo.context.file("outer/Unres/Shared.cs")), false);
  assert.equal(repo.facts.hasFacts(repo.context.file("outer/Bad/BadFile.cs")), false);
  assert.equal(repo.facts.hasFacts(repo.context.file("outer/Plain.cs")), true);
  assert.ok(repo.facts.types.has("Outer.Plain"));
  assert.ok(!repo.facts.types.has("Outer.Unres.Shared"));
  assert.ok(!repo.facts.types.has("Outer.Bad.BadFile"));
  assert.ok(repo.diagnostics.some((line) => line.startsWith("plumb: C# facts incomplete for outer/Unres/Unres.csproj: not restored: ")));
  assert.ok(repo.diagnostics.some((line) => line.startsWith("plumb: C# facts incomplete for outer/Bad/Bad.csproj: ")));
});

test("a loaded project's use of a type declared in an unrestored project has no parts, and the unrestored project is reported", () => {
  const repo = nearest();
  assert.equal(entryOf(repo, "ref/Ref.csproj").loaded, true);
  assert.deepEqual(entryOf(repo, "dep/Dep.csproj").messages, ["not restored: dep/obj/project.assets.json is missing (run dotnet restore)"]);
  const use = refsOf(repo, "ref/Ref.cs").find((candidate) => candidate.to === "Dep.DepClass");
  assert.ok(use);
  assert.deepEqual(repo.facts.partsOf(use), []);
  assert.ok(!repo.facts.types.has("Dep.DepClass"));
  assert.ok(repo.diagnostics.includes("plumb: C# facts incomplete for dep/Dep.csproj: not restored: dep/obj/project.assets.json is missing (run dotnet restore)"));
});

// Build messages: the workspace reports every message of a project's MSBuild log as a failure, whatever its severity, so
// the tool reads the build's own binary log to tell a warning (which fails nothing) from an error (which fails its project).
const raising = (task) => project(`\n  <Target Name="Probe" BeforeTargets="ResolveAssemblyReferences">\n    ${task}\n  </Target>`);
const classOf = (namespace) => `namespace ${namespace};\npublic class First { Second? other; }\npublic class Second { }\n`;
const buildFiles = {
  "wa/Wa.csproj": raising('<Warning Text="a build warning" Code="PRB001" />'),
  "wa/Wa.cs": classOf("Wa"),
  "wb/Wb.csproj": raising('<Warning Text=" " Code="PRB002" />'),
  "wb/Wb.cs": classOf("Wb"),
  "er/Er.csproj": raising('<Error Text="a build error" Code="PRB003" />'),
  "er/Er.cs": classOf("Er"),
  "both/Both.csproj": raising('<Warning Text="twice" Code="PRB004" />\n    <Error Text="twice" Code="PRB005" />'),
  "both/Both.cs": classOf("Both"),
  // One closure: the opener, a project that warns, and one whose error has the same text.
  "c/C.csproj": project('\n  <ItemGroup><ProjectReference Include="../w/W.csproj" /><ProjectReference Include="../x/X.csproj" /></ItemGroup>'),
  "c/C.cs": classOf("C"),
  "w/W.csproj": raising('<Warning Text="shared text" Code="PRB006" />'),
  "w/W.cs": classOf("W"),
  "x/X.csproj": raising('<Error Text="shared text" Code="PRB007" />'),
  "x/X.cs": classOf("X"),
};
const building = lazy(() => repository("building", buildFiles));
const buildEntry = (repo, name) => repo.facts.projects.find((candidate) => candidate.path === name);

test("a build warning is no failure to load: the project stays loaded, with its types and references", () => {
  const repo = building();
  for (const [name, file, type] of [["wa/Wa.csproj", "wa/Wa.cs", "Wa"], ["wb/Wb.csproj", "wb/Wb.cs", "Wb"]]) {
    assert.deepEqual([buildEntry(repo, name).loaded, buildEntry(repo, name).messages], [true, []], name);
    assert.equal(repo.facts.hasFacts(repo.context.file(file)), true, file);
    assert.equal(repo.facts.types.get(`${type}.First`).parts.length, 1);
    assert.deepEqual(refsOf(repo, file).filter((use) => use.written !== "none").map((use) => use.to), [`${type}.Second`]);
    assert.ok(!repo.diagnostics.some((line) => line.includes(`for ${name}`)), name);
  }
});

test("a build error fails its project, with the error's text", () => {
  const repo = building();
  const entry = buildEntry(repo, "er/Er.csproj");
  assert.equal(entry.loaded, false);
  assert.equal(entry.messages.length, 1);
  assert.match(entry.messages[0], /^Msbuild failed when processing the file '.*er\/Er\.csproj' with message: a build error$/);
  assert.equal(repo.facts.hasFacts(repo.context.file("er/Er.cs")), false);
  assert.ok(repo.diagnostics.some((line) => line.startsWith("plumb: C# facts incomplete for er/Er.csproj: Msbuild failed when processing the file")));
});

test("a text raised as both a warning and an error fails its project", () => {
  const repo = building();
  const entry = buildEntry(repo, "both/Both.csproj");
  assert.equal(entry.loaded, false);
  assert.match(entry.messages[0], /with message: twice$/);
  assert.equal(repo.facts.hasFacts(repo.context.file("both/Both.cs")), false);
});

test("in one closure, a project's warning is dropped and another project's error of the same text is not", () => {
  const repo = building();
  assert.deepEqual([buildEntry(repo, "w/W.csproj").loaded, buildEntry(repo, "w/W.csproj").messages], [true, []]);
  assert.deepEqual([buildEntry(repo, "c/C.csproj").loaded, buildEntry(repo, "c/C.csproj").messages], [true, []]);
  assert.equal(buildEntry(repo, "x/X.csproj").loaded, false);
  assert.match(buildEntry(repo, "x/X.csproj").messages[0], /x\/X\.csproj' with message: shared text$/);
  assert.equal(repo.facts.hasFacts(repo.context.file("w/W.cs")), true);
  assert.equal(repo.facts.hasFacts(repo.context.file("c/C.cs")), true);
  assert.equal(repo.facts.hasFacts(repo.context.file("x/X.cs")), false);
});

// Compile errors: the compiler's own errors decide whether a project's facts are complete. A project whose code doesn't
// compile as the tool loaded it is loaded false with the first error in its message, gives no facts, and degrades the run,
// whatever left a name unbound.
const refused = (repo, name, files, message) => {
  const entry = entryOf(repo, name);
  assert.equal(entry.loaded, false, name);
  assert.equal(entry.messages.length, 1, name);
  assert.match(entry.messages[0], message, name);
  assert.ok(repo.diagnostics.some((line) => line.startsWith(`plumb: C# facts incomplete for ${name}: does not compile: `)), name);
  for (const file of files) {
    assert.equal(repo.facts.hasFacts(file), false, file);
    assert.deepEqual(repo.facts.references(file), [], file);
  }
};
const complete = (repo, name, files) => {
  assert.deepEqual([entryOf(repo, name).loaded, entryOf(repo, name).messages], [true, []], name);
  for (const file of files) assert.equal(repo.facts.hasFacts(file), true, file);
};
const buildProject = (file) => {
  const result = spawnSync("dotnet", ["build", file, "--nologo"], { encoding: "utf8" });
  if (result.error || result.status !== 0) throw new Error(`dotnet build failed for ${file}: ${result.error?.message ?? ""}${result.stdout ?? ""}${result.stderr ?? ""}`);
};
// Every .cs file on disk under a folder of the repository, as the inventory spells them.
const csharpUnder = (repo, folder) => {
  const found = [];
  const walk = (directory) => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".cs")) found.push(path.relative(repo.root, full).split(path.sep).join("/"));
    }
  };
  walk(path.join(repo.root, folder));
  return found.sort();
};
const partsUnder = (repo, folder) => [...repo.facts.types.values()].flatMap((type) => type.parts).filter((part) => part.file.path.startsWith(`${folder}/`));

// A package added after the restore: a name from it that code uses is unbound, and nothing says so but the compiler.
const stale = lazy(() => repository("stale-restore", {
  "app/App.csproj": project(),
  "app/Ok.cs": "namespace StaleApp;\npublic class Ok { }\n",
  "unused/Unused.csproj": project(),
  "unused/Unused.cs": "namespace Unused;\npublic class UnusedClass { }\n",
}, {
  after: (root) => write(root, {
    "app/App.csproj": withLocator(),
    "app/Uses.cs": usesLocator("StaleApp"),
    "unused/Unused.csproj": withLocator(),
  }),
}));

test("a restore that is out of date fails a project that uses a name from the new package, with the compiler's error", () => {
  const repo = stale();
  refused(repo, "app/App.csproj", ["app/Ok.cs", "app/Uses.cs"], /^does not compile: .*CS0234/);
  assert.ok(![...repo.facts.types.keys()].some((name) => name.startsWith("StaleApp.")));
});

test("a restore that is out of date, with no code naming the new package, leaves the project loaded with its facts", () => {
  const repo = stale();
  complete(repo, "unused/Unused.csproj", ["unused/Unused.cs"]);
  assert.ok(repo.facts.types.has("Unused.UnusedClass"));
});

// A <Reference> whose file is gone, and an <Analyzer> whose file is gone: MSBuild says nothing, and the compiler says CS0246.
const missingReference = lazy(() => repository("missing-reference", {
  "ref/Ref.csproj": project('\n  <ItemGroup><Reference Include="Gone.Library"><HintPath>libs/Gone.Library.dll</HintPath></Reference></ItemGroup>'),
  "ref/Uses.cs": "namespace Ref;\npublic sealed class Uses\n{\n    public object Bound() => typeof(string);\n    public object Unbound() => typeof(Gone.Library.Thing);\n}\n",
  "refunused/RefUnused.csproj": project('\n  <ItemGroup><Reference Include="Gone.Library"><HintPath>libs/Gone.Library.dll</HintPath></Reference></ItemGroup>'),
  "refunused/Code.cs": "namespace RefUnused;\npublic sealed class Code { }\n",
}));

test("a <Reference> whose HintPath file is missing fails a project that names a type from it", () => {
  const repo = missingReference();
  refused(repo, "ref/Ref.csproj", ["ref/Uses.cs"], /^does not compile: ref\/Uses\.cs:5 CS0246/);
  assert.ok(!repo.facts.types.has("Ref.Uses"));
});

test("the same missing <Reference> with no code naming it leaves the project loaded", () => {
  const repo = missingReference();
  complete(repo, "refunused/RefUnused.csproj", ["refunused/Code.cs"]);
  assert.ok(repo.facts.types.has("RefUnused.Code"));
});

test("an <Analyzer> whose file is missing fails a project that names a type it would generate", () => {
  const repo = repository("missing-analyzer", {
    "an/An.csproj": project('\n  <ItemGroup><Analyzer Include="libs/Gone.Generator.dll" /></ItemGroup>'),
    "an/Code.cs": "namespace AnCode;\npublic sealed class Code { public object T() => typeof(Generated.Thing); }\n",
  });
  refused(repo, "an/An.csproj", ["an/Code.cs"], /^does not compile: an\/Code\.cs:2 CS0246/);
});

// A diagnostic a project promoted to an error is no unbound name: its own real build may fail on it, and the facts are whole.
test("a warning promoted to an error by TreatWarningsAsErrors leaves the project loaded", () => {
  const repo = repository("promoted-warning", {
    "twae/Twae.csproj": project("\n  <PropertyGroup><TreatWarningsAsErrors>true</TreatWarningsAsErrors></PropertyGroup>"),
    "twae/Warn.cs": "#warning a promoted warning says nothing about a name that doesn't bind\nnamespace Twae;\npublic sealed class Warn { }\n",
  });
  complete(repo, "twae/Twae.csproj", ["twae/Warn.cs"]);
  assert.ok(repo.facts.types.has("Twae.Warn"));
});

test("a hidden diagnostic an .editorconfig raises to an error leaves the project loaded", () => {
  const repo = repository("promoted-severity", {
    ".editorconfig": "root = true\n\n[*.cs]\ndotnet_diagnostic.CS8019.severity = error\n",
    "sev/Sev.csproj": project("\n  <PropertyGroup><GenerateDocumentationFile>true</GenerateDocumentationFile><NoWarn>$(NoWarn);CS1591</NoWarn></PropertyGroup>"),
    "sev/Code.cs": "using System.Text;\n\nnamespace SevCode;\n\npublic sealed class Thing { }\n",
  });
  complete(repo, "sev/Sev.csproj", ["sev/Code.cs"]);
  assert.ok(repo.facts.types.has("SevCode.Thing"));
});

// What a build writes is not source. A target's file in the intermediate or output folder is generated; one in obj/ itself
// is read, as a build step's file in the project folder is.
const generatedFolders = lazy(() => repository("generated-folders", {
  "App/App.csproj": `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup>
  <Target Name="WriteGen" BeforeTargets="BeforeCompile;CoreCompile">
    <MakeDir Directories="$(OutDir);$(BaseIntermediateOutputPath);$(IntermediateOutputPath)" />
    <WriteLinesToFile File="$(IntermediateOutputPath)InInt.g.cs" Lines="namespace App { public class InInt { } }" Overwrite="true" />
    <WriteLinesToFile File="$(BaseIntermediateOutputPath)InObj.g.cs" Lines="namespace App { public class InObj { } }" Overwrite="true" />
    <WriteLinesToFile File="$(OutDir)InBin.g.cs" Lines="namespace App { public class InBin { } }" Overwrite="true" />
    <ItemGroup>
      <Compile Include="$(IntermediateOutputPath)InInt.g.cs" />
      <Compile Include="$(BaseIntermediateOutputPath)InObj.g.cs" />
      <Compile Include="$(OutDir)InBin.g.cs" />
    </ItemGroup>
  </Target>
</Project>
`,
  "App/Uses.cs": "namespace App;\npublic class Uses { public InInt? I; public InObj? A; public InBin? B; }\n",
}));

test("a file a target writes in the intermediate or output folder is not source, and one in obj/ itself is", () => {
  const repo = generatedFolders();
  complete(repo, "App/App.csproj", ["App/Uses.cs"]);
  const intermediate = "App/obj/Debug/net10.0/InInt.g.cs";
  const output = "App/bin/Debug/net10.0/InBin.g.cs";
  assert.ok(fs.existsSync(path.join(repo.root, intermediate)) && fs.existsSync(path.join(repo.root, output)));
  assert.equal(repo.facts.hasFacts(intermediate), false);
  assert.equal(repo.facts.hasFacts(output), false);
  assert.equal(repo.facts.hasFacts("App/obj/InObj.g.cs"), true);
  assert.deepEqual(refsOf(repo, "App/Uses.cs").map((use) => use.to), ["App.InObj"]);
  assert.deepEqual([...repo.facts.types.keys()].filter((name) => /^App\.In/.test(name)), ["App.InObj"]);
});

// A file the repository holds, in a folder a project builds into, is the repository's own however it got there.
const heldFiles = {
  "inthand/App/App.csproj": project("\n  <PropertyGroup><IntermediateOutputPath>gen/</IntermediateOutputPath><AppendTargetFrameworkToOutputPath>false</AppendTargetFrameworkToOutputPath></PropertyGroup>\n  <ItemGroup><Compile Include=\"gen/Hand.cs\" /></ItemGroup>"),
  "inthand/App/Use.cs": "namespace InHand;\npublic class Use { public object T => new Hand(); }\n",
  "inthand/App/gen/Hand.cs": "namespace InHand;\npublic class Hand : System.IDisposable { public void Dispose() { } }\n",
  "inthandign/App/App.csproj": project("\n  <PropertyGroup><IntermediateOutputPath>gen/</IntermediateOutputPath><AppendTargetFrameworkToOutputPath>false</AppendTargetFrameworkToOutputPath></PropertyGroup>\n  <ItemGroup><Compile Include=\"gen/Hand.cs\" /></ItemGroup>"),
  "inthandign/App/Use.cs": "namespace InHandIgn;\npublic class Use { public object T => new Hand(); }\n",
  "inthandign/App/gen/Hand.cs": "namespace InHandIgn;\npublic class Hand : System.IDisposable { public void Dispose() { } }\n",
  "guard/App/App.csproj": project("\n  <PropertyGroup><IntermediateOutputPath>$(MSBuildProjectDirectory)/</IntermediateOutputPath><AppendTargetFrameworkToOutputPath>false</AppendTargetFrameworkToOutputPath><EnableDefaultCompileItems>false</EnableDefaultCompileItems></PropertyGroup>\n  <ItemGroup><Compile Include=\"Hand.cs\" /></ItemGroup>"),
  "guard/App/Hand.cs": "namespace Guard;\npublic class Hand { public Other? O; }\npublic class Other { }\n",
  "sharedint/A/A.csproj": project("\n  <PropertyGroup><IntermediateOutputPath>../shared/</IntermediateOutputPath><AppendTargetFrameworkToOutputPath>false</AppendTargetFrameworkToOutputPath></PropertyGroup>"),
  "sharedint/A/UseA.cs": "namespace SharedA;\npublic class UseA { }\n",
  "sharedint/B/B.csproj": project('\n  <ItemGroup><Compile Include="../shared/Info.cs" /></ItemGroup>'),
  "sharedint/B/UseB.cs": "namespace SharedB;\npublic class UseB { public string N => Shared.Info.Name; }\n",
  "sharedint/shared/Info.cs": 'namespace Shared;\npublic static class Info { public const string Name = "x"; }\n',
  "sharedb/A/A.csproj": project('\n  <PropertyGroup><OutputPath>../build/</OutputPath><AppendTargetFrameworkToOutputPath>false</AppendTargetFrameworkToOutputPath></PropertyGroup>\n  <ItemGroup><Compile Include="../build/Info.cs" /></ItemGroup>'),
  "sharedb/A/UseA.cs": "namespace BuildA;\npublic class UseA { public string N = BuildShared.Info.Name; }\n",
  "sharedb/build/Info.cs": 'namespace BuildShared;\npublic static class Info { public const string Name = "x"; }\n',
};
const held = lazy(() => repository("held", heldFiles, { outOfScope: ["inthandign/App/gen/Hand.cs"] }));

// Each guards against the skip emptying a project with no word: the file and its type are there. MSBuild's own files can
// read as documents in these folders too, so nothing is asserted about them.
test("a hand-written file in the intermediate folder, which the project compiles by name, is read", () => {
  const repo = held();
  complete(repo, "inthand/App/App.csproj", ["inthand/App/Use.cs", "inthand/App/gen/Hand.cs"]);
  assert.ok(repo.facts.types.has("InHand.Hand"));
});

test("that file out of the run's scope, as the inventory still holds it, is read too", () => {
  const repo = held();
  assert.equal(repo.context.file("inthandign/App/gen/Hand.cs"), undefined);
  complete(repo, "inthandign/App/App.csproj", ["inthandign/App/Use.cs", "inthandign/App/gen/Hand.cs"]);
  assert.ok(repo.facts.types.has("InHandIgn.Hand"));
});

test("a project whose intermediate folder is its own, with a hand-written file in it, still reads that file", () => {
  const repo = held();
  complete(repo, "guard/App/App.csproj", ["guard/App/Hand.cs"]);
  assert.ok(repo.facts.types.has("Guard.Hand") && repo.facts.types.has("Guard.Other"));
});

test("a file a sibling project's intermediate folder is, compiled by another project, is read", () => {
  const repo = held();
  complete(repo, "sharedint/A/A.csproj", ["sharedint/A/UseA.cs"]);
  complete(repo, "sharedint/B/B.csproj", ["sharedint/B/UseB.cs", "sharedint/shared/Info.cs"]);
  assert.ok(repo.facts.types.has("Shared.Info"));
});

test("a hand-written file in a folder a project's OutputPath names is read", () => {
  const repo = held();
  complete(repo, "sharedb/A/A.csproj", ["sharedb/A/UseA.cs", "sharedb/build/Info.cs"]);
  assert.ok(repo.facts.types.has("BuildShared.Info"));
});

// A compiler-generated tree: EmitCompilerGeneratedFiles names its folder with MSBuild's backslash off Windows.
const generatorProject = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>netstandard2.0</TargetFramework>
    <LangVersion>latest</LangVersion>
    <IsRoslynComponent>true</IsRoslynComponent>
    <EnforceExtendedAnalyzerRules>true</EnforceExtendedAnalyzerRules>
    <NoWarn>$(NoWarn);RS1035;RS2008</NoWarn>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.CodeAnalysis.CSharp" Version="5.9.0" PrivateAssets="all" />
  </ItemGroup>
</Project>
`;
const generator = `using Microsoft.CodeAnalysis;

namespace Gen
{
    [Generator]
    public sealed class ThingGenerator : IIncrementalGenerator
    {
        public void Initialize(IncrementalGeneratorInitializationContext context)
        {
            context.RegisterPostInitializationOutput(output =>
                output.AddSource("Thing.g.cs", "namespace Generated { public sealed class Thing { } }"));
        }
    }
}
`;
const usesGenerated = (namespace) => `namespace ${namespace};\n\npublic sealed class Uses\n{\n    public System.Type Kind() => typeof(Generated.Thing);\n}\n`;
const generatorRepository = (name, extra, built) => {
  const root = path.join(scratch, name);
  return repository(name, {
    "gen/Gen.csproj": generatorProject,
    "gen/ThingGenerator.cs": generator,
    "app/App.csproj": project('\n  <ItemGroup><ProjectReference Include="../gen/Gen.csproj" OutputItemType="Analyzer" ReferenceOutputAssembly="false" /></ItemGroup>'),
    "app/Uses.cs": usesGenerated("AppCode"),
    ...extra(root),
  }, { after: (at) => { if (built) buildProject(path.join(at, "gen", "Gen.csproj")); } });
};
const generatorUnbuilt = lazy(() => generatorRepository("generator-unbuilt", () => ({}), false));
const generatorBuilt = lazy(() => generatorRepository("generator-built", (root) => ({
  "emit/Emit.csproj": project(`\n  <PropertyGroup><EmitCompilerGeneratedFiles>true</EmitCompilerGeneratedFiles></PropertyGroup>\n  <ItemGroup><Analyzer Include="${root}/gen/bin/Debug/netstandard2.0/Gen.dll" /></ItemGroup>`),
  "emit/Uses.cs": usesGenerated("EmitCode"),
}), true));

test("an in-repo generator that hasn't been built leaves the names it generates unbound, and the project fails", () => {
  const repo = generatorUnbuilt();
  refused(repo, "app/App.csproj", ["app/Uses.cs"], /^does not compile: app\/Uses\.cs:5 CS0246/);
  assert.equal(entryOf(repo, "gen/Gen.csproj").loaded, true);
});

test("once the generator is built, the project that references it loads, and its generated name binds", () => {
  const repo = generatorBuilt();
  // The type the generator emits isn't under a source file, so no use of it is recorded.
  complete(repo, "app/App.csproj", ["app/Uses.cs"]);
});

test("a generator's trees, named with a backslash by EmitCompilerGeneratedFiles, give no reference to what they declare", () => {
  const repo = generatorBuilt();
  complete(repo, "emit/Emit.csproj", ["emit/Uses.cs"]);
  assert.ok(!refsOf(repo, "emit/Uses.cs").some((use) => use.to === "Generated.Thing"));
});

// Two projects with one assembly name are two assemblies: each is keyed by its project file, so a use of a name both declare
// gets only the parts of the project it binds to.
test("two projects with one assembly name that declare one type name keep their own parts, and a use gets its own project's", () => {
  const repo = repository("one-assembly-name", {
    "a/Api/Api.csproj": project(),
    "a/Api/Order.cs": "namespace Api.Contracts;\n\npublic class Order { public string? A { get; set; } }\n\npublic class UsesA { private Order? order; }\n",
    "b/Api/Api.csproj": project(),
    "b/Api/Order.cs": "namespace Api.Contracts;\n\npublic class Order { public string? B { get; set; } }\n\npublic class UsesB { private Order? order; }\n",
  });
  complete(repo, "a/Api/Api.csproj", ["a/Api/Order.cs"]);
  complete(repo, "b/Api/Api.csproj", ["b/Api/Order.cs"]);
  const order = repo.facts.types.get("Api.Contracts.Order");
  assert.deepEqual(order.parts.map((part) => [part.assembly, part.file.path]).sort(), [["a/Api/Api.csproj", "a/Api/Order.cs"], ["b/Api/Api.csproj", "b/Api/Order.cs"]]);
  for (const side of ["a", "b"]) {
    const use = refsOf(repo, `${side}/Api/Order.cs`).find((candidate) => candidate.to === "Api.Contracts.Order");
    assert.deepEqual(repo.facts.partsOf(use).map((part) => part.file.path), [`${side}/Api/Order.cs`], side);
  }
});

// A file-local type is its own type: its name carries the compiler's file marker, so it never shares an entry, a part, or a
// use with a public type of the same name, or with another file's file-local type of that name.
const namesake = lazy(() => repository("namesake", {
  "Lib.csproj": project(),
  "A.cs": "namespace N;\n\nfile class Foo { public class Inner { } }\n\npublic class UsesFile { private object Make() => new Foo(); }\n",
  "B.cs": "namespace N;\n\npublic class Foo { }\n",
  "C.cs": "namespace N;\n\npublic class UsesPublic { private object Make() => new Foo(); }\n",
  "D.cs": "namespace N;\n\nfile class Twin { }\n\npublic class UsesD { private object Make() => new Twin(); }\n",
  "E.cs": "namespace N;\n\nfile class Twin { }\n\npublic class UsesE { private object Make() => new Twin(); }\n",
  "G.cs": "namespace N;\n\nfile class Gen<T> { }\n",
}));
const namedAs = (repo, display) => [...repo.facts.types.values()].filter((entry) => repo.facts.displayName(entry.name) === display);

test("a file-local class beside a public class of the same name in one project is its own type, and a use binds to the one in scope", () => {
  const repo = namesake();
  complete(repo, "Lib.csproj", ["A.cs", "B.cs", "C.cs", "D.cs", "E.cs", "G.cs"]);
  const paths = (parts) => parts.map((part) => part.file.path);
  const entries = namedAs(repo, "N.Foo");
  assert.equal(entries.length, 2);
  const publicType = repo.facts.types.get("N.Foo");
  assert.deepEqual([publicType.access, paths(publicType.parts), isFileLocalName(publicType.name)], ["public", ["B.cs"], false]);
  const fileLocal = entries.find((entry) => isFileLocalName(entry.name));
  assert.deepEqual([fileLocal.access, paths(fileLocal.parts), fileLocal.namespace], ["file", ["A.cs"], "N"]);
  assert.notEqual(fileLocal.name, "N.Foo");
  // A.cs's `new Foo()` is the file-local type, and C.cs's is the public one.
  const useInA = refsOf(repo, "A.cs").find((use) => repo.facts.displayName(use.to) === "N.Foo");
  assert.equal(useInA.to, fileLocal.name);
  assert.deepEqual(paths(repo.facts.partsOf(useInA)), ["A.cs"]);
  const useInC = refsOf(repo, "C.cs").find((use) => repo.facts.displayName(use.to) === "N.Foo");
  assert.equal(useInC.to, "N.Foo");
  assert.deepEqual(paths(repo.facts.partsOf(useInC)), ["B.cs"]);
  // The marker is the compiler's, so it differs by checkout and never reaches a message: displayName drops it.
  assert.equal(repo.facts.displayName(fileLocal.name), "N.Foo");
  assert.ok(!repo.facts.displayName(fileLocal.name).includes("__"));
  assert.equal(useInA.from, "N.UsesFile");
});

test("two file-local classes of one name in two files of one project are two types", () => {
  const repo = namesake();
  const twins = namedAs(repo, "N.Twin");
  assert.equal(twins.length, 2);
  assert.ok(twins.every((entry) => isFileLocalName(entry.name) && entry.access === "file" && entry.parts.length === 1));
  assert.notEqual(twins[0].name, twins[1].name);
  assert.deepEqual(twins.map((entry) => entry.parts[0].file.path).sort(), ["D.cs", "E.cs"]);
  for (const [file, path] of [["D.cs", "D.cs"], ["E.cs", "E.cs"]]) {
    const use = refsOf(repo, file).find((candidate) => repo.facts.displayName(candidate.to) === "N.Twin");
    assert.deepEqual(repo.facts.partsOf(use).map((part) => part.file.path), [path]);
  }
});

test("a type nested in a file-local type is the file-local type's name and a dot, and a generic file-local type loses its arity in displayName", () => {
  const repo = namesake();
  const fileLocal = namedAs(repo, "N.Foo").find((entry) => isFileLocalName(entry.name));
  const inner = namedAs(repo, "N.Foo.Inner");
  assert.equal(inner.length, 1);
  assert.equal(inner[0].name, `${fileLocal.name}.Inner`);
  assert.equal(inner[0].containing, fileLocal.name);
  assert.equal(isFileLocalName(inner[0].name), true);
  const generic = namedAs(repo, "N.Gen");
  assert.equal(generic.length, 1);
  assert.match(generic[0].name, /__Gen`1$/);
  assert.equal(isFileLocalName(generic[0].name), true);
  // Plain names, with or without an arity, are not file-local.
  assert.deepEqual(["N.Foo", "N.Box`1", "A.F.Gen", "N.<A>FX__Foo"].map(isFileLocalName), [false, false, false, false]);
  assert.equal(isFileLocalName("N.<A>F0123456789ABCDEF__Foo.Inner"), true);
  assert.equal(repo.facts.displayName("N.<My_Odd_Name>F0123456789ABCDEF__Gen`1.Inner"), "N.Gen.Inner");
});

// Compile errors in general.
const errors = lazy(() => repository("compile-errors", {
  // Four distinct errors, each raised under both frameworks: the least is by file, line, id, then message.
  "least/Least.csproj": tfm("net10.0;net9.0"),
  "least/Alpha.cs": "namespace Least;\npublic class Alpha { Zulu z; Aardvark a; }\npublic class Beta { Yak y; }\n",
  "least/Zed.cs": "namespace Least;\npublic class Zed { Nowhere n; }\n",
  // A loaded project that uses a type of a project that doesn't compile.
  "broken/Broken.csproj": project(),
  "broken/Broken.cs": "namespace Broken;\npublic class BrokenClass { Gone.Thing? g; }\n",
  "user/User.csproj": project('\n  <ItemGroup><ProjectReference Include="../broken/Broken.csproj" /></ItemGroup>'),
  "user/User.cs": "namespace User;\npublic class UserClass { Broken.BrokenClass? b; }\n",
  // A file the run's scope leaves out is still compiled into its project.
  "ign/Ign.csproj": project(),
  "ign/Ok.cs": "namespace Ign;\npublic class Ok { }\n",
  "ign/Vendored.cs": "namespace Ign;\npublic class Vendored { Gone.Thing? t; }\n",
  // An error that only one framework raises.
  "fw/Fw.csproj": tfm("net10.0;net9.0"),
  "fw/Fw.cs": "namespace Fw;\npublic class Fine { }\n#if NET9_0\npublic class Uses { public object T() => typeof(Gone.Thing); }\n#endif\n",
}, { outOfScope: ["ign/Vendored.cs"] }));

test("the message names the least error by file, line, id, and message, and counts the rest once, though two frameworks raise each", () => {
  const repo = errors();
  refused(repo, "least/Least.csproj", ["least/Alpha.cs", "least/Zed.cs"], /^does not compile: least\/Alpha\.cs:2 CS0246: The type or namespace name 'Aardvark' could not be found \(are you missing a using directive or an assembly reference\?\) \(and 3 more\)\. Run dotnet build/);
});

test("the does-not-compile message points at a README heading that exists", () => {
  const [message] = entryOf(errors(), "least/Least.csproj").messages;
  const heading = message.match(/see (.+) in Plumb's README$/)?.[1];
  assert.ok(heading, message);
  const readme = fs.readFileSync(new URL("../README.md", import.meta.url), "utf8");
  assert.ok(readme.split("\n").some((line) => /^#{2,6} /.test(line) && line.replace(/^#+ /, "") === heading), `README has no heading "${heading}"`);
});

test("a loaded project's use of a type in a project that doesn't compile has no parts, and the broken project is reported", () => {
  const repo = errors();
  assert.equal(entryOf(repo, "user/User.csproj").loaded, true);
  refused(repo, "broken/Broken.csproj", ["broken/Broken.cs"], /^does not compile: broken\/Broken\.cs:2 CS0246/);
  const use = refsOf(repo, "user/User.cs").find((candidate) => candidate.to === "Broken.BrokenClass");
  assert.ok(use);
  assert.deepEqual(repo.facts.partsOf(use), []);
  assert.ok(!repo.facts.types.has("Broken.BrokenClass"));
});

test("a file the run's scope leaves out, which doesn't compile, still fails its project", () => {
  const repo = errors();
  assert.equal(repo.context.file("ign/Vendored.cs"), undefined);
  refused(repo, "ign/Ign.csproj", ["ign/Ok.cs", "ign/Vendored.cs"], /^does not compile: ign\/Vendored\.cs:2 CS0246/);
});

test("an error that only one framework raises fails the project's one entry, and the other framework's facts go with it", () => {
  const repo = errors();
  refused(repo, "fw/Fw.csproj", ["fw/Fw.cs"], /^does not compile: fw\/Fw\.cs:4 CS0246/);
  assert.ok(!repo.facts.types.has("Fw.Fine"));
});

// A project with several target frameworks is read under each, and its facts are the union.
const frameworks = lazy(() => repository("frameworks", {
  "b/B.csproj": `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFrameworks>net10.0;net9.0</TargetFrameworks>
    <ImplicitUsings>disable</ImplicitUsings>
  </PropertyGroup>
  <ItemGroup Condition="'$(TargetFramework)' == 'net9.0'">
    <Using Include="B.NineOnlyNamespace" />
    <Compile Remove="OnlyTen.cs" />
  </ItemGroup>
  <ItemGroup Condition="'$(TargetFramework)' == 'net10.0'">
    <Using Include="B.TenOnlyNamespace" />
    <Compile Remove="OnlyNine.cs" />
  </ItemGroup>
</Project>
`,
  "b/Both.cs": `namespace B;

public sealed class Both { }

[System.ComponentModel.DataAnnotations.Schema.Table("both")]
public sealed class BothRow { }

public sealed class Holds { public Both? Held; public BothRow? Row; }

#if NET9_0
public sealed class IfNine { }
#endif

#if NET10_0
public sealed class IfTen { }
#endif
`,
  "b/OnlyNine.cs": `namespace B.NineOnlyNamespace
{
    public sealed class NineThing { }
}

namespace B
{
    public sealed class OnlyNineFile
    {
        // Binds only through the global using this framework alone declares.
        public NineThing Thing => new NineThing();
    }
}
`,
  "b/OnlyTen.cs": `namespace B.TenOnlyNamespace
{
    public sealed class TenThing { }
}

namespace B
{
    public sealed class OnlyTenFile
    {
        // Binds only through the global using this framework alone declares.
        public TenThing Thing => new TenThing();
    }
}
`,
  // The shapes of mainFiles: a mapping, a migrations snapshot, and a default schema, each compiled by both frameworks.
  "b/Stubs/EfCore.cs": `using System;\n${mainFiles["api/Stubs/EfCore.cs"]}`,
  "b/Data.cs": `using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
namespace B;
public class MappedRow { }
public sealed class Mapping
{
    public void Configure(EntityTypeBuilder<MappedRow> builder) { builder.ToTable("mapped"); }
}
public sealed class Context : DbContext
{
    protected void OnModelCreating(ModelBuilder modelBuilder) { modelBuilder.HasDefaultSchema("app"); }
}
public sealed class AppSnapshot : ModelSnapshot
{
    public void Build(ModelBuilder modelBuilder) { modelBuilder.Entity("B.MappedRow", b => b.ToTable("mapped")); }
}
`,
  "nine/Nine.csproj": '<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <TargetFramework>net9.0</TargetFramework>\n    <ImplicitUsings>disable</ImplicitUsings>\n  </PropertyGroup>\n  <ItemGroup><ProjectReference Include="../b/B.csproj" /></ItemGroup>\n</Project>\n',
  "nine/Nine.cs": "namespace Nine;\npublic sealed class UsesNine\n{\n    public object A() => typeof(B.Both);\n    public object C() => typeof(B.IfNine);\n    public object D() => typeof(B.OnlyNineFile);\n}\n",
  "ten/Ten.csproj": '<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <TargetFramework>net10.0</TargetFramework>\n    <ImplicitUsings>disable</ImplicitUsings>\n  </PropertyGroup>\n  <ItemGroup><ProjectReference Include="../b/B.csproj" /></ItemGroup>\n</Project>\n',
  "ten/Ten.cs": "namespace Ten;\npublic sealed class UsesTen\n{\n    public object A() => typeof(B.Both);\n    public object C() => typeof(B.IfTen);\n    public object D() => typeof(B.OnlyTenFile);\n}\n",
}));

test("a project with two target frameworks gives every type of both, and each project that references it binds to the right framework", () => {
  const repo = frameworks();
  assert.deepEqual(repo.diagnostics, []);
  for (const name of ["b/B.csproj", "nine/Nine.csproj", "ten/Ten.csproj"]) assert.deepEqual([entryOf(repo, name).loaded, entryOf(repo, name).messages], [true, []], name);
  for (const name of ["B.IfNine", "B.IfTen", "B.OnlyNineFile", "B.OnlyTenFile"]) assert.equal(repo.facts.types.get(name)?.parts.length, 1, name);
  // `typeof(B.IfNine)` binds only to the net9.0 build of B, and `typeof(B.IfTen)` only to the net10.0 one.
  const bound = (file, type) => repo.facts.partsOf(refsOf(repo, file).find((use) => use.to === type));
  assert.equal(bound("nine/Nine.cs", "B.IfNine").length, 1);
  assert.equal(bound("ten/Ten.cs", "B.IfTen").length, 1);
});

test("a file both frameworks compile is one set of facts: one part, and each use once", () => {
  const repo = frameworks();
  assert.equal(repo.facts.hasFacts("b/Both.cs"), true);
  assert.equal(repo.facts.types.get("B.Both").parts.length, 1);
  assert.deepEqual(refsOf(repo, "b/Both.cs").map((use) => [use.to, use.written, use.from]), [
    ["B.Both", "enclosing", "B.Holds"],
    ["B.BothRow", "enclosing", "B.Holds"],
  ]);
});

test("an alias both frameworks compile is one using, with its arguments once", () => {
  const repo = repository("frameworkalias", {
    "m/M.csproj": `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFrameworks>net10.0;net9.0</TargetFrameworks>
    <ImplicitUsings>enable</ImplicitUsings>
  </PropertyGroup>
</Project>
`,
    "m/Aliases.cs": `using Bag = System.Collections.Generic.List<M.Thing>;
namespace M;
public sealed class Thing { }
public sealed class Holds { public Bag? Held; }
`,
  });
  const usings = repo.facts.usings(repo.context.file("m/Aliases.cs"));
  assert.deepEqual(usings.map((using) => using.alias), ["Bag"]);
  assert.deepEqual(usings[0].arguments, [{ type: "M.Thing", assembly: "m/M.csproj" }]);
});

test("each framework compiles its own generated global usings, so a name only one of them declares binds", () => {
  const repo = frameworks();
  assert.ok(refsOf(repo, "b/OnlyNine.cs").some((use) => use.to === "B.NineOnlyNamespace.NineThing"));
  assert.ok(refsOf(repo, "b/OnlyTen.cs").some((use) => use.to === "B.TenOnlyNamespace.TenThing"));
});

test("what each framework's build generated in the project's obj folder is not source", () => {
  const repo = frameworks();
  const generated = csharpUnder(repo, "b/obj");
  // Both frameworks' generated global usings are there to be skipped.
  assert.ok(generated.some((file) => file.includes("/net10.0/")) && generated.some((file) => file.includes("/net9.0/")));
  for (const file of generated) assert.equal(repo.facts.hasFacts(file), false, file);
  assert.deepEqual(partsUnder(repo, "b/obj"), []);
});

test("a table mapping, a migrations snapshot, a default schema, and a [Table] class that both frameworks compile are each one row", () => {
  const repo = frameworks();
  const inB = (list) => list.filter((entry) => entry.file.path.startsWith("b/"));
  assert.deepEqual(inB(repo.facts.tables).map((table) => [table.file.path, table.method, table.schema, table.table]), [
    ["b/Both.cs", "Table", null, "both"],
    ["b/Data.cs", "ToTable", null, "mapped"],
  ]);
  assert.deepEqual(inB(repo.facts.snapshotTables).map((table) => [table.file.path, table.entity, table.method, table.table]), [["b/Data.cs", "B.MappedRow", "ToTable", "mapped"]]);
  assert.deepEqual(inB(repo.facts.defaultSchemas).map((entry) => [entry.file.path, entry.schema]), [["b/Data.cs", "app"]]);
});

// A framework type binds to System.Runtime under net10.0 and to netstandard under netstandard2.0, and it is still one use.
test("a framework type that binds to a different assembly under each framework is one using and one reference", () => {
  const repo = repository("assemblies", {
    "lib/Lib.csproj": '<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <TargetFrameworks>net10.0;netstandard2.0</TargetFrameworks>\n    <LangVersion>latest</LangVersion>\n  </PropertyGroup>\n</Project>\n',
    "lib/Code.cs": "using static System.Math;\nusing Providers = System.Collections.Generic.IEnumerable<System.IServiceProvider>;\n\nnamespace LibCode\n{\n    public sealed class Uses\n    {\n        public System.Threading.Tasks.Task Run(System.IServiceProvider provider) => System.Threading.Tasks.Task.FromResult(Abs(-1));\n    }\n}\n",
  });
  complete(repo, "lib/Lib.csproj", ["lib/Code.cs"]);
  const usings = repo.facts.usings("lib/Code.cs");
  assert.deepEqual(usings.filter((using) => !using.alias).map((using) => using.target), ["System.Math"]);
  // An outside argument is one row too, though it binds to a different assembly under each framework.
  assert.deepEqual(usings.filter((using) => using.alias === "Providers").map((using) => using.arguments.map((argument) => argument.type)), [["System.IServiceProvider"]]);
  assert.deepEqual(refsOf(repo, "lib/Code.cs").filter((use) => use.external).map((use) => use.to), ["System.IServiceProvider"]);
});

// An in-repo type's assembly is its project file, the same under every framework, so a name that binds to a different project
// under each framework is two uses; only an outside type's assembly is left out of the identity (the test above).
test("an in-repo type that binds to a different project under each framework is two usings and two references", () => {
  const library = (name, framework) => `<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <TargetFramework>${framework}</TargetFramework>\n  </PropertyGroup>\n</Project>\n`;
  const polyfill = (name) => `namespace Shim;\n\npublic static class Polyfill\n{\n    public static int ${name}() => 1;\n}\n`;
  const thing = "namespace Shim;\n\npublic sealed class Thing { }\n";
  const repo = repository("bindings", {
    "ten/Ten.csproj": library("Ten", "net10.0"),
    "ten/Polyfill.cs": polyfill("Ten"),
    "ten/Thing.cs": thing,
    "nine/Nine.csproj": library("Nine", "net9.0"),
    "nine/Polyfill.cs": polyfill("Nine"),
    "nine/Thing.cs": thing,
    "app/App.csproj": `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFrameworks>net10.0;net9.0</TargetFrameworks>
  </PropertyGroup>
  <ItemGroup Condition="'$(TargetFramework)' == 'net10.0'">
    <ProjectReference Include="../ten/Ten.csproj" />
  </ItemGroup>
  <ItemGroup Condition="'$(TargetFramework)' == 'net9.0'">
    <ProjectReference Include="../nine/Nine.csproj" />
  </ItemGroup>
</Project>
`,
    "app/Shared.cs": "using static Shim.Polyfill;\nusing Things = System.Collections.Generic.List<Shim.Thing>;\n\nnamespace AppCode;\n\npublic sealed class Shared\n{\n    public System.Type Kind => typeof(Shim.Polyfill);\n}\n",
  }, { restore: ["ten", "nine", "app"] });
  complete(repo, "app/App.csproj", ["app/Shared.cs"]);
  const usings = repo.facts.usings("app/Shared.cs").filter((using) => using.target === "Shim.Polyfill");
  assert.deepEqual(usings.map((using) => using.assembly).sort(), ["nine/Nine.csproj", "ten/Ten.csproj"]);
  const uses = refsOf(repo, "app/Shared.cs").filter((use) => use.to === "Shim.Polyfill");
  assert.deepEqual(uses.map((use) => use.assembly).sort(), ["nine/Nine.csproj", "ten/Ten.csproj"]);
  for (const use of [...usings, ...uses]) {
    assert.deepEqual(repo.facts.partsOf(use).map((part) => [part.assembly, part.file.path]), [[use.assembly, `${use.assembly.split("/")[0]}/Polyfill.cs`]]);
  }
  // The arguments are the union over the frameworks, the first framework's first: each binds Shim.Thing to its own project.
  assert.deepEqual(
    repo.facts.usings("app/Shared.cs").filter((using) => using.alias === "Things").map((using) => using.arguments),
    [[{ type: "Shim.Thing", assembly: "ten/Ten.csproj" }, { type: "Shim.Thing", assembly: "nine/Nine.csproj" }]],
  );
});

// A type's bases and access can differ by framework: it has all its bases, and is as visible as its widest.
const unions = lazy(() => repository("unions", {
  "merge/Merge.csproj": `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFrameworks>net10.0;net9.0</TargetFrameworks>
  </PropertyGroup>
  <ItemGroup Condition="'$(TargetFramework)' == 'net9.0'">
    <Compile Remove="Split.Ten.cs" />
  </ItemGroup>
  <ItemGroup Condition="'$(TargetFramework)' == 'net10.0'">
    <Compile Remove="Split.Nine.cs" />
  </ItemGroup>
</Project>
`,
  "merge/Bases.cs": `namespace MergeCode;

public class BaseNine { }
public class BaseTen { }
public interface INine { }
public interface ITen { }

// The whole declaration line differs.
#if NET9_0
public class TwoHeads : BaseNine
#else
public class TwoHeads : BaseTen
#endif
{
}

// Only the base list differs.
public class OneHead
#if NET9_0
    : BaseNine
#else
    : BaseTen
#endif
{
}
`,
  "merge/Split.Nine.cs": "namespace MergeCode;\n\npublic partial class Split : INine { }\n",
  "merge/Split.Ten.cs": "namespace MergeCode;\n\npublic partial class Split : ITen { }\n",
  "access/Access.csproj": tfm("net10.0;net9.0"),
  "access/A.cs": `namespace AccessCode;

// Modifier alone under #if: public under the first framework, internal under the second.
#if NET9_0
internal
#else
public
#endif
class PublicFirst { }

// Modifier alone under #if: internal under the first framework, public under the second.
#if NET10_0
internal
#else
public
#endif
class InternalFirst { }

// Whole header under #if: internal under the first framework.
#if NET10_0
internal class HeadInternalFirst
#else
public class HeadInternalFirst
#endif
{
}
`,
  "nested/Nested.csproj": tfm("net10.0;net9.0"),
  "nested/A.cs": `namespace NestedCode;

public class Outer
{
    // Private under the first framework, public under the second.
#if NET10_0
    private
#else
    public
#endif
    class Modifier { }

#if NET10_0
    private class Headers
#else
    public class Headers
#endif
    {
    }
}
`,
}));

test("a type's base types are the union over the frameworks, whether #if wraps the base list, two headers, or a part for each", () => {
  const repo = unions();
  complete(repo, "merge/Merge.csproj", ["merge/Bases.cs", "merge/Split.Nine.cs", "merge/Split.Ten.cs"]);
  // The bases each type should have and doesn't, so a failure shows every type that lost one.
  const lacking = Object.fromEntries([["OneHead", ["BaseNine", "BaseTen"]], ["TwoHeads", ["BaseNine", "BaseTen"]], ["Split", ["INine", "ITen"]]]
    .map(([name, bases]) => [name, bases.filter((base) => !repo.facts.types.get(`MergeCode.${name}`).baseTypes.includes(`MergeCode.${base}`))]));
  assert.deepEqual(lacking, { OneHead: [], TwoHeads: [], Split: [] });
});

test("a type public under one framework is public, whichever of its modifier or its header #if wraps", () => {
  const repo = unions();
  complete(repo, "access/Access.csproj", ["access/A.cs"]);
  const access = (names) => Object.fromEntries(names.map((name) => [name, repo.facts.types.get(`AccessCode.${name}`).access]));
  assert.deepEqual(access(["PublicFirst", "InternalFirst", "HeadInternalFirst"]), { PublicFirst: "public", InternalFirst: "public", HeadInternalFirst: "public" });
});

test("a nested type private under one framework and public under the other is public", () => {
  const repo = unions();
  complete(repo, "nested/Nested.csproj", ["nested/A.cs"]);
  const access = (names) => Object.fromEntries(names.map((name) => [name, repo.facts.types.get(`NestedCode.Outer.${name}`).access]));
  assert.deepEqual(access(["Modifier", "Headers"]), { Modifier: "public", Headers: "public" });
});

// A part lists the frameworks that declare it, in the order the project gives them (not sorted: net9.0 comes first here).
const listed = lazy(() => repository("framework-lists", {
  "lst/Lst.csproj": `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFrameworks>net9.0;net10.0</TargetFrameworks>
  </PropertyGroup>
  <ItemGroup Condition="'$(TargetFramework)' == 'net9.0'">
    <Compile Remove="Split.Ten.cs" />
  </ItemGroup>
  <ItemGroup Condition="'$(TargetFramework)' == 'net10.0'">
    <Compile Remove="Split.Nine.cs" />
  </ItemGroup>
</Project>
`,
  "lst/Shapes.cs": `namespace Lst;

public class Both { }

#if NET9_0
public class OnlyNine { }
#endif

#if NET9_0
public class TwoHeaders { }
#else
public class TwoHeaders { }
#endif
`,
  "lst/Split.Nine.cs": "namespace Lst;\n\npublic class Split { }\n",
  "lst/Split.Ten.cs": "namespace Lst;\n\npublic class Split { }\n",
  "one/One.csproj": project(),
  "one/One.cs": "namespace One;\npublic class OnlyClass { }\n",
}));

test("a multi-target part lists the frameworks that declare it in the project's order, and a single-target part lists none", () => {
  const repo = listed();
  complete(repo, "lst/Lst.csproj", ["lst/Shapes.cs", "lst/Split.Nine.cs", "lst/Split.Ten.cs"]);
  complete(repo, "one/One.csproj", ["one/One.cs"]);
  const frameworksOf = (name) => repo.facts.types.get(name).parts.map((part) => [part.file.path, part.frameworks]);
  assert.deepEqual(frameworksOf("Lst.Both"), [["lst/Shapes.cs", ["Lst(net9.0)", "Lst(net10.0)"]]]);
  assert.deepEqual(frameworksOf("Lst.OnlyNine"), [["lst/Shapes.cs", ["Lst(net9.0)"]]]);
  // Two headers under #if are two parts, each declared by one framework; the same for a file each framework compiles.
  assert.deepEqual(frameworksOf("Lst.TwoHeaders"), [["lst/Shapes.cs", ["Lst(net9.0)"]], ["lst/Shapes.cs", ["Lst(net10.0)"]]]);
  assert.deepEqual(frameworksOf("Lst.Split"), [["lst/Split.Nine.cs", ["Lst(net9.0)"]], ["lst/Split.Ten.cs", ["Lst(net10.0)"]]]);
  assert.deepEqual(frameworksOf("One.OnlyClass"), [["one/One.cs", []]]);
});

// A name's kind, namespace, and containing type can differ by framework only on a constructed shape (#if around the header,
// or around a namespace). net10.0 is the first framework.
const differing = lazy(() => repository("framework-differences", {
  "dk/Dk.csproj": tfm("net10.0;net9.0"),
  "dk/Kinds.cs": `namespace Dk;

// A class under the first framework and an interface under the second, and the other way round.
#if NET10_0
public class ClassFirst { }
public interface InterfaceFirst { }
#else
public interface ClassFirst { }
public class InterfaceFirst { }
#endif

// A class and a record, in either order.
#if NET10_0
public class RecordSecond { }
public record RecordFirst;
#else
public record RecordSecond;
public class RecordFirst { }
#endif

// A name only one framework declares.
#if NET9_0
public class OnlyNine { }
#endif
`,
  // A file-local type and a public one of one name, in two files, that every framework holds: two types.
  "dk/Twin.File.cs": "namespace Dk;\n\nfile class Twin { }\n",
  "dk/Twin.Public.cs": "namespace Dk;\n\npublic class Twin { }\n",
  // A type nested in a file-local type and a public type that read alike once the dots are joined (`Dk.Apart.Part`): two
  // types, in every framework.
  "dk/Apart.File.cs": "namespace Dk { file class Apart { public class Part { } } }\n",
  "dk/Apart.Public.cs": "namespace Dk.Apart { public class Part { } }\n",
  "dn/Dn.csproj": tfm("net10.0;net9.0"),
  "dn/A.cs": `#if NET10_0
namespace Dn.A.B { public class C { } public class D { } }
#else
namespace Dn.A { public class B { public class C { } public class D { } } }
#endif
`,
  // A type split between two files by framework, the first framework's in the file that sorts last: the facts take the
  // first framework's namespace, containing type, and kind, not the first file's.
  "ds/Ds.csproj": `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFrameworks>net10.0;net9.0</TargetFrameworks>
  </PropertyGroup>
  <ItemGroup Condition="'$(TargetFramework)' == 'net10.0'">
    <Compile Remove="A9.cs" />
  </ItemGroup>
  <ItemGroup Condition="'$(TargetFramework)' == 'net9.0'">
    <Compile Remove="Z10.cs" />
  </ItemGroup>
</Project>
`,
  "ds/A9.cs": "namespace Ds.A.B { public record C { } public record R; }\n",
  "ds/Z10.cs": "namespace Ds.A { public class B { public class C { } } }\nnamespace Ds { public class R { } }\n",
}));

test("a name split between files by framework takes the first framework's namespace, containing type, and kind", () => {
  const repo = differing();
  const entry = entryOf(repo, "ds/Ds.csproj");
  assert.equal(entry.loaded, true);
  const type = repo.facts.types.get("Ds.A.B.C");
  assert.equal(type.namespace, "Ds.A");
  assert.equal(type.containing, "Ds.A.B");
  assert.equal(type.kind, "class");
  assert.equal(repo.facts.types.get("Ds.R").kind, "class");
});

test("a name that is a class under one framework and an interface under the other reads as an interface, in either order, with no message", () => {
  const repo = differing();
  complete(repo, "dk/Dk.csproj", ["dk/Kinds.cs", "dk/Twin.File.cs", "dk/Twin.Public.cs"]);
  const kind = (name) => repo.facts.types.get(`Dk.${name}`).kind;
  assert.deepEqual([kind("ClassFirst"), kind("InterfaceFirst")], ["interface", "interface"]);
});

test("a name that is a class under one framework and a record under the other keeps the first framework's kind, with no message", () => {
  const repo = differing();
  complete(repo, "dk/Dk.csproj", ["dk/Kinds.cs"]);
  const kind = (name) => repo.facts.types.get(`Dk.${name}`).kind;
  assert.deepEqual([kind("RecordSecond"), kind("RecordFirst")], ["class", "record"]);
});

test("a name that differs by framework in namespace or containing type keeps the project loaded and its facts, and degrades the run", () => {
  const repo = differing();
  const entry = entryOf(repo, "dn/Dn.csproj");
  assert.equal(entry.loaded, true);
  assert.deepEqual(entry.messages, ["type Dn.A.B.C has a different namespace or containing type under each target framework, and the facts hold the first framework's, so a rule can misjudge it (and 1 more)"]);
  assert.equal(repo.facts.hasFacts("dn/A.cs"), true);
  for (const name of ["Dn.A.B.C", "Dn.A.B.D"]) assert.equal(repo.facts.types.get(name)?.parts.length, 2, name);
  assert.ok(repo.diagnostics.includes(`plumb: C# facts incomplete for dn/Dn.csproj: ${entry.messages[0]}`));
});

test("a name only one framework declares, and a file-local type beside a public one of one name in every framework, give no message and stay separate types", () => {
  const repo = differing();
  complete(repo, "dk/Dk.csproj", ["dk/Kinds.cs", "dk/Twin.File.cs", "dk/Twin.Public.cs", "dk/Apart.File.cs", "dk/Apart.Public.cs"]);
  assert.equal(repo.facts.types.get("Dk.OnlyNine").parts.length, 1);
  // Each of the pairs is two types of one display name, each with its own single part, which both frameworks declare.
  for (const [display, publicFile, fileLocalFile] of [["Dk.Twin", "dk/Twin.Public.cs", "dk/Twin.File.cs"], ["Dk.Apart.Part", "dk/Apart.Public.cs", "dk/Apart.File.cs"]]) {
    const entries = namedAs(repo, display);
    assert.equal(entries.length, 2, display);
    const shape = (entry) => entry.parts.map((part) => [part.file.path, part.frameworks]);
    assert.deepEqual(shape(entries.find((entry) => !isFileLocalName(entry.name))), [[publicFile, ["Dk(net10.0)", "Dk(net9.0)"]]], display);
    assert.deepEqual(shape(entries.find((entry) => isFileLocalName(entry.name))), [[fileLocalFile, ["Dk(net10.0)", "Dk(net9.0)"]]], display);
  }
  assert.equal(repo.facts.types.get("Dk.Twin").access, "public");
  assert.ok(!repo.diagnostics.some((line) => line.includes("dk/Dk.csproj")));
});

// A project that sets its own output paths gives its frameworks one folder, and what its own build compiles is read.
test("a project with two frameworks and its own literal output and intermediate paths loads with both frameworks' types", () => {
  const repo = repository("own-paths", {
    "o/O.csproj": '<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <TargetFrameworks>net10.0;net9.0</TargetFrameworks>\n    <AppendTargetFrameworkToOutputPath>false</AppendTargetFrameworkToOutputPath>\n    <OutputPath>out/</OutputPath>\n    <IntermediateOutputPath>intermediate/</IntermediateOutputPath>\n  </PropertyGroup>\n</Project>\n',
    "o/O.cs": "namespace OwnPaths;\n\npublic sealed class Multi { }\n\n#if NET9_0\npublic sealed class IfNine { }\n#endif\n\n#if NET10_0\npublic sealed class IfTen { }\n#endif\n",
  });
  complete(repo, "o/O.csproj", ["o/O.cs"]);
  for (const name of ["Multi", "IfNine", "IfTen"]) assert.equal(repo.facts.types.get(`OwnPaths.${name}`)?.parts.length, 1, name);
  // The inventory was taken before the load wrote the intermediate folder.
  const generated = csharpUnder(repo, "o/intermediate");
  assert.ok(generated.length > 0);
  for (const file of generated) assert.equal(repo.facts.hasFacts(file), false, file);
});

// The tool's own build follows the repo's .NET tooling rules: the canonical editorconfig is held by dotnet/.editorconfig, the
// SDK is pinned, and CSharpier is in the tool manifest.
test("the facts tool is built under the canonical editorconfig, a pinned SDK, and a CSharpier manifest", () => {
  const here = (relative) => fs.readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
  const held = new Set(here("dotnet/.editorconfig").split("\n"));
  const missing = here("configs/editorconfig.dotnet").split("\n").filter((line) => line.trim() && !held.has(line));
  assert.deepEqual(missing, []);
  assert.equal(JSON.parse(here("global.json")).sdk.version.split(".")[0], "10");
  assert.ok(JSON.parse(here(".config/dotnet-tools.json")).tools.csharpier);
});

// The diagnostics, through an injected `dotnet` lookup, `run`, and tool folder over an in-memory repository.
const memoryFiles = {
  "a/A.csproj": '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>',
  "a/A.cs": "class A { }\n",
  "loose/L.cs": "class L { }\n",
};
function memory(runtime, files = memoryFiles) {
  const snapshot = createRepositorySnapshot({ root: "/repo", mode: "test", files: Object.keys(files) }, { readFile: (file) => files[path.relative("/repo", file).split(path.sep).join("/")] });
  const calls = [];
  const loaded = loadSnapshot(snapshot, { run: (...args) => { calls.push(args); return { status: 0, stderr: "" }; }, ...runtime });
  return { ...loaded, calls };
}
// A built tool folder: sources, a DLL, and the stamp `pnpm build:csharp` writes beside it (hash of the sources).
const toolFolder = (name) => {
  const folder = path.join(scratch, name);
  const built = path.join(folder, "bin", "Release", "net10.0");
  fs.mkdirSync(built, { recursive: true });
  fs.mkdirSync(path.join(folder, "obj"), { recursive: true });
  fs.mkdirSync(path.join(folder, "Sub"), { recursive: true });
  fs.writeFileSync(path.join(folder, "Plumb.CSharpFacts.csproj"), "<Project />");
  fs.writeFileSync(path.join(folder, "Program.cs"), "class P { }");
  fs.writeFileSync(path.join(folder, "Sub", "Extra.cs"), "class E { }");
  // Files under bin/ and obj/ aren't compile inputs.
  fs.writeFileSync(path.join(folder, "obj", "Generated.cs"), "");
  fs.writeFileSync(path.join(built, "Plumb.CSharpFacts.dll"), "");
  fs.writeFileSync(path.join(built, TOOL_STAMP), toolSourceHash(folder));
  return folder;
};

test("no dotnet, or no .NET 10 SDK (a .NET 9 or 11 one alone), skips the facts rules with the SDK diagnostic and never runs the tool", () => {
  const message = "plumb: .NET 10 SDK not found — C# facts rules skipped (install the .NET 10 SDK)";
  const fresh = toolFolder("tool-for-sdk");
  for (const dotnet of [() => null, () => ["9.0.319"], () => [], () => ["9.0.319", "11.0.100"], () => ["11.0.100"]]) {
    const result = memory({ dotnet, toolFolder: fresh });
    assert.deepEqual(result.diagnostics, [message]);
    assert.equal(result.facts.available, false);
    assert.deepEqual(result.calls, []);
    assert.deepEqual(result.facts.references(result.context.file("a/A.cs")), []);
  }
  // A 10.x SDK is enough beside a later one (the tool targets net10.0 with no roll-forward), and a run that exits 0
  // without writing its output is a tool failure too.
  const later = memory({ dotnet: () => ["10.0.402", "11.0.100"], toolFolder: fresh });
  assert.deepEqual(later.diagnostics, ["plumb: C# facts tool failed (0: unreadable output)"]);
  assert.equal(later.calls.length, 1);
  // The scratch folder the run wrote into is gone once the run returns.
  assert.ok(!fs.existsSync(scratchOf(later.calls[0][1])));
});

const scratchOf = (args) => path.dirname(args[args.indexOf("--out") + 1]);

test("the SDK check comes before the tool check", () => {
  const empty = path.join(scratch, "no-tool");
  fs.mkdirSync(empty, { recursive: true });
  const result = memory({ dotnet: () => null, toolFolder: empty });
  assert.deepEqual(result.diagnostics, ["plumb: .NET 10 SDK not found — C# facts rules skipped (install the .NET 10 SDK)"]);
});

test("a tool that isn't built, or whose sources changed since the build, skips the facts rules with the build diagnostic", () => {
  const message = "plumb: C# facts tool not built — C# facts rules skipped (run pnpm build:csharp in the plumb folder)";
  const missing = memory({ dotnet: () => ["10.0.402"], toolFolder: path.join(scratch, "does-not-exist") });
  assert.deepEqual(missing.diagnostics, [message]);
  assert.equal(missing.facts.available, false);
  assert.deepEqual(missing.calls, []);
  const skipped = (folder) => {
    const result = memory({ dotnet: () => ["10.0.402"], toolFolder: folder });
    assert.deepEqual(result.diagnostics, [message]);
    assert.deepEqual(result.calls, []);
  };
  // A DLL with no stamp, a stamp that isn't the sources' hash, an edited source, and a deleted one are all stale.
  const unstamped = toolFolder("tool-unstamped");
  fs.rmSync(path.join(unstamped, "bin", "Release", "net10.0", TOOL_STAMP));
  skipped(unstamped);
  const wrongStamp = toolFolder("tool-wrong-stamp");
  fs.writeFileSync(path.join(wrongStamp, "bin", "Release", "net10.0", TOOL_STAMP), "0".repeat(64));
  skipped(wrongStamp);
  const edited = toolFolder("tool-edited");
  fs.writeFileSync(path.join(edited, "Sub", "Extra.cs"), "class E { int changed; }");
  skipped(edited);
  const deleted = toolFolder("tool-deleted");
  fs.rmSync(path.join(deleted, "Sub", "Extra.cs"));
  skipped(deleted);
  // The project file is a compile input too (package pins, LangVersion).
  const project = toolFolder("tool-project");
  fs.writeFileSync(path.join(project, "Plumb.CSharpFacts.csproj"), '<Project Sdk="x" />');
  skipped(project);
  // A stamped folder reaches the run, whatever else sits beside the sources: neither an editor or system file, a note,
  // nor a file under bin/ or obj/ is a compile input.
  const fresh = toolFolder("tool-fresh");
  fs.writeFileSync(path.join(fresh, ".DS_Store"), "x");
  fs.writeFileSync(path.join(fresh, "Sub", "notes.txt"), "x");
  fs.writeFileSync(path.join(fresh, "Program.cs~"), "x");
  fs.writeFileSync(path.join(fresh, "obj", "Another.cs"), "x");
  fs.writeFileSync(path.join(fresh, "bin", "Another.cs"), "x");
  const reached = memory({ dotnet: () => ["10.0.402"], toolFolder: fresh, run: () => ({ status: 3, stderr: "exit" }) });
  assert.ok(!reached.diagnostics.includes(message));
  assert.deepEqual(reached.diagnostics, ["plumb: C# facts tool failed (3: exit)"]);
});

test("a tool that exits non-zero gives the failure diagnostic with its first stderr line, and no facts", () => {
  const calls = [];
  // The list of repository files is a scratch file removed once the run returns, so it is read during the run.
  const listed = [];
  const result = memory({
    dotnet: () => ["10.0.402"],
    toolFolder: toolFolder("tool-exit"),
    run: (command, args) => {
      calls.push([command, args]);
      listed.push(fs.readFileSync(args[args.indexOf("--repo-files") + 1], "utf8"));
      return { status: 3, stderr: "\nboom\nmore" };
    },
  });
  assert.deepEqual(result.diagnostics, ["plumb: C# facts tool failed (3: boom)"]);
  assert.equal(result.facts.available, false);
  // The run is `dotnet <dll> --root … --out … --repo-files … --external … --external-segment … <project>`, the nearest project once.
  assert.equal(calls.length, 1);
  const [command, args] = calls[0];
  assert.equal(command, "dotnet");
  assert.ok(args[0].endsWith(path.join("bin", "Release", "net10.0", "Plumb.CSharpFacts.dll")));
  assert.equal(args[args.indexOf("--root") + 1], "/repo");
  assert.deepEqual(projectsHanded(args), ["a/A.csproj"]);
  // --repo-files names a file listing the repository's .cs files, one path a line, so the tool knows what a build's folders hold of its own.
  assert.ok(args.includes("--repo-files"));
  assert.deepEqual(listed, ["a/A.cs\nloose/L.cs"]);
  assert.ok(!fs.existsSync(scratchOf(args)));
});

test("the incomplete-facts diagnostic carries the project's first message on one line, with its whitespace collapsed", () => {
  const messages = ["  first\n\n   line\twith    runs  ", "second\nmessage"];
  let scratchDir;
  const result = memory({
    dotnet: () => ["10.0.402"],
    toolFolder: toolFolder("tool-whitespace"),
    run: (command, args) => {
      scratchDir = scratchOf(args);
      const raw = { strings: [], projects: [{ path: "a/A.csproj", loaded: false, messages }], documents: [], types: [], usings: [], references: [], tables: [], snapshotTables: [], defaultSchemas: [] };
      fs.writeFileSync(args[args.indexOf("--out") + 1], JSON.stringify(raw));
      return { status: 0, stderr: "" };
    },
  });
  assert.deepEqual(result.diagnostics, ["plumb: C# facts incomplete for a/A.csproj: first line with runs"]);
  // The project's own messages keep their text.
  assert.deepEqual(entryOf(result, "a/A.csproj").messages, messages);
  // The scratch folder holding the tool's output was there during the run and is gone after a run that succeeded.
  assert.ok(scratchDir);
  assert.ok(!fs.existsSync(scratchDir));
});

test("with no project to pass, the tool isn't run and nothing is reported", () => {
  const files = { "loose/L.cs": "class L { }\n" };
  const result = memory({ dotnet: () => { throw new Error("the SDK lookup must not run"); }, toolFolder: path.join(scratch, "unused") }, files);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.calls, []);
  assert.equal(result.facts.available, true);
  assert.deepEqual([...result.facts.types.keys(), ...result.facts.tables, ...result.facts.snapshotTables, ...result.facts.defaultSchemas], []);
  assert.equal(result.facts.hasFacts("loose/L.cs"), false);
});
