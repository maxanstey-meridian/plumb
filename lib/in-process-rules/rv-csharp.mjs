import { Capability, createRuleDescriptor, defineRepositoryRule } from "../engine/contracts.mjs";
import { csharpDeclarations } from "../engine/csharp-types.mjs";
import { matchingCSharpDelimiter } from "../engine/dotnet-analysis.mjs";
import { isCSharpTestCode } from "./helpers.mjs";

const source = "in-process/rv-csharp.mjs";
const practicalRules = "rivet.md#practical-rules";
const twoWaysIn = "rivet.md#two-ways-in";
const endpointComposition = "rivet.md#endpoint-composition";
const minimalApis = "rivet.md#minimal-apis";
const controllerIntegration = "rivet.md#controller-or-functions-aspnet-integration";

const report = (context, id, severity, file, line, message, docRef) => context.report({
  id,
  severity,
  path: file.path,
  line,
  message,
  docRef,
});

const depthAt = (text, end) => {
  let depth = 0;
  for (let index = 0; index < end; index++) {
    if (text[index] === "{") depth++;
    else if (text[index] === "}") depth--;
  }
  return depth;
};

const methodBlock = (text) => {
  const declaration = /\b(?:public|internal|private|protected)\s+[^;{}=]+?\b[A-Za-z_]\w*\s*\(/s;
  const first = declaration.exec(text);
  if (!first) return text;
  const after = first.index + first[0].length;
  const next = declaration.exec(text.slice(after));
  return next ? text.slice(first.index, after + next.index) : text.slice(first.index);
};

const matchingEnd = (text, open, opening, closing) => {
  let depth = 1;
  let end = open + 1;
  while (end < text.length && depth) {
    if (text[end] === opening) depth++;
    else if (text[end] === closing) depth--;
    end++;
  }
  return end;
};

const rv001 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-RV-001", source }),
  requirements: [Capability.CSHARP, Capability.DOTNET_PROJECTS],
  analyze(context) {
    for (const file of context.csharp.csharpFiles) {
      if (isCSharpTestCode(context, file)) continue;
      const masked = context.csharp.mask(file);
      for (const match of masked.matchAll(/\[RivetClient\b[^\]]*\]/g)) {
        report(context, "MER-RV-001", "warn", file, file.lineMap().lineAt(match.index),
          "prefer an explicit [RivetContract] contract class — [RivetClient] is the shortcut mode", twoWaysIn);
      }
    }
  },
});

const rv002 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-RV-002", source }),
  requirements: [Capability.CSHARP, Capability.DOTNET_PROJECTS],
  analyze(context) {
    const filesByProject = new Map();
    for (const file of context.csharp.csharpFiles) {
      if (isCSharpTestCode(context, file)) continue;
      const project = context.dotnetProjects.nearestProject(file);
      const key = project?.path ?? "";
      if (!filesByProject.has(key)) filesByProject.set(key, []);
      filesByProject.get(key).push(file);
    }
    for (const files of filesByProject.values()) {
      if (!files.some((file) => /\[RivetContract\b[^\]]*\]/.test(context.csharp.mask(file)))) continue;
      for (const file of files) {
        if (file.name === "Program.cs") continue;
        const masked = context.csharp.mask(file, { preserveStringDelimiters: true });
        const pattern = /(?:\[Http(?:Get|Post|Put|Delete|Patch)|\.Map(?:Get|Post|Put|Delete|Patch))\(\s*(?:@|\$)*"/g;
        for (const match of masked.matchAll(pattern)) {
          report(context, "MER-RV-002", "error", file, file.lineMap().lineAt(match.index),
            "literal route in a contract-bearing project — use the contract route (e.g. [HttpPost(XContract.CreateRoute)] / Contract.X.Route)", practicalRules);
        }
      }
    }
  },
});

const rv003 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-RV-003", source }),
  requirements: [Capability.CSHARP, Capability.DOTNET_PROJECTS],
  analyze(context) {
    // The contract field must be used in the handler block: bound via .Bind, or
    // answered through one of the Rivet terminals (.Success/.Error/.File). Formatters
    // split `Contract\n    .Field.Success(`, so member access may span whitespace. Like Rivet's
    // --check, a local holding the field (`var endpoint = XContract.List;`) stands for it.
    const terminal = String.raw`\s*\.\s*(?:Bind|Success|Error|File)\s*\(`;
    const emit = (file, route, start, block, contract, fields, target) => {
      const field = String.raw`\b${contract}\s*\.\s*(?:${fields?.join("|") ?? String.raw`[A-Za-z_]\w*`})`;
      if (new RegExp(field + terminal).test(block)) return;
      for (const [, local] of block.matchAll(new RegExp(String.raw`\b([A-Za-z_]\w*)\s*=\s*${field}\s*;`, "g"))) {
        if (new RegExp(String.raw`\b${local}${terminal}`).test(block)) return;
      }
      report(context, "MER-RV-003", "warn", file, file.lineMap().lineAt(start),
        `handler route references ${route} but the following handler block has no .Bind or terminal (.Success/.Error/.File) call on ${target}`, practicalRules);
    };
    const emitField = (file, route, start, block) => {
      const [contract, field] = route.split(".");
      emit(file, route, start, block, contract, [field], "it");
    };

    // A controller attribute needs a compile-time constant, so it names the contract's
    // `const string` route rather than a field's runtime .Route. Names don't map a const to its
    // field (DraftRoute can serve GetDraft and SaveDraft), so the contract does: the fields
    // whose initialiser is Define.<Verb>(<Const>), narrowed to the handler's verb. The contract is
    // the type the written name resolves to, read from its own (non-test) declarations; one outside
    // the scan, or ambiguous, leaves any of its fields acceptable. A const that backs no field is a
    // plain ASP.NET route (an OIDC redirect, say), not a Rivet handler; one that backs fields only
    // for other verbs is usually a verb mismatch. A composed route (`BaseRoute + "/{id}"`) names no
    // single field, so any of its contract's fields for that verb will do, and a contract with none
    // for that verb is again a plain ASP.NET route.
    const constRoute = /\b([A-Za-z_]\w*Contract)\.([A-Za-z_]\w*Route)\b(?!\s*\.)/;
    const defineVerbs = { Get: ["Get", "File"], Post: ["Post"], Put: ["Put"], Delete: ["Delete"], Patch: ["Patch"] };
    const definition = /\bstatic\s+readonly\s+[^=;{}]+?\b([A-Za-z_]\w*)\s*=\s*Define\s*\.\s*(Get|Post|Put|Patch|Delete|File)\b[^(;]*\(\s*(?:route\s*:\s*)?(?:(?:[A-Za-z_]\w*Contract\s*\.\s*)?([A-Za-z_]\w*)\s*[),])?/g;
    const contractFields = new Map();
    const fieldsOf = (written, file, offset) => {
      const declarations = (context.csharp.resolveType(written, file, offset)?.declarations ?? [])
        .filter((declaration) => !isCSharpTestCode(context, declaration.file));
      if (!declarations.length) return null;
      const key = declarations.map((declaration) => `${declaration.file.path}:${declaration.offset}`).join("|");
      if (!contractFields.has(key)) {
        const fields = [];
        for (const declaration of declarations) {
          const text = context.csharp.mask(declaration.file);
          const header = /[^{;]*([{;])/y;
          header.lastIndex = declaration.offset;
          const opening = header.exec(text);
          if (opening?.[1] !== "{") continue;
          const open = header.lastIndex - 1;
          const body = text.slice(open + 1, matchingEnd(text, open, "{", "}") - 1);
          for (const [, name, defineVerb, constName] of body.matchAll(definition)) fields.push({ name, defineVerb, constName });
        }
        contractFields.set(key, fields);
      }
      return contractFields.get(key);
    };
    const httpVerb = (defineVerb) => defineVerb === "File" ? "Get" : defineVerb;
    const list = (values) => values.length > 1 ? `${values.slice(0, -1).join(", ")} and ${values.at(-1)}` : values[0];
    const emitConst = (file, verb, written, contract, constant, start, block, composed = false) => {
      const defined = fieldsOf(written, file, start);
      let fields = null;
      if (defined) {
        const backing = composed ? defined : defined.filter(({ constName }) => constName === constant);
        fields = backing.filter(({ defineVerb }) => defineVerbs[verb].includes(defineVerb)).map(({ name }) => name);
        if (!fields.length) {
          if (!composed && backing.length) report(context, "MER-RV-003", "warn", file, file.lineMap().lineAt(start),
            `handler is Http${verb} but ${contract}.${constant} backs only ${list([...new Set(backing.map(({ defineVerb }) => httpVerb(defineVerb)))])} fields (${backing.map(({ name }) => name).join(", ")}) — use the matching verb, or add the field`, practicalRules);
          return;
        }
      }
      const target = fields ? fields.map((name) => `${contract}.${name}`).join(" or ") : `any ${contract} field`;
      emit(file, `${contract}.${constant}`, start, block, contract, fields, target);
    };

    const verbs = "(Get|Post|Put|Delete|Patch)";
    const nextHandler = String.raw`([\s\S]*?)(?=\[Http(?:Get|Post|Put|Delete|Patch)\b|$)`;
    // Only a Map* call can take a field's runtime .Route; an attribute argument must be a constant.
    const fieldRoute = /\b([A-Za-z_]\w*Contract\.[A-Za-z_]\w*)\.Route\b/;
    // The attribute's route argument: positional or `template:`, the contract optionally namespace-qualified,
    // then `,`/`)` (the whole route) or `+` (composed).
    const routeArgument = String.raw`(?:template\s*:\s*)?((?:global::)?(?:[A-Za-z_]\w*\s*\.\s*)*?)${constRoute.source}\s*([,)+])`;
    const attributed = new RegExp(String.raw`\[Http${verbs}\s*\(\s*${routeArgument}[^\]]*\]${nextHandler}`, "g");
    const mapped = new RegExp(String.raw`\bMap${verbs}\s*\(\s*(?:${fieldRoute.source}|${constRoute.source})\s*,`, "g");
    for (const file of context.csharp.csharpFiles) {
      if (!file.name.endsWith("Controller.cs") && !file.name.endsWith("Endpoints.cs")) continue;
      // Comments and string contents are blanked (offsets kept), so neither a commented-out handler
      // nor a commented-out .Bind counts.
      const text = context.csharp.mask(file);
      for (const match of text.matchAll(attributed)) {
        const [, verb, qualifier, contract, constant, delimiter, rest] = match;
        emitConst(file, verb, qualifier + contract, contract, constant, match.index, methodBlock(rest), delimiter === "+");
      }

      const routedClass = /\[Route\s*\([^\]]*?\b([A-Za-z_]\w*Contract)\.BaseRoute\b[^\]]*\)\s*\][^{]*\bclass\b[^{]*\{/g;
      for (const match of text.matchAll(routedClass)) {
        const open = match.index + match[0].length - 1;
        const end = matchingEnd(text, open, "{", "}");
        const body = text.slice(open + 1, end - 1);
        const handlers = new RegExp(String.raw`\[Http(?:Get|Post|Put|Delete|Patch)(?:\s*\(([^\]]*)\))?\s*\]${nextHandler}`, "g");
        for (const handlerMatch of body.matchAll(handlers)) {
          const handler = methodBlock(handlerMatch[2]);
          // A handler naming its own contract route is checked by the attributed pass above.
          if (handlerMatch[1] !== undefined && new RegExp(String.raw`^\s*${routeArgument}`).test(`${handlerMatch[1]})`)) continue;
          const method = /\b(?:public|internal|private|protected)\s+[^;{}=]+?\b([A-Za-z_]\w*)\s*\(/s.exec(handler)?.[1];
          if (method) emitField(file, `${match[1]}.${method}`, open + 1 + handlerMatch.index, handler);
        }
        routedClass.lastIndex = end;
      }

      for (let match; (match = mapped.exec(text));) {
        const [, verb, route, contract, constant] = match;
        const open = text.indexOf("(", match.index);
        const end = matchingEnd(text, open, "(", ")");
        const block = text.slice(open + 1, end - 1);
        if (route) emitField(file, route, match.index, block);
        else emitConst(file, verb, contract, contract, constant, match.index, block);
        mapped.lastIndex = end;
      }
    }
  },
});

const rv006 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-RV-006", source }),
  requirements: [Capability.CSHARP, Capability.DOTNET_PROJECTS],
  analyze(context) {
    const message = "[RivetContract] classes may contain only const strings and static readonly RouteDefinition fields";
    for (const file of context.csharp.csharpFiles) {
      if (isCSharpTestCode(context, file)) continue;
      const masked = context.csharp.mask(file);
      const declaration = /\[RivetContract\b[^\]]*\]\s*((?:(?:public|internal|private|protected|abstract|sealed|static|partial)\s+)*)class\s+[A-Za-z_]\w*Contract\b[^{]*\{/g;
      for (const match of masked.matchAll(declaration)) {
        if (!/\bstatic\b/.test(match[1])) report(context, "MER-RV-006", "warn", file, file.lineMap().lineAt(match.index),
          "[RivetContract] must annotate a static contract declaration", twoWaysIn);
        const open = match.index + match[0].lastIndexOf("{");
        const end = matchingEnd(masked, open, "{", "}");
        const body = masked.slice(open + 1, end - 1);
        const bodyLine = file.lineMap().lineAt(open + 1);
        const reported = new Set();
        const method = /(?:^|[;}])(\s*(?:(?:public|internal|private|protected|static|async|virtual|override|sealed|new|unsafe|extern|partial)\s+)*(?:[\w:<>,.?\[\]]+\s+)+[A-Za-z_]\w*\s*)\(/gms;
        for (const member of body.matchAll(method)) {
          const memberOffset = member.index + member[0].indexOf(member[1]);
          if (depthAt(body, memberOffset) !== 0) continue;
          const start = memberOffset + member[1].search(/\S/);
          const line = bodyLine + body.slice(0, start).split("\n").length - 1;
          reported.add(line);
          report(context, "MER-RV-006", "warn", file, line, message, twoWaysIn);
        }
        for (const [offset, lineSource] of body.split(/\r?\n/).entries()) {
          if (!/^\s*(?:public|internal|private|protected)\s+(?:static\s+)?(?!const\s+string\b)(?:readonly\s+|const\s+)?[\w:<>,.?\[\]]+\s+\w+\s*(?:=>|=|;|\{\s*(?:get|set|init)\b)/.test(lineSource) ||
              /\bstatic\s+readonly\s+.*RouteDefinition/.test(lineSource)) continue;
          const line = bodyLine + offset;
          if (!reported.has(line)) report(context, "MER-RV-006", "warn", file, line, message, twoWaysIn);
        }
      }
    }
  },
});

// Rivet ships the transport adapters (`.ToResult()` / `.ToActionResult()` in namespace Rivet); an app that
// writes its own extension off RivetResult named like them or returning an HTTP result is a hand-written bridge
// beside them, unless its body goes through them (a helper owning an error path). Test code may build results
// freely, but one named like them still shadows them in a test.
const httpResults = new Set([
  // Minimal API results and the Microsoft.AspNetCore.Http.HttpResults typed results.
  "IResult", "Results", "Ok", "Created", "CreatedAtRoute", "Accepted", "AcceptedAtRoute", "NoContent", "NotFound",
  "BadRequest", "Conflict", "UnprocessableEntity", "InternalServerError", "ValidationProblem",
  // MVC results.
  "IActionResult", "ActionResult", "ObjectResult", "OkObjectResult", "OkResult", "JsonResult", "ContentResult",
  "StatusCodeResult", "NoContentResult", "NotFoundResult", "NotFoundObjectResult", "BadRequestResult",
  "BadRequestObjectResult", "CreatedResult", "CreatedAtActionResult", "CreatedAtRouteResult", "AcceptedResult",
  "ConflictObjectResult", "UnprocessableEntityObjectResult", "FileResult", "FileContentResult", "FileStreamResult",
  "PhysicalFileResult", "EmptyResult", "RedirectResult", "RedirectToActionResult", "RedirectToRouteResult", "LocalRedirectResult",
  "UnauthorizedResult", "ForbidResult", "ChallengeResult", "ConflictResult", "UnprocessableEntityResult", "AcceptedAtActionResult",
  "AcceptedAtRouteResult",
  // Azure Functions isolated worker.
  "HttpResponseData",
]);
// A return type without its whitespace, `global::` and Task/ValueTask wrappers.
const awaitedType = (type) => {
  let name = type.replace(/\s+/g, "").replace(/^global::/, "");
  for (let unwrapped; (unwrapped = /^(?:[\w.]+\.)?(?:Task|ValueTask)<(.+)>\??$/.exec(name));) name = unwrapped[1].replace(/^global::/, "");
  return name;
};
// `Task<Results<Ok, NotFound>>`, `ValueTask<IActionResult>`, `Microsoft.AspNetCore.Http.HttpResults.Ok<T>`, `JsonHttpResult<T>`.
const returnsHttpResult = (type) => {
  const outer = /^(?:\w+\.)*(\w+)/.exec(awaitedType(type))?.[1] ?? "";
  return httpResults.has(outer) || outer.endsWith("HttpResult");
};
// Where the expression starting at `from` ends: at the bracket that closes around it, or at a `stops` character
// (`;`, and `,` for an argument) outside brackets.
function statementEnd(text, from, stops = ";") {
  for (let index = from, depth = 0; index < text.length; index++) {
    if ("([{".includes(text[index])) depth++;
    else if (")]}".includes(text[index])) { if (!depth--) return index; }
    else if (stops.includes(text[index]) && !depth) return index;
  }
  return text.length;
}

// Building an HTTP result itself: `Results.Json`, `new ObjectResult`, `Problem(…)`, `request.CreateResponse(…)`.
const BUILDS_RESULT = /\b(?:Results|TypedResults)\s*\.|\bnew\s+(?:[\w.]+\.)?\w*Result\b|\b(?:Problem|ValidationProblem|StatusCode|CreateResponse)\s*\(/;
// Rivet's own namespace, `Rivet` itself: its adapters and their output belong there (`Rivet.Shims` in an app's tree
// is the app's).
const RIVET_NAMESPACE = "Rivet";
// A written name of Rivet's type `name`, or one of the `aliases` naming it: bare (unless `bare` is false: the code
// declares a type of that name in scope, which wins over `using Rivet;`), under Rivet's own namespace, after
// `global::` and that namespace, or after one of the `namespaces` aliasing it (`RivetActionResult`,
// `Rivet.RivetActionResult`, `global::Rivet.RivetActionResult`, `R.RivetActionResult` and `R::RivetActionResult`
// under `using R = Rivet;`). After any other qualifier (`Legacy.RivetActionResult`, `global::RivetActionResult`)
// it's another type; a spread's `..` is no qualifier.
const rivetType = (name, aliases = [], namespaces = [], bare = true) => {
  const qualifier = [String.raw`(?:global\s*::\s*)?${RIVET_NAMESPACE}\s*\.`, ...namespaces.map((alias) => String.raw`${alias}\s*(?:\.|::)`)].join("|");
  return String.raw`(?<![\w@]|::\s*|(?<!\.)\.\s*)(?:(?:(?:${qualifier})\s*)${bare ? "?" : ""}${name}${aliases.map((alias) => `|${alias}`).join("")})\b`;
};
// A returned expression that ends in Rivet's adapter, awaited or not, null-forgiven (`!`) or not.
const ADAPTED = /\.\s*To(?:Action)?Result\s*\(\s*\)(?:\s*\.\s*ConfigureAwait\s*\([^()]*\))?\s*!?\s*$/;
const STATEMENT_WORDS = new Set(["if", "while", "for", "foreach", "switch", "catch", "using", "lock", "fixed", "return", "await", "new", "nameof", "typeof", "sizeof", "when", "else", "throw", "yield", "case", "in", "is", "as", "and", "or", "not", "with"]);
// A local function's head up to its parameter list's `(`: `IResult Show(`, `Task<int> Load<T>(`. A match whose
// type or name is a statement word (`return Copy(`, `when Allowed(`, `is Point(`) is a call or a pattern instead.
const LOCAL_FUNCTION = /\b([A-Za-z_][\w<>?,.[\]]*)\s+([A-Za-z_]\w*)\s*(?:<[^<>()]*>)?\s*\(/dg;
const LOCAL_BODY = /\s*(?:where\b[^{;]*?)?(?:\{|=>)/y;

// The local functions in `text` (a member's head reads the same, so its methods too), in source order, each `{ name,
// at, type, open, close, body }`: its name and the name's offset, its return type, its parameter list's brackets
// and its body (memberBody), block or expression, after any `where` clauses (`T Show<T>(T value) where T : class {`).
function localFunctions(text) {
  const found = [];
  for (const match of text.matchAll(LOCAL_FUNCTION)) {
    if (STATEMENT_WORDS.has(match[1]) || STATEMENT_WORDS.has(match[2])) continue;
    const open = match.index + match[0].length - 1, close = matchingCSharpDelimiter(text, open);
    LOCAL_BODY.lastIndex = close + 1;
    const body = close > 0 && LOCAL_BODY.test(text) ? memberBody(text, close + 1) : null;
    if (body) found.push({ name: match[2], at: match.indices[2][0], type: match[1], open, close, body });
  }
  return found;
}

// Whether the `?` at `index` opens a ?:, rather than starting `?.`, `?[` or `??` or ending a nullable type (`int?`,
// `List<int?>`, `Dictionary<int?, string>`, `int?[]`): a type's `?` is followed, after any spaces, by `>`, `,`, `]`
// or another `?` (`is int? ? a : b`).
function isConditional(text, index) {
  if (text[index] !== "?" || text[index - 1] === "?" || "?.[".includes(text[index + 1] ?? "")) return false;
  let next = index + 1;
  while (/\s/.test(text[next] ?? "")) next++;
  return next < text.length && !">,]?".includes(text[next]);
}

// The top-level parts of `text` split at `separator` (a `,` or the `:` of a ?:), outside brackets.
function topLevelSplit(text, separator) {
  const parts = [];
  let depth = 0, start = 0;
  for (let index = 0; index < text.length; index++) {
    if ("([{".includes(text[index])) depth++;
    else if (")]}".includes(text[index])) depth--;
    else if (text[index] === separator && !depth) { parts.push(text.slice(start, index)); start = index + 1; }
  }
  return [...parts, text.slice(start)];
}

// The values a returned expression can produce: each arm of a top-level ?:, each operand of a top-level ??, each
// arm of a switch expression, and each lambda body of a call made only of lambdas (`.Match(ok => …, error => …)`),
// down to plain values.
function arms(expression) {
  const value = expression.replace(/^\s*await\b/, "").trim();
  let depth = 0;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if ("([{".includes(character)) depth++;
    else if (")]}".includes(character)) depth--;
    else if (!depth && isConditional(value, index)) {
      // The `:` that closes this ?: is the first top-level one not taken by a nested ?:.
      let nested = 0;
      for (let colon = index + 1, inner = 0; colon < value.length; colon++) {
        const next = value[colon];
        if ("([{".includes(next)) inner++;
        else if (")]}".includes(next)) inner--;
        else if (!inner && isConditional(value, colon)) nested++;
        else if (next === ":" && !inner && !nested--) return [...arms(value.slice(index + 1, colon)), ...arms(value.slice(colon + 1))];
      }
      return [value];
    }
  }
  // `left ?? right` (not `??=`), split after any ?: since it binds tighter: either operand, and nothing from a
  // `throw` on the right.
  depth = 0;
  for (let index = 0; index < value.length - 1; index++) {
    if ("([{".includes(value[index])) depth++;
    else if (")]}".includes(value[index])) depth--;
    else if (!depth && value.startsWith("??", index) && value[index + 2] !== "=") {
      const right = value.slice(index + 2);
      return [...arms(value.slice(0, index)), ...(/^\s*throw\b/.test(right) ? [] : arms(right))];
    }
  }
  // `subject switch { pattern => arm, … }` whose braces close the expression.
  depth = 0;
  for (let index = 0; index < value.length; index++) {
    if ("([{".includes(value[index])) depth++;
    else if (")]}".includes(value[index])) depth--;
    const keyword = !depth && /^\bswitch\s*\{/.exec(value.slice(index));
    if (!keyword || /\w/.test(value[index - 1] ?? "")) continue;
    const brace = index + keyword[0].length - 1;
    if (matchingCSharpDelimiter(value, brace) !== value.length - 1) break;
    return topLevelSplit(value.slice(brace + 1, -1), ",").filter((arm) => arm.trim()).flatMap((arm) => {
      const arrow = arm.indexOf("=>");
      return arrow < 0 ? [arm] : arms(arm.slice(arrow + 2));
    });
  }
  if (value.endsWith(")")) {
    const open = (() => { for (let index = value.length - 1, inner = 0; index >= 0; index--) {
      if (value[index] === ")") inner++;
      else if (value[index] === "(" && !--inner) return index;
    } return -1; })();
    const args = open > 0 ? topLevelSplit(value.slice(open + 1, -1), ",") : [];
    // A lambda: `ok => …`, `(ok) => …`, `async ok => …`, `IResult (ok) => …` (an explicit return type), named or not.
    if (args.length && args.every((arg) => /^\s*(?:\w+\s*:\s*)?(?:(?:async|static)\s+)*(?:[\w<>?,.[\]]+\s*(?=\())?(?:\w+|\([^()]*\))\s*=>/.test(arg))) {
      return args.flatMap((arg) => arms(arg.slice(arg.indexOf("=>") + 2)));
    }
  }
  return [value];
}

// Blanks the bodies of the lambdas, anonymous delegates and local functions inside a method body: their own
// returns are not the method's.
function ownStatements(body) {
  let own = body;
  const blank = (open) => {
    const end = matchingCSharpDelimiter(own, open);
    if (end > open) own = own.slice(0, open + 1) + " ".repeat(end - open - 1) + own.slice(end);
  };
  for (const lambda of body.matchAll(/(?:=>|\bdelegate\b\s*(?:\([^()]*\))?)\s*\{/g)) blank(lambda.index + lambda[0].length - 1);
  for (const local of localFunctions(own)) if (local.body.block) blank(local.body.from - 1);
  return own;
}

// The [from, to) range of a member's body, given the offset just past its parameter list (or its name, for a
// property): an expression body after `=>`, or a block (`block`); null for none (an abstract or partial member).
function memberBody(text, after) {
  const start = /^[^{;]*?(\{|=>)/s.exec(text.slice(after));
  if (!start) return null;
  const from = after + start[0].length, block = start[1] === "{";
  const to = block ? matchingCSharpDelimiter(text, from - 1) : statementEnd(text, from);
  return { from, to: to < 0 ? text.length : to, block };
}

// The [from, to) ranges of what a member's body returns: its expression body, or each `return`'s value in its
// block and a property accessor's `get => …`, outside the lambdas and local functions in it. `own` is the block's
// ownStatements, when the caller has it already.
function returnedRanges(text, { from, to, block }, own = block ? ownStatements(text.slice(from, to)) : null) {
  if (!block) return [[from, to]];
  const values = [...own.matchAll(/\breturn\b|(?<=(?:^|[;{}\]])\s*(?:(?:private|protected|internal|readonly)\s+)*)get\s*=>/g)];
  return values.map((match) => {
    const at = match.index + match[0].length;
    return [from + at, from + statementEnd(own, at)];
  });
}

// The offsets of `text` inside a deconstruction's target, a bracketed group whose `)` is followed by `=` (`(adapted,
// _) =`, nested tuples and brackets or calls in it too: `(adapted, slots[Index(0)]) =`), never crossing `;`, `{` or
// `}`: as a test of one offset, from one pass.
function deconstructionTargets(text) {
  const covered = new Int32Array(text.length + 1), opens = [], assigned = /\s*=(?![=>])/y;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === "(") opens.push(index);
    else if (";{}".includes(character)) opens.length = 0;
    else if (character === ")" && opens.length) {
      const open = opens.pop();
      assigned.lastIndex = index + 1;
      if (assigned.test(text)) { covered[open]++; covered[index]--; }
    }
  }
  for (let index = 1; index <= text.length; index++) covered[index] += covered[index - 1];
  return (offset) => covered[offset] > 0;
}

// A local declaration's head: the statement's start (the body's, or after `;`, `{`, `}`, a label's or a case's `:`,
// or a `for`, `using` or `fixed` statement's `(`), a `using` declaration's `using` and any `const`, `scoped`, `ref`
// or `readonly`, then its type (`var`, `IActionResult`, `RivetActionResult?`, `Task<IActionResult>`, `int[]`) and
// the space before its first declarator. A lambda's or a local function's parameter list starts no statement.
const LOCAL_DECLARATION = /(?:^|[;{}:]|\b(?:for|using|fixed)\s*\()\s*(?:(?:await\s+)?using\s+)?(?:(?:const|scoped|ref|readonly)\s+)*([A-Za-z_][\w.]*)(?:\s*<(?:[^<>;{}()]|<[^<>;{}()]*>)*>)?(?:\s*\?)?(?:\s*\[[\s,]*\])*\s+(?=@?[A-Za-z_])/g;
// One declarator of a declaration, split at its top-level commas: a name, then its `=` or nothing.
const DECLARATOR = /^\s*@?([A-Za-z_]\w*)\s*(?:=(?![=>])|$)/;
// Whether `source` (a body's own statements) declares `name` as a local: `IActionResult adapted;`, `var adapted =
// …`, or any declarator of a statement declaring several (`IActionResult other = x, adapted = …`). A head whose
// type is a statement word (`return adapted;`, `else adapted = …`), `do` or `goto` declares nothing, nor one whose
// first part is no declarator.
function declaresLocal(source, name) {
  for (const match of source.matchAll(LOCAL_DECLARATION)) {
    if (STATEMENT_WORDS.has(match[1]) || match[1] === "do" || match[1] === "goto") continue;
    const from = match.index + match[0].length;
    const parts = topLevelSplit(source.slice(from, statementEnd(source, from)), ",");
    if (!DECLARATOR.test(parts[0])) continue;
    if (parts.some((part) => DECLARATOR.exec(part)?.[1] === name)) return true;
  }
  return false;
}

// Whether the method whose parameter list opens at `open` is a helper that goes through Rivet's adapter: every
// value it returns, arm by arm, is the adapter's output (isAdapterOutput): it ends in .ToResult()/.ToActionResult(),
// or is a local its own statements declare (declaresLocal) whose one write in the body, in those statements,
// assigns it one on every arm (`var adapted = result.ToActionResult(); … return adapted;`, a cast of one too); and it
// builds no HTTP result of its own and writes no response anywhere in it other than the adapter's output
// (writesResponse), whatever it reads. A bridge has to call the adapter too (the result's status and body are
// internal), then copies its output into a new result or the response, so calling it somewhere is not enough;
// reading or logging that output (`(RivetActionResult)result.ToActionResult()`) copies nothing.
function adapts(text, open) {
  const close = matchingCSharpDelimiter(text, open);
  const body = close < 0 ? null : memberBody(text, close + 1);
  const code = body && text.slice(body.from, body.to);
  if (!body || BUILDS_RESULT.test(code)) return false;
  const own = body.block ? ownStatements(code) : null;
  const source = own ?? code;
  let targets = null;
  // A returned name the body's own statements declare as a local (not a lambda's or a local function's; a field
  // another member may write is not the adapter's), written just once in the whole body (counting compound
  // assignments, `out`, `ref` and any mention inside a deconstruction's target), in those statements, with the
  // adapter's result on every arm.
  const adaptedName = (value) => {
    const name = /^@?([A-Za-z_]\w*)\s*!?$/.exec(value)?.[1];
    if (!name || STATEMENT_WORDS.has(name) || !declaresLocal(source, name)) return false;
    const write = new RegExp(String.raw`\b(?<passed>out|ref)\s+(?:var\s+)?@?${name}\b|(?<![\w@.])@?${name}\s*(?<compound>[-+*/%&|^]|\?\?|<<|>>>?)?=(?![=>])`, "g");
    const written = [...code.matchAll(write)];
    if (written.length !== 1 || written[0].groups.passed || written[0].groups.compound) return false;
    targets ??= deconstructionTargets(code);
    if ([...code.matchAll(new RegExp(String.raw`(?<![\w@.])@?${name}\b`, "g"))].some((match) => targets(match.index))) return false;
    const [{ index }] = written, at = index + written[0][0].length;
    // The value ends at a top-level comma followed only by more declarators (`adapted = r.ToActionResult(), other =
    // x;`), not at one inside a type argument list (`r.Map<A, B>().ToActionResult()`).
    const [first, ...rest] = topLevelSplit(code.slice(at, statementEnd(code, at)), ",");
    const assigned = rest.length && rest.every((part) => DECLARATOR.test(part)) ? first : [first, ...rest].join(",");
    return source.slice(index, at) === written[0][0] && arms(assigned).every((arm) => ADAPTED.test(arm.trim()));
  };
  const isAdapterOutput = (value) => ADAPTED.test(value.trim()) || adaptedName(value.trim());
  if (writesResponse(code, isAdapterOutput)) return false;
  const returned = returnedRanges(text, body, own).map(([from, to]) => source.slice(from - body.from, to - body.from));
  return returned.length > 0 && returned.flatMap(arms).every(isAdapterOutput);
}

// Copying Rivet's adapter output out of it (see rv007): building an HTTP result of the framework's own
// (`Results.Json(…)`, `new ObjectResult`, `request.CreateResponse(…)`), or writing the response
// (`Response.StatusCode =`, `response.WriteAsync(…)`, `WriteAsJsonAsync(…)`, `Response.Body`, `context.Result =`).
// An app type named like a result (`AuditResult`, `ValidationResult`), a member called Results (`Results.Add`)
// and another writer (`channel.Writer.WriteAsync`, an audit entry's `.Result =`) are neither. A target-typed
// `new(…)` builds one where its declaration names the type (`ObjectResult result = new(…)`), or where a member
// declared to return one returns it (see adapterCopies).
const RESULT_NAME = String.raw`(?:Object|Content|Json|StatusCode|File\w*|Ok|NoContent|NotFound|BadRequest|Conflict|Empty|Redirect\w*|Challenge|Forbid|SignIn|SignOut|Accepted\w*|Created\w*|UnprocessableEntity|Unauthorized|Problem)Result`;
const RESULT_TYPE = String.raw`(?:[\w.]+\.)?(?:\w*${RESULT_NAME}|HttpResponseData)`;
// A member's declared return type (awaitedType's, its modifiers stripped first) naming a result.
const NAMES_RESULT_TYPE = new RegExp(String.raw`^(?:global::)?${RESULT_TYPE}\??$`);
const RESPONSE_WRITES = [
  String.raw`(?<![.\w])(?:Results|TypedResults)\s*\.\s*(?:Json|Ok|Problem|ValidationProblem|StatusCode|Content|Text|Bytes|Stream|File|Created\w*|Accepted\w*|NoContent|NotFound|BadRequest|Conflict|UnprocessableEntity|Unauthorized|Forbid|Challenge|SignIn|SignOut|Redirect\w*|LocalRedirect|Empty|InternalServerError)\b`,
  String.raw`\bnew\s+${RESULT_TYPE}\b`,
  String.raw`\b${RESULT_TYPE}\s*\??\s+@?[A-Za-z_]\w*\s*=\s*new\s*\(`,
  String.raw`\bCreateResponse\s*\(`,
  String.raw`\b[Rr]esponse\s*\.\s*StatusCode\s*=(?!=)`,
  String.raw`\b[Rr]esponse\s*\.\s*(?:Body(?:Writer)?\s*\.\s*)?Write\w*Async\s*\(`,
  String.raw`\.\s*WriteAsJsonAsync\s*\(`,
  String.raw`\bResponse\s*\.\s*Body\b`,
];
// Setting a filter's result: only on a filter's context (`context`, `ctx`, `filterContext`, `executingContext`,
// `resultExecutingContext`), never an app's own (`auditContext.Result = …`, `transactionContext.Result = …` write no
// response). A lower-case part starts the name; an ActionContext has no Result to set.
const FILTER_RESULT_SET = String.raw`\b(?:context|ctx|(?:executing|executed|exception|filter|result)Context|\w*(?:Executing|Executed|Exception|Filter|Result)Context)\s*\.\s*Result\s*=(?!=)`;
const COPIES_INTO = new RegExp([...RESPONSE_WRITES, FILTER_RESULT_SET].join("|"));
// Writing the response anywhere in a body (see adapts): COPIES_INTO, except that a filter's `….Result =` counts
// only when some arm of the value is not the adapter's output (`isAdapterOutput`, adapts' test):
// `context.Result = r.ToActionResult()` lets Rivet write the response.
const WRITES_RESPONSE = new RegExp(RESPONSE_WRITES.join("|"));
const FILTER_RESULT = new RegExp(FILTER_RESULT_SET, "g");
const writesResponse = (code, isAdapterOutput) => WRITES_RESPONSE.test(code) || [...code.matchAll(FILTER_RESULT)].some((match) => {
  const at = match.index + match[0].length;
  return !arms(code.slice(at, statementEnd(code, at))).every(isAdapterOutput);
});
// A controller's own result helpers (`Ok(…)`, `Problem(…)`): they build a result only inside a controller, a type
// named `…Controller` (one part of a partial one too) or deriving from a `…Controller`/`…ControllerBase`, and never
// as a constructor (`new Content(…)`).
const CONTROLLER_HELPER = /(?<![.\w])(?<!\bnew\s+)(?:Problem|ValidationProblem|StatusCode|Ok|Json|Content|File|Created\w*|Accepted\w*|BadRequest|NotFound|Conflict|UnprocessableEntity|Unauthorized|NoContent|Redirect\w*)\s*\(/;
const isController = (name, header) => /Controller$/.test(name) || /:[^{]*\b\w*Controller(?:Base)?\b/.test(header);

// `text` with the given [from, to) ranges replaced by spaces, offsets kept. Ranges may overlap.
function blanked(text, ranges) {
  let result = "", cursor = 0;
  for (const [from, to] of [...ranges].sort((left, right) => left[0] - right[0])) {
    if (to <= cursor) continue;
    const start = Math.max(from, cursor);
    result += text.slice(cursor, start) + " ".repeat(to - start);
    cursor = to;
  }
  return result + text.slice(cursor);
}

// `text` without what names a type but reads no value: attribute sections (`[ProducesResponseType(…)]`, a
// parameter's `[FromBody]`) and the operands of typeof() and nameof(). A `[` is an attribute section where a
// member, a statement or a parameter starts and a declaration follows it; a collection expression (`Json([a])`)
// is followed by `,` or `)`.
function withoutTypeMentions(text) {
  const ranges = [];
  for (const match of text.matchAll(/\b(?:typeof|nameof)\s*\(/g)) {
    const open = match.index + match[0].length - 1, close = matchingCSharpDelimiter(text, open);
    if (close > open) ranges.push([open + 1, close]);
  }
  for (const match of text.matchAll(/\[\s*(?:[A-Za-z_]\w*\s*:\s*)?[A-Za-z_]/g)) {
    let before = match.index - 1;
    while (before >= 0 && /\s/.test(text[before])) before--;
    if (before >= 0 && !";{}]([,".includes(text[before])) continue;
    const close = matchingCSharpDelimiter(text, match.index);
    if (close > 0 && /^\s*[[@A-Za-z_]/.test(text.slice(close + 1, close + 200))) ranges.push([match.index, close + 1]);
  }
  return blanked(text, ranges);
}

const CONTROL_HEADS = new Set(["if", "while", "for", "foreach", "switch", "using", "lock", "fixed", "catch"]);
const BLOCK_WORDS = new Set(["else", "try", "finally", "do", "get", "set", "init", "add", "remove", "checked", "unchecked", "unsafe"]);
const VALUE_WORDS = new Set(["new", "switch", "with", "is", "case", "and", "or", "not"]);
// A written type: `Order`, `global::A.B`, `List<int>`, `Dictionary<string, List<int>>?`.
const GENERIC_ARGUMENTS = String.raw`<(?:[^<>;{}]|<(?:[^<>;{}]|<[^<>;{}]*>)*>)*>`;
const TYPE_EXPRESSION = String.raw`(?:global\s*::\s*)?[A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)*(?:\s*${GENERIC_ARGUMENTS})?(?:\s*\?)?`;
// Text ending in a construction's type, just before its `(`, `{` or `[`: `new Foo`, `new`, `new int[]`, `new
// Foo<T>`, `new[]`. One type expression at most sits between `new` and the end, so the `new` modifier
// (`public new int this[…]`, `new IActionResult Show`) constructs nothing.
const CONSTRUCTION = new RegExp(String.raw`\bnew\s*(?:${TYPE_EXPRESSION})?\s*(?:\[[^[\]{};]*\]\s*)*$`);
// Text ending in a pattern's generic or array type, just before its property pattern's `{`: `is List<int>`,
// `case int[]`.
const GENERIC_PATTERN = new RegExp(String.raw`\b(?:is|case|and|or|not)\s+${TYPE_EXPRESSION}\s*(?:\[[\s,]*\]\s*)*$`);

// Whether the `{` at `index` opens a block (a type, member, accessor, lambda or statement body, or a nested
// block) rather than an initializer, an anonymous object, a collection, a property pattern or a switch
// expression's arms.
function opensBlock(text, index) {
  let at = index - 1;
  while (at >= 0 && /\s/.test(text[at])) at--;
  if (at < 0 || ";{}:".includes(text[at]) || (text[at] === ">" && text[at - 1] === "=")) return true;
  const head = text.slice(Math.max(0, at - 300), at + 1);
  const constructed = (before) => CONSTRUCTION.test(before) && !/\bwhere\b[^;{}]*\bnew\s*$/.test(before);
  if (text[at] === ")") {
    let open = at;
    for (let depth = 0; open >= 0; open--) {
      if (text[open] === ")") depth++;
      else if (text[open] === "(" && !--depth) break;
    }
    // `new ObjectResult(a.Value) { … }` and `new() { … }` initialize; `if (…) {`, `Copy(…) {`, `where T : new() {` open blocks.
    return !constructed(text.slice(Math.max(0, open - 300), Math.max(0, open)));
  }
  if (/\w/.test(text[at])) {
    const word = /\w+$/.exec(head)[0];
    if (BLOCK_WORDS.has(word)) return true;
    if (VALUE_WORDS.has(word)) return false;
    // `new Order {`, and a pattern's `is Order {` / `case Order {`; otherwise a type, namespace or property header.
    return !/\b(?:new|is|case|and|or|not)\s+(?:global\s*::\s*)?[\w.]+$/.test(head);
  }
  // `new List<int> {`, `new[] {` and a pattern's `is List<int> {`; otherwise a generic type's header.
  if (text[at] === ">" || text[at] === "]") return !constructed(head) && !GENERIC_PATTERN.test(head);
  return false;
}

// Whether `label`, a block's statement up to a `:` outside brackets, is a switch section's whole label: `default`,
// or `case …` whose every ?: has closed (`case int n when flag ? n > 1 : n > 2:`). A property pattern's `:` is
// inside its braces (`case { Length: 2 }:`).
function endsLabel(label) {
  if (/^\s*default\s*$/.test(label)) return true;
  if (!/^\s*case\b/.test(label)) return false;
  let open = 0;
  for (let index = 0, depth = 0; index < label.length; index++) {
    const character = label[index];
    if ("([{".includes(character)) depth++;
    else if (")]}".includes(character)) depth--;
    else if (depth) continue;
    else if (isConditional(label, index)) open++;
    else if (character === ":" && label[index + 1] !== ":" && label[index - 1] !== ":") open--;
  }
  return open === 0;
}

// The statements in a type's or a file's own code, each `{ start, end, head, block, guarded }`: split at each `;`
// outside brackets, at each block's `{` and `}`, and after an `if (…)`/`foreach (…)`/… head or a switch section's
// `case …:`/`default:` label, whose condition only decides (`head` is true for it). An initializer's or a switch
// expression's braces stay inside their statement, and a lambda's block has statements of its own. `block` is the
// innermost block around the statement (`from` its `{`, `to` past its `}`; the whole text at the top), and
// `guarded` says it runs only on a condition: right after a head, or after `else` or `do`. A statement that a
// lambda's block splits (`status = Pick(() => { … }, status);`) leaves pieces before and after the block, each with
// `whole`: the offset the statement starts at.
function statementRanges(text) {
  const ranges = [], root = { block: true, depth: 0, head: false, from: 0, to: text.length };
  root.owner = root;
  const frames = [root];
  let start = 0, guard = false, whole = -1;
  const cut = (end, next, owner, head = false) => {
    const statement = text.slice(start, end);
    if (/\S/.test(statement)) {
      ranges.push({ start, end, head, block: owner, guarded: !head && (guard || /^\s*(?:else|do)\b/.test(statement)), ...(whole >= 0 && { whole }) });
      guard = head;
    }
    start = next;
    whole = -1;
  };
  for (let index = 0; index < text.length; index++) {
    const character = text[index], frame = frames.at(-1);
    if (character === "(" || character === "[") {
      if (character === "(" && frame.block && !frame.depth) frame.head = CONTROL_HEADS.has(/(\w+)\s*$/.exec(text.slice(Math.max(0, index - 20), index))?.[1]);
      frame.depth++;
    } else if (character === ")" || character === "]") {
      if (frame.depth) frame.depth--;
      if (!frame.depth && frame.head) { frame.head = false; cut(index + 1, index + 1, frame.owner, true); }
    } else if (character === "{") {
      const block = opensBlock(text, index);
      const opened = { block, depth: 0, head: false, from: index, to: text.length };
      opened.owner = block ? opened : frame.owner;
      frames.push(opened);
      // A block inside a statement's brackets or an initializer's braces is a lambda's, and the statement goes on
      // after it.
      if (block && (frame.depth || !frame.block)) opened.whole = whole = whole >= 0 ? whole : start;
      if (block) { cut(index, index + 1, frame.owner); guard = false; }
    } else if (character === "}") {
      const closed = frames.length > 1 ? frames.pop() : frame;
      if (closed !== root) closed.to = index + 1;
      if (closed.block) { cut(index, index + 1, closed.owner); guard = false; whole = closed.whole ?? -1; }
    } else if (character === ";" && frame.block && !frame.depth) cut(index + 1, index + 1, frame.owner);
    else if (character === ":" && frame.block && !frame.depth && text[index + 1] !== ":" && text[index - 1] !== ":" && endsLabel(text.slice(start, index))) {
      cut(index + 1, index + 1, frame.owner, true);
    }
  }
  cut(text.length, text.length, root);
  return ranges;
}

// The pattern-binding, local, parameter, field and property names a type's or a file's own code binds to Rivet's
// adapter output, each with its offset (`adapterType` matches its written type: RivetActionResult, qualified or
// not, or an alias): `is RivetActionResult adapted`, `is RivetActionResult { } adapted`, `case RivetActionResult
// adapted:`, `RivetActionResult adapted = …`, `(RivetActionResult adapted)`, `var adapted = (RivetActionResult)result`,
// `var adapted = result as RivetActionResult` and `var adapted = new RivetActionResult(…)`.
function adapterBindings(text, adapterType) {
  const bindings = [];
  const declared = new RegExp(String.raw`${adapterType}\s*\??\s*(?:\{[^{}]*\}\s*)?(@?[A-Za-z_]\w*)\b(?!\s*[(<])`, "g");
  for (const match of text.matchAll(declared)) {
    if (!STATEMENT_WORDS.has(match[1])) bindings.push({ name: match[1], offset: match.index });
  }
  const converted = new RegExp(String.raw`\bvar\s+(@?[A-Za-z_]\w*)\s*=\s*(?:\(\s*${adapterType}\s*\??\s*\)|[^;{}]*?\bas\s+${adapterType}|new\s+${adapterType})`, "g");
  for (const match of text.matchAll(converted)) bindings.push({ name: match[1], offset: match.index });
  return bindings;
}

// The [from, to) ranges of a type's members in its own text: its header up to the body's `{` (a record's
// parameters among them), then each member at the body's top level, ended by its `;` or by the `}` that closes
// its body. An initializer's, an anonymous object's, a property pattern's or a lambda argument's `}` ends nothing.
function memberRanges(text) {
  const open = text.indexOf("{");
  if (open < 0) return [[0, text.length]];
  const ranges = [[0, open + 1]];
  let start = open + 1, depth = 0, parens = 0, body = false;
  for (let index = start; index < text.length; index++) {
    const character = text[index];
    if (character === "(") parens++;
    else if (character === ")") parens--;
    else if (character === "{") { if (!depth++) body = !parens && opensBlock(text, index); }
    else if (character === "}") {
      if (!depth) { ranges.push([start, index]); break; }
      if (!--depth && body) { ranges.push([start, index + 1]); start = index + 1; }
    } else if (character === ";" && !depth && !parens) { ranges.push([start, index + 1]); start = index + 1; }
  }
  return ranges;
}

// Where a type's or a file's own code reads the adapter output's Value or StatusCode (or the `fields` of
// another type): through a bound name (`adapted.Value`, `this.Inner.StatusCode`), or straight off a cast
// (`((RivetActionResult)result).Value`, `(result as RivetActionResult)?.StatusCode`) or a construction (`new
// Reader(adapted).Body()`). A name reaches the member that binds it, or the whole type when a field, a property or
// a record parameter binds it (the header, or before the member's own parameters, body or initializer);
// `members` are the ranges to scope by (memberRanges), one range for top-level code.
function adapterReads(text, adapterType, members, fields = "Value|StatusCode") {
  const reads = [];
  const member = new RegExp(String.raw`^\s*!?\s*\??\s*\.\s*(?:${fields})\b`);
  const bindings = adapterBindings(text, adapterType);
  const rangeOf = (offset) => members.findIndex(([from, to]) => from <= offset && offset < to);
  const typeWide = (binding) => {
    const index = rangeOf(binding.offset);
    if (index <= 0) return true;
    const [from] = members[index];
    const opens = text.slice(from, binding.offset).search(/[({=]/);
    return opens < 0;
  };
  const wide = bindings.filter(typeWide).map((binding) => binding.name);
  const namedRead = (names) => new RegExp(String.raw`(?<![\w@]|(?<!\.)\.\s*)(?:this\s*\.\s*)?@?(?:${names.map((name) => name.replace(/^@/, "")).join("|")})\b(?=\s*!?\s*\??\s*\.\s*(?:${fields})\b)`, "g");
  for (const [index, [from, to]] of members.entries()) {
    const names = [...new Set([...wide, ...bindings.filter((binding) => rangeOf(binding.offset) === index).map((binding) => binding.name)])];
    if (!names.length) continue;
    for (const match of text.slice(from, to).matchAll(namedRead(names))) reads.push(from + match.index);
  }
  // A cast's outer `(`, an `as …)` or a construction's `(`, each read just past the bracket that closes it.
  const opener = new RegExp(String.raw`\((?=\s*\(\s*${adapterType}\s*\??\s*\))|\bas\s+${adapterType}\s*\??\s*\)|\bnew\s+${adapterType}\s*\(`, "g");
  for (const match of text.matchAll(opener)) {
    const last = match.index + match[0].length - 1;
    const close = text[last] === "(" ? matchingCSharpDelimiter(text, last) : last;
    if (close > 0 && member.test(text.slice(close + 1, close + 100))) reads.push(match.index);
  }
  return reads;
}

// A statement that declares or assigns a name: `var status = …`, `int status = …`, `status = …`, `else status = …`,
// not `status == …` or `status => …`; `type` is the declared type, if any, and `name` the name.
const ASSIGNS = new RegExp(String.raw`^\s*(?:else\s+)?(?:(?!(?:${[...STATEMENT_WORDS].join("|")})\s)(?<type>var|[A-Za-z_][\w.<>?,[\]]*)\s+)?(?<name>@?[A-Za-z_]\w*)\s*=(?![=>])`);

// The parameter lists of the lambdas and local functions in `text` (`name => …`, `(item, name) => …`, `(Line name)
// => …`, `int Show(int name) => …`, `IResult Show(Line name) { … }`), by offset, each `{ from, to, parameters }`:
// the range from the list to the end of the body, and the list's text. A `(…) =>` after a name is a lambda's when
// the name is async, static or return, or its return type where an expression starts (`var pick = int (int status)
// =>`, after `=`, `(`, `,`, `=>`, `return`, `?` or `:`); otherwise it's a local function's parameter list (see
// localFunctions, `locals` here) or none at all (a switch arm's `when Allowed(status) =>`).
function parameterLists(text, locals = localFunctions(text)) {
  const lists = [];
  const bodyEnd = (from) => {
    let body = from;
    while (/\s/.test(text[body] ?? "")) body++;
    const to = text[body] === "{" ? matchingCSharpDelimiter(text, body) + 1 : statementEnd(text, body, ";,");
    return to > 0 ? to : text.length;
  };
  for (const arrow of text.matchAll(/=>/g)) {
    let at = arrow.index - 1, from = -1;
    while (at >= 0 && /\s/.test(text[at])) at--;
    if (text[at] === ")") {
      for (let depth = 0, index = at; index >= 0; index--) {
        if (text[index] === ")") depth++;
        else if (text[index] === "(" && !--depth) { from = index; break; }
      }
      const before = from < 0 ? null : /(?:(=>|[=(,?:]|\breturn\b)\s*)?(@?[A-Za-z_]\w*)\s*$/.exec(text.slice(Math.max(0, from - 100), from));
      if (from < 0 || (before && before[1] === undefined && !["async", "static", "return"].includes(before[2]))) continue;
    } else {
      const single = /@?[A-Za-z_]\w*$/.exec(text.slice(Math.max(0, at - 100), at + 1));
      if (!single) continue;
      from = at + 1 - single[0].length;
    }
    lists.push({ from, to: bodyEnd(arrow.index + 2), parameters: text.slice(from, at + 1) });
  }
  for (const { open, close, body } of locals) lists.push({ from: open, to: body.block ? body.to + 1 : body.to, parameters: text.slice(open, close) });
  return lists.sort((left, right) => left.from - right.from);
}

// The [from, to) ranges of the lambdas and local functions among `lists` (parameterLists) that start in [from, to)
// and take `name` as a parameter, each with its body: the name is theirs there.
function lambdasTaking(lists, name, from, to) {
  const parameter = new RegExp(String.raw`(?<![\w@.])@?${name}\b`);
  return lists.slice(lastAtOrBefore(lists, from - 1, (list) => list.from) + 1, lastAtOrBefore(lists, to - 1, (list) => list.from) + 1)
    .filter((list) => parameter.test(list.parameters)).map((list) => [list.from, list.to]);
}

// The index of the last of the sorted `values` whose `key` is at or before `offset`, -1 for none.
function lastAtOrBefore(values, offset, key = (value) => value) {
  let low = 0, high = values.length - 1, found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (key(values[middle]) <= offset) { found = middle; low = middle + 1; } else high = middle - 1;
  }
  return found;
}

// How many arguments the parameter list `list` (the text inside its brackets) takes: `{ min, max }`, defaults and
// `params` allowed for.
function parameterCounts(list) {
  let flat = list;
  for (let previous; previous !== flat;) { previous = flat; flat = flat.replace(/<[^<>]*>/g, ""); }
  const parameters = topLevelSplit(flat, ",").filter((parameter) => parameter.trim());
  const rest = parameters.some((parameter) => /^\s*params\b/.test(parameter));
  const required = parameters.filter((parameter) => !parameter.includes("=") && !/^\s*params\b/.test(parameter)).length;
  return { min: required, max: rest ? Infinity : parameters.length };
}

// How many arguments the call whose `(` is at `open` passes.
function argumentCount(text, open) {
  const close = matchingCSharpDelimiter(text, open);
  return close < 0 ? 0 : topLevelSplit(text.slice(open + 1, close), ",").filter((argument) => argument.trim()).length;
}

const MODIFIERS = /^(?:(?:public|internal|private|protected|static|async|new|unsafe|extern|partial|override|virtual|sealed|readonly)\s+)*/;
// A member's head up to its parameter list's `(`, its expression body's `=>` or its accessor block's `{`: its name
// (group 1) and that opener (group 2).
const MEMBER_HEAD = /^[^;{}()=]*?(?<![\w@])(@?[A-Za-z_]\w*)\s*(?:<[^<>()]*>\s*)?(\(|=>|\{)/d;
const CALL_OPEN = /^\s*(?:<[^<>()]*>\s*)?\(/;

// The members of a type's own code (`scopes` from memberRanges, the header first) and the local functions in their
// bodies, or the local functions in a file's top-level code, each with a body: `name`, `at` (its name's offset),
// `parameters` (parameterCounts; null for a property), `type` (its return type), `returned` (returnedRanges) and
// `calls` (the range its calls are in: the type for a member, the member or the file for a local function).
function helperMembers(own, scopes, perMember, functions = localFunctions(own)) {
  const members = [];
  const add = (member, body, initializer = []) => { if (body) members.push({ ...member, returned: [...returnedRanges(own, body), ...initializer] }); };
  const locals = (from, to, calls) => {
    for (let index = lastAtOrBefore(functions, from - 1, (local) => local.at) + 1; index < functions.length && functions[index].at < to; index++) {
      const { name, at, type, open, close, body } = functions[index];
      add({ name, at, parameters: parameterCounts(own.slice(open + 1, close)), type, calls, local: true }, body);
    }
  };
  if (!perMember) {
    locals(0, own.length, [0, own.length]);
    return members;
  }
  for (const [index, [from, to]] of scopes.entries()) {
    const head = index ? MEMBER_HEAD.exec(own.slice(from, to)) : null;
    if (!head) continue;
    const at = from + head.indices[1][0] + (head[1].startsWith("@") ? 1 : 0), opener = from + head.indices[2][0];
    const close = head[2] === "(" ? matchingCSharpDelimiter(own, opener) : opener - 1;
    const body = close < 0 ? null : memberBody(own, close + 1);
    // An auto-property's initializer (`int Status { get; } = …;`) is what it returns.
    const initializer = body?.block && head[2] === "{" ? /^\}\s*=(?![=>])/.exec(own.slice(body.to)) : null;
    const value = initializer ? body.to + initializer[0].length : -1;
    add({
      name: head[1].replace(/^@/, ""), at, parameters: head[2] === "(" ? parameterCounts(own.slice(opener + 1, close)) : null,
      type: own.slice(from, from + head.indices[1][0]).trim().replace(MODIFIERS, ""), calls: [0, own.length], local: false,
    }, body, initializer ? [[value, statementEnd(own, value)]] : []);
    if (body?.block) locals(body.from, body.to, [from, to]);
  }
  return members;
}

// Where a type's or a file's own code copies the adapter output's Value or StatusCode out: the reads that share
// a statement with a result it builds or a response it writes (`controller`: with a controller's own helpers
// too), a target-typed `new(…)` among them where the member returning it is declared to return a result. A read
// reaches further through what holds it, chains included:
// - a local declared or assigned from a read (`var status = adapted.StatusCode;`, then `new ObjectResult(null) {
//   StatusCode = status }`): a declared one up to the end of its block, an assigned one up to the end of its member,
//   each up to and including the next statement that assigns the name unconditionally where the local is seen (in
//   its block or one around it, not after an `if (…)` or `else`, nor in a lambda's or a local function's block),
//   whose own value may read the local again (`status = Math.Min(status, 500);`). A named argument's label
//   (`statusCode: 500`), and a lambda's or a local function's own parameter or local of that name, are not the local;
// - a member or a local function that returns a read (`int Status() => adapted.StatusCode;`, `return
//   adapted.Value;`, `int Status { get => adapted.StatusCode; }`): its calls (`Status()`, `this.Status()`), a call
//   to a member with overloads only where its argument count picks members that all return one, and a member's
//   bare call not where a local function of its name is seen (the block declaring it);
// - a `related` type's (each `{ type, returns }`: a pattern for the type's name and the members it hands reads back
//   through), where the receiver is clear: `Reader.Body(adapted)`, a name bound to it (`Reader reader`, then
//   `reader.Body(adapted)`), `new Reader(adapted).Body()` or a cast.
// A filter may read them (Rivet's doc says so), and a statement that only logs or branches on them, beside
// another that sets `context.Result`, copies nothing. `perMember` says whether `text` is a type's (scoped per
// member) or top-level code (one scope). Returns the copies' offsets, and the type's members that return a read
// (`{ name, accepts(count) }`, for the types that call them). Known limits, accepted by the owner: a property
// pattern's bindings (`{ StatusCode: var status }`) and a read through IStatusCodeActionResult are not seen (an
// interpolated string's holes are code in the mask, so a read in one is); the rule stops at one file, so a helper
// in another file is not followed;
// an extension helper, even in the same file (`static int Code(this RivetActionResult a) => a.StatusCode;`, called
// as `adapted.Code()`), is not followed; and a field initialised from a read (`readonly int status =
// adapted.StatusCode;`) is followed only within its own declaration.
function adapterCopies(text, adapterType, { controller = false, perMember = true, related = [] } = {}) {
  const own = withoutTypeMentions(text);
  const scopes = perMember ? memberRanges(own) : [[0, own.length]];
  const initial = adapterReads(own, adapterType, scopes);
  for (const { type, returns } of related) {
    const fields = [...new Set(returns.map((member) => member.name))].join("|");
    // Whether the access to `name` ending at `after` passes an argument count a returning member accepts.
    const accepted = (name, after) => {
      const call = CALL_OPEN.exec(own.slice(after, after + 100));
      const count = call ? argumentCount(own, after + call[0].length - 1) : null;
      return returns.some((member) => member.name === name && (count === null || member.accepts(count)));
    };
    const field = new RegExp(String.raw`\.\s*(${fields})\b`, "g");
    for (const offset of adapterReads(own, type, scopes, fields)) {
      field.lastIndex = offset;
      const access = field.exec(own);
      if (access && access.index < offset + 300 && accepted(access[1], access.index + access[0].length)) initial.push(offset);
    }
    for (const match of own.matchAll(new RegExp(String.raw`${type}\s*\.\s*(${fields})\b`, "g"))) {
      if (accepted(match[1], match.index + match[0].length)) initial.push(match.index);
    }
  }
  if (!initial.length) return { copies: [], returns: [] };
  const statements = statementRanges(own).filter((statement) => !statement.head);
  const functions = localFunctions(own);
  const members = helperMembers(own, scopes, perMember, functions), lists = parameterLists(own, functions);
  const identifiers = new Map();
  for (const match of own.matchAll(/(?<![\w@])@?([A-Za-z_]\w*)/g)) {
    if (!identifiers.has(match[1])) identifiers.set(match[1], []);
    identifiers.get(match[1]).push(match.index + match[0].length - match[1].length);
  }
  // The offsets of `name` (bare, past any `@`) in [from, to).
  const occurrences = (name, from, to) => {
    const all = identifiers.get(name) ?? [];
    return all.slice(lastAtOrBefore(all, from - 1) + 1, lastAtOrBefore(all, to - 1) + 1);
  };
  const tokenStart = (offset) => own[offset - 1] === "@" ? offset - 1 : offset;
  // A member access (`holder.adapted`, `meter.Status()`), the name on the line after the dot too, but not a spread's
  // or a range's `..` (`[.. rows]`); `this` its receiver.
  const before = (offset) => own.slice(Math.max(0, tokenStart(offset) - 100), tokenStart(offset));
  const memberAccess = (offset) => /(?<!\.)\.\s*$/.test(before(offset));
  const thisAccess = (offset) => /(?<![\w@.])this\s*\.\s*$/.test(before(offset));
  const label = (offset, after) => /[(,]\s*$/.test(own.slice(Math.max(0, offset - 50), tokenStart(offset))) && /^\s*:(?!:)/.test(own.slice(after, after + 50));
  const assigned = (after) => /^\s*=(?!=)/.test(own.slice(after, after + 50));
  const statementAt = (offset) => {
    const statement = statements[lastAtOrBefore(statements, offset, (candidate) => candidate.start)];
    return statement && offset < statement.end ? statement : null;
  };
  const scopeAt = (offset) => {
    const scope = scopes[lastAtOrBefore(scopes, offset, ([from]) => from)];
    return scope && offset < scope[1] ? scope : null;
  };
  // The statement a lambda's block splits, whole (see statementRanges), so a read after the block is in it.
  const wholes = new Map();
  const wholeStatement = (statement) => {
    if (statement?.whole === undefined) return statement;
    if (!wholes.has(statement.whole)) wholes.set(statement.whole, { start: statement.whole, end: statementEnd(own, statement.whole) + 1, block: statement.block });
    return wholes.get(statement.whole);
  };
  // The statements that assign each name, in source order, each `{ statement, typed }`.
  const assignments = new Map();
  for (const statement of statements) {
    const assignment = ASSIGNS.exec(own.slice(statement.start, statement.end));
    if (!assignment) continue;
    const name = assignment.groups.name.replace(/^@/, "");
    if (!assignments.has(name)) assignments.set(name, []);
    assignments.get(name).push({ statement, typed: Boolean(assignment.groups.type) });
  }
  // The ranges each name's local functions are seen in (the block they're declared in), where a call of that name
  // is theirs, not a member's.
  const localScopes = new Map();
  for (const member of members) {
    const block = member.local ? statementAt(member.at)?.block : null;
    if (!block) continue;
    if (!localScopes.has(member.name)) localScopes.set(member.name, []);
    localScopes.get(member.name).push([block.from, block.to]);
  }

  const reads = [], seen = new Set(), queue = [];
  const add = (offset) => {
    if (seen.has(offset)) return;
    seen.add(offset);
    queue.push(offset);
    reads.splice(lastAtOrBefore(reads, offset) + 1, 0, offset);
  };
  const readsIn = (from, to) => reads.slice(lastAtOrBefore(reads, from - 1) + 1, lastAtOrBefore(reads, to - 1) + 1);

  // The returned ranges, by start, each with the furthest end so far, so the ranges around an offset are found
  // without a scan.
  const returned = members.flatMap((member) => member.returned.map(([from, to]) => ({ from, to, member }))).sort((left, right) => left.from - right.from);
  let reach = -1;
  const reaches = returned.map(({ to }) => (reach = Math.max(reach, to)));
  const returningAt = (offset) => {
    const found = [];
    for (let index = lastAtOrBefore(returned, offset, (range) => range.from); index >= 0 && reaches[index] > offset; index--) {
      if (offset < returned[index].to) found.push(returned[index].member);
    }
    return found;
  };
  const declarations = new Set(members.map((member) => member.at));
  const overloads = new Map();
  for (const member of members) {
    if (member.local || !member.parameters) continue;
    if (!overloads.has(member.name)) overloads.set(member.name, []);
    overloads.get(member.name).push(member);
  }
  const followed = new Set();
  const fits = (member, count) => member.parameters.min <= count && count <= member.parameters.max;
  const accepts = (member, count) => {
    const named = overloads.get(member.name) ?? [];
    return named.length < 2 || (fits(member, count) && named.filter((overload) => fits(overload, count)).every((overload) => followed.has(overload)));
  };

  const followCalls = (member) => {
    const hiding = member.local ? [] : localScopes.get(member.name) ?? [];
    for (const offset of occurrences(member.name, ...member.calls)) {
      if (declarations.has(offset)) continue;
      if (memberAccess(offset) && member.local) continue;
      if (!memberAccess(offset) && hiding.some(([from, to]) => from <= offset && offset < to)) continue;
      if (memberAccess(offset) && !thisAccess(offset)) continue;
      const after = offset + member.name.length;
      if (member.parameters) {
        const call = CALL_OPEN.exec(own.slice(after, after + 100));
        if (!call || !accepts(member, argumentCount(own, after + call[0].length - 1))) continue;
      } else if (assigned(after) || /^\s*\(/.test(own.slice(after, after + 50)) || label(offset, after)) continue;
      add(offset);
    }
  };
  // Each name's windows followed so far, each `{ from, to, hidden }`: [from, to) and the merged ranges it hid (the
  // name's shadowing redeclarations and lambdas). A window inside one of them that starts outside what it hid
  // reaches no read it didn't; one that starts in a hidden range is another local's (a lambda's own `status`).
  const windows = new Map();
  const hiddenIn = (hidden, offset) => {
    const range = hidden[lastAtOrBefore(hidden, offset, ([from]) => from)];
    return Boolean(range) && offset < range[1];
  };
  const followLocal = (statement) => {
    const local = ASSIGNS.exec(own.slice(statement.start, statement.end));
    const scope = local && scopeAt(statement.start);
    if (!scope) return;
    const name = local.groups.name.replace(/^@/, "");
    const end = local.groups.type ? Math.min(scope[1], statement.block.to) : scope[1];
    let until = end;
    const shadowed = [], named = assignments.get(name) ?? [];
    for (let index = lastAtOrBefore(named, statement.end - 1, (entry) => entry.statement.start) + 1; index < named.length && named[index].statement.start < end; index++) {
      const { statement: other, typed } = named[index];
      if (other.block.from <= statement.start && statement.start < other.block.to) {
        if (!other.guarded) { until = statementEnd(own, other.start) + 1; break; }
      } else if (typed) shadowed.push([other.start, other.block.to]);
    }
    if (!windows.has(name)) windows.set(name, []);
    const followedWindows = windows.get(name);
    if (followedWindows.some(({ from, to, hidden }) => from <= statement.end && until <= to && !hiddenIn(hidden, statement.end))) return;
    shadowed.push(...lambdasTaking(lists, name, statement.end, until));
    // The shadowed ranges merged, swept alongside the uses (both in source order).
    const merged = [];
    for (const [from, to] of shadowed.sort((left, right) => left[0] - right[0])) {
      if (merged.length && from <= merged.at(-1)[1]) merged.at(-1)[1] = Math.max(merged.at(-1)[1], to);
      else merged.push([from, to]);
    }
    followedWindows.push({ from: statement.end, to: until, hidden: merged });
    let next = 0;
    for (const offset of occurrences(name, statement.end, until)) {
      while (next < merged.length && merged[next][1] <= offset) next++;
      if (next < merged.length && merged[next][0] <= offset) continue;
      const after = offset + name.length;
      if (!memberAccess(offset) && !assigned(after) && !label(offset, after)) add(offset);
    }
  };

  for (const offset of initial) add(offset);
  const locals = new Set();
  while (queue.length) {
    const offset = queue.pop();
    const statement = wholeStatement(statementAt(offset));
    if (statement && !locals.has(statement)) {
      locals.add(statement);
      followLocal(statement);
    }
    for (const member of returningAt(offset)) {
      if (followed.has(member)) continue;
      followed.add(member);
      followCalls(member);
    }
  }

  // A target-typed `new(…)` returned by a member declared to return a result builds one.
  const builds = members.filter((member) => NAMES_RESULT_TYPE.test(awaitedType(member.type)))
    .flatMap((member) => member.returned.filter(([from, to]) => arms(own.slice(from, to)).some((value) => /^new\s*\(/.test(value.trim()))))
    .map(([from]) => from);
  // A statement a lambda's block splits is judged whole, from its pieces (`Results.Json(items.Select(i => { … }),
  // statusCode: adapted.StatusCode)`): the lambda's block holds statements of its own.
  const pieces = new Map();
  for (const statement of statements) {
    const key = statement.whole ?? statement;
    if (!pieces.has(key)) pieces.set(key, []);
    pieces.get(key).push(statement);
  }
  const copies = [...pieces.values()].flatMap((group) => {
    const inside = group.flatMap((statement) => readsIn(statement.start, statement.end));
    if (!inside.length) return [];
    const code = group.map((statement) => own.slice(statement.start, statement.end)).join(" ");
    const copied = COPIES_INTO.test(code) || (controller && CONTROLLER_HELPER.test(code)) ||
      builds.some((at) => group.some((statement) => statement.start <= at && at < statement.end));
    return copied ? inside : [];
  });
  const returns = [...followed].filter((member) => !member.local)
    .map((member) => ({ name: member.name, accepts: (count) => !member.parameters || accepts(member, count) }));
  return { copies, returns };
}

const rv007 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-RV-007", source }),
  requirements: [Capability.CSHARP, Capability.DOTNET_PROJECTS],
  analyze(context) {
    // An extension off RivetResult (`resultType`, rivetTypeIn's): its return type (group 1) and name (group 2).
    const extensionOf = (resultType) => new RegExp(String.raw`\bstatic\b([^;{}()=]*?)\s+([A-Za-z_]\w*)\s*(?:<\s*\w+(?:\s*,\s*\w+)*\s*>)?\s*\(\s*this\s+${resultType}`, "g");
    const inRivet = (namespace) => namespace === RIVET_NAMESPACE;
    // RivetActionResult is what Rivet's .ToActionResult() returns, RivetResult what its terminals do, and an alias
    // names either too: a file's own `using Adapted = Rivet.RivetActionResult;`, or one global to its project, the
    // way the type resolver scopes them (a `global using` in any file of the same project, or a <Using Alias> in its
    // .csproj or Directory.Build.props). A target is written without whitespace or `global::`, and may close a
    // generic one (`Rivet.RivetResult<Order>`). An alias of the namespace itself (`using R = Rivet;`) is collected
    // the same way, under RIVET_NAMESPACE, and qualifies either name.
    const RIVET_NAMES = ["RivetActionResult", "RivetResult", RIVET_NAMESPACE];
    const namesRivet = (name, target) => name === RIVET_NAMESPACE
      ? target === RIVET_NAMESPACE
      : new RegExp(String.raw`^(?:${RIVET_NAMESPACE}\.)?${name}(?:<.*>)?$`).test(target);
    const sourceAliases = new Map(), projectAliases = new Map();
    const aliasKey = (name, project) => `${name}\0${project?.path ?? ""}`;
    for (const file of context.csharp.csharpFiles) {
      const project = context.dotnetProjects.nearestProject(file);
      for (const using of context.csharp.usings(file)) {
        if (!using.global || !using.alias) continue;
        for (const name of RIVET_NAMES.filter((type) => namesRivet(type, using.target))) {
          const key = aliasKey(name, project);
          if (!sourceAliases.has(key)) sourceAliases.set(key, []);
          sourceAliases.get(key).push(using.alias);
        }
      }
    }
    const aliasesOf = (project, name) => {
      const key = aliasKey(name, project);
      if (!projectAliases.has(key)) {
        const items = project ? [project.file, ...context.dotnetProjects.propsFor(project)].flatMap((file) => context.csharp.projectUsings(file)) : [];
        projectAliases.set(key, [...(sourceAliases.get(key) ?? []), ...items
          .filter((using) => using.alias && !using.static && namesRivet(name, using.target) && (project.metadataIsTest || !using.testOnly))
          .map((using) => using.alias)]);
      }
      return projectAliases.get(key);
    };
    // How code at `offset` (-1 for top-level statements) writes Rivet's type `name` (rivetType), its aliases and the
    // namespace's among them: a file's own alias reaches the namespace block it's written in (nested blocks too), or
    // the whole file when it's written outside any. The bare name is Rivet's unless it resolves, as the compiler
    // would from `inside` (in the code's body, where its nested types are seen), to a type of the app's: one
    // declared in an enclosing type or namespace wins over `using Rivet;`. Only a type declared in the file's project
    // or one it references counts: a namesake the file doesn't compile against hides nothing.
    const rivetTypeIn = (file, namespaces, offset, name, inside = Math.max(offset, 0)) => {
      const reaches = (using) => {
        const scope = namespaces.findLast((candidate) => candidate.start <= using.offset && using.offset < candidate.end);
        return !scope || (scope.start <= offset && offset < scope.end);
      };
      const project = context.dotnetProjects.nearestProject(file);
      const aliases = (target) => [...new Set([...aliasesOf(project, target), ...context.csharp.usings(file)
        .filter((using) => !using.global && using.alias && namesRivet(target, using.target) && reaches(using)).map((using) => using.alias)])];
      const resolved = context.csharp.resolveType(name, file, inside, { visibleOnly: true });
      return rivetType(name, aliases(name), aliases(RIVET_NAMESPACE), !resolved || resolved.fullName === `${RIVET_NAMESPACE}.${name}`);
    };
    const copiesAdapterOutput = (subject) => `${subject} copies the StatusCode or Value of RivetActionResult, the output of Rivet's .ToActionResult() adapter, into an HTTP result or response of its own — a hand-written bridge; return .ToResult()/.ToActionResult() directly (in a filter, let Rivet write the response), and at most read its StatusCode or Value`;
    for (const file of context.csharp.csharpFiles) {
      const text = context.csharp.mask(file);
      const lineAt = (offset) => file.lineMap().lineAt(offset);
      const warn = (line, message) => report(context, "MER-RV-007", "warn", file, line, message, minimalApis);
      const { types, namespaces } = csharpDeclarations(text);
      // The text from `from` to `to`, offsets kept, with the declarations from types[after] on that start inside it
      // blanked: a type's own code without its nested types' (they follow it in source order), or the file's
      // top-level code without any type's.
      const ownText = (from, to, after) => {
        const inner = [];
        for (let index = after; index < types.length && types[index].start < to; index++) inner.push([types[index].start - from, types[index].end - from]);
        return blanked(text.slice(from, to), inner);
      };
      // Test code is exempt from the bridge and copy checks (it may build results and copy the adapter's output to
      // assert on them); only the namesake warning reaches it.
      const testCode = isCSharpTestCode(context, file);
      const bodies = types.map((type, index) => ownText(type.start, type.end, index + 1));
      // Each type's parent (the type around it: types come in source order, so the innermost still open), and whether
      // `inner` is nested in `outer`, at any depth.
      const parents = [], open = [];
      for (const type of types) {
        while (open.length && types[open.at(-1)].end < type.end) open.pop();
        parents.push(open.at(-1) ?? -1);
        open.push(parents.length - 1);
      }
      const within = (inner, outer) => {
        for (let at = parents[inner]; at >= 0; at = parents[at]) if (at === outer) return true;
        return false;
      };
      // The types whose members hand reads back to the type at `index` (-1 for top-level code), among the
      // `candidates` its code names (namedIn): its nested types, and the types its code names without qualifying
      // them (those around it and their nested types, the file's top-level ones), through static calls, a name bound
      // to one, a construction or a cast. A nested type of that name in it or a type around it (inside the other's
      // parent: inside `Outer.Inner`, `Outer.Reader` hides a top-level `Reader`) shadows the other. A type's name is
      // its own bare, after a suffix of its namespace-and-parents path (`Orders.Reader`, `Outer.Reader`) or after
      // `global::` and the whole path; after anything else (`Legacy.Reader`, a property's `this.Reader`, either one
      // across a line break, but not a spread's `[.. Reader.Rows(a)]`) it's another's.
      const nameOf = (at) => {
        const path = types[at].namespace ? types[at].namespace.split(".") : [];
        for (let parent = parents[at], depth = path.length; parent >= 0; parent = parents[parent]) path.splice(depth, 0, types[parent].name);
        const dot = String.raw`\s*\.\s*`;
        const suffix = path.reduce((inner, part) => `(?:${inner}${part}${dot})?`, "");
        return String.raw`(?<![\w@]|::\s*|(?<!\.)\.\s*)(?:global\s*::\s*${path.map((part) => part + dot).join("")}|${suffix})${types[at].name}\b`;
      };
      const names = types.map((_, at) => nameOf(at));
      const children = types.map(() => new Set());
      for (const [nested, parent] of parents.entries()) if (parent >= 0) children[parent].add(types[nested].name);
      // The types a body names (by index, in source order), from an index of types by name: only those can hand it
      // reads back.
      const byName = new Map();
      for (const [at, { name }] of types.entries()) {
        if (!byName.has(name)) byName.set(name, []);
        byName.get(name).push(at);
      }
      const namedIn = (body) => [...new Set(body.match(/[A-Za-z_]\w*/g))].flatMap((name) => byName.get(name) ?? []).sort((left, right) => left - right);
      const named = bodies.map(namedIn);
      const relatedTo = (index, results, candidates = named[index]) => candidates.flatMap((at) => {
        const inner = results[at];
        if (at === index || !inner?.returns.length) return [];
        const nested = index >= 0 && within(at, index);
        const visible = parents[at] < 0 || (index >= 0 && within(index, parents[at]));
        // A nested type of that name in the type or any type around it, out to the related type's parent, wins.
        let shadowed = false;
        for (let around = index; around >= 0 && around !== parents[at] && !shadowed; around = parents[around]) shadowed = children[around].has(types[at].name);
        return nested || (visible && !shadowed) ? [{ type: names[at], returns: inner.returns }] : [];
      });
      // Where a type's body starts (past its `{`, or its keyword for a bodiless record), so the names it resolves
      // include its nested types.
      const insides = types.map((type) => {
        const open = text.indexOf("{", type.offset);
        return open >= 0 && open < type.end ? open + 1 : type.offset;
      });
      const adapterTypes = types.map((type, index) => rivetTypeIn(file, namespaces, type.offset, "RivetActionResult", insides[index]));
      const controllers = types.map((type) => isController(type.name, text.slice(type.offset, type.end).split(/[{;]/)[0]));
      // Each app type's copies, nested types first, then again for each type whose code names one that has found
      // more members returning a read (`namedBy`, the reverse of `named`): those reach the types around it and the
      // ones that call them. Another pass runs only when a type that changed is named by one this pass already ran.
      const namedBy = types.map(() => []);
      for (const [index, candidates] of named.entries()) for (const at of candidates) namedBy[at].push(index);
      const copies = [];
      const pending = types.map((type) => !testCode && !inRivet(type.namespace));
      for (let again = pending.includes(true); again;) {
        again = false;
        for (let index = types.length - 1; index >= 0; index--) {
          if (!pending[index]) continue;
          pending[index] = false;
          const result = adapterCopies(bodies[index], adapterTypes[index], { controller: controllers[index], related: relatedTo(index, copies) });
          const changed = result.returns.length !== (copies[index]?.returns.length ?? 0);
          copies[index] = result;
          if (!changed) continue;
          for (const caller of namedBy[index]) {
            if (caller === index || inRivet(types[caller].namespace)) continue;
            pending[caller] = true;
            if (caller > index) again = true;
          }
        }
      }
      for (const [index, type] of types.entries()) {
        if (inRivet(type.namespace)) continue;
        const body = bodies[index];
        const bridges = [], namesakes = [];
        for (const match of body.matchAll(extensionOf(rivetTypeIn(file, namespaces, type.offset, "RivetResult", insides[index])))) {
          const [, returnType, name] = match;
          const namesake = /^To(?:Action)?Result$/.test(name);
          if ((testCode && !namesake) || adapts(body, match.index + match[0].lastIndexOf("("))) continue;
          if (!testCode && returnsHttpResult(returnType.trim().replace(MODIFIERS, ""))) bridges.push(name);
          else if (namesake) namesakes.push(name);
        }
        const line = lineAt(type.offset);
        if (bridges.length) {
          warn(line, `${type.name} hand-writes an HTTP-result bridge off RivetResult (${[...new Set(bridges)].join(", ")}) — delete it and use Rivet's first-party .ToResult()/.ToActionResult() adapters`);
        }
        if (namesakes.length) {
          warn(line, `${type.name} declares its own ${[...new Set(namesakes)].join(", ")} off RivetResult, so a handler's call may bind to it instead of Rivet's first-party adapter — rename or delete it`);
        }
        // Once per type, at its keyword; a type already reported as a bridge needs no second finding.
        if (!bridges.length && copies[index]?.copies.length) {
          report(context, "MER-RV-007", "warn", file, line, copiesAdapterOutput(type.name), controllerIntegration);
        }
      }
      if (testCode) continue;
      const adapterType = rivetTypeIn(file, namespaces, -1, "RivetActionResult");
      // Top-level code (top-level statements, and anything outside a type): once per line that copies. Using
      // directives read nothing.
      const usings = context.csharp.usings(file).map((using) => [using.offset, using.end]);
      const lines = new Set(), topLevel = blanked(ownText(0, text.length, 0), usings);
      for (const offset of adapterCopies(topLevel, adapterType, { perMember: false, related: relatedTo(-1, copies, namedIn(topLevel)) }).copies) {
        if (!inRivet(namespaces.findLast((scope) => scope.start <= offset && offset < scope.end)?.fullName ?? "")) lines.add(lineAt(offset));
      }
      for (const line of lines) report(context, "MER-RV-007", "warn", file, line, copiesAdapterOutput("This line"), controllerIntegration);
    }
  },
});

const rv008 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-RV-008", source }),
  requirements: [Capability.CSHARP, Capability.DOTNET_PROJECTS],
  analyze(context) {
    for (const program of context.csharp.csharpFiles) {
      if (program.name !== "Program.cs") continue;
      const text = context.csharp.source(program);
      const masked = context.csharp.mask(program);
      for (const match of masked.matchAll(/\.Map([A-Za-z_]\w*)\s*\(/g)) {
        const name = match[1];
        if (name === "Group" || name.endsWith("Endpoints")) continue;
        const open = match.index + match[0].length - 1;
        let argument = open + 1;
        while (/\s/.test(masked[argument] ?? "")) argument++;
        if (masked[argument] === ")") continue;
        const route = /^\s*"((?:\\.|[^"\\])*)"/s.exec(text.slice(open + 1))?.[1];
        if (route === "/" || route && /^\/(?:api\/)?health(?:\/|$)/.test(route)) continue;
        report(context, "MER-RV-008", "warn", program, program.lineMap().lineAt(match.index),
          "compose MapXEndpoints in Program.cs instead of inline business endpoint handlers", endpointComposition);
      }

      const mappings = new Set();
      for (const endpoint of context.csharp.csharpFiles) {
        if (!endpoint.path.startsWith(program.directory ? `${program.directory}/` : "") || !endpoint.name.endsWith("Endpoints.cs")) continue;
        for (const match of context.csharp.source(endpoint).matchAll(/\bMap[A-Za-z_][A-Za-z0-9_]*Endpoints\s*\(/g)) {
          mappings.add(match[0].replace(/\s*\($/, ""));
        }
      }
      for (const mapping of [...mappings].sort()) {
        if (new RegExp(`\\.${mapping}\\s*\\(`).test(masked)) continue;
        report(context, "MER-RV-008", "warn", program, 0, `Program.cs must compose ${mapping}`, endpointComposition);
      }
    }
  },
});

const rv009 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-RV-009", source }),
  requirements: [Capability.CSHARP],
  analyze(context) {
    for (const file of context.csharp.csharpFiles) {
      if (!file.name.endsWith("Endpoints.cs")) continue;
      if (file.path.split("/").some((segment) => segment === "obj" || segment === "bin")) continue;
      const text = context.csharp.source(file);
      const extensions = /\bMap[A-Za-z_][A-Za-z0-9_]*Endpoints\s*\(\s*this\s+((?:global::)?[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s+[A-Za-z_]\w*/g;
      for (const match of text.matchAll(extensions)) {
        const globallyQualified = match[1].startsWith("global::");
        const type = match[1].replace(/^global::/, "");
        if (type === "IEndpointRouteBuilder" || type === "Microsoft.AspNetCore.Routing.IEndpointRouteBuilder") continue;
        report(context, "MER-RV-009", "warn", file, globallyQualified ? 1 : file.lineMap().lineAt(match.index),
          "MapXEndpoints extensions must target Microsoft.AspNetCore.Routing.IEndpointRouteBuilder", endpointComposition);
      }
    }
  },
});

const rv010 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-RV-010", source }),
  requirements: [Capability.CSHARP, Capability.DOTNET_PROJECTS],
  analyze(context) {
    for (const file of context.csharp.csharpFiles) {
      if (isCSharpTestCode(context, file)) continue;
      if (!/\[RivetContract\b[^\]]*\]/.test(context.csharp.mask(file))) continue;
      const project = context.dotnetProjects.nearestProject(file);
      const relative = project?.directory ? file.path.slice(project.directory.length + 1) : file.path;
      if (!/^Contracts\/[^/]+\/[^/]+\.cs$/.test(relative)) report(context, "MER-RV-010", "error", file, 0,
        "contract classes live directly in top-level Contracts/{Module}/", "rivet.md#contract-location");
    }
  },
});

const rv011 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-RV-011", source }),
  requirements: [Capability.CSHARP, Capability.DOTNET_PROJECTS],
  analyze(context) {
    const wrappers = new Set([
      "Array", "Dictionary", "Enumerable", "HashSet", "ICollection", "IDictionary", "IEnumerable",
      "IList", "IReadOnlyCollection", "IReadOnlyDictionary", "IReadOnlyList", "List", "Nullable",
      "Task", "ValueTask", "ValueTuple",
    ]);
    const leaves = new Set([
      "bool", "byte", "char", "DateOnly", "DateTime", "DateTimeOffset", "decimal", "double",
      "float", "Guid", "int", "long", "object", "sbyte", "short", "string", "TimeOnly", "TimeSpan", "uint",
      "ulong", "Uri", "ushort", "void",
    ]);
    // Each payload type name resolves as the compiler would from the contract file; one outside the scan, or
    // ambiguous between usings, isn't judged. Partial parts (or one name in several projects) must agree.
    const inspect = (file, owner, typeSource, offset) => {
      const reported = new Set();
      for (const token of typeSource.matchAll(/(?:global::)?[A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)*/g)) {
        const name = token[0].replace(/^global::/, "").split(".").at(-1).trim();
        if (wrappers.has(name) || leaves.has(name) || reported.has(name)) continue;
        const candidates = (context.csharp.resolveType(token[0], file, offset + token.index)?.declarations ?? [])
          .filter((declaration) => !isCSharpTestCode(context, declaration.file));
        const placements = new Set(candidates.map(({ file: declared }) => {
          const { contract, contractOwner, common } = context.csharp.classify(declared);
          return `${contract}:${contractOwner}:${common}`;
        }));
        if (placements.size !== 1) continue;
        const target = context.csharp.classify(candidates[0].file);
        if ((name === "ErrorResponse" || name === "PaginatedResponse") && target.common) continue;
        if (target.contract === "transport" && target.contractOwner === owner) continue;
        reported.add(name);
        report(context, "MER-RV-011", "error", file, file.lineMap().lineAt(offset + token.index),
          `route payload ${name} is owned by ${target.contract ? `${target.contract} contract ${target.contractOwner}` : candidates[0].file.path} — define it in Contracts/${owner}/`,
          "rivet.md#route-payload-ownership");
      }
    };

    for (const file of context.csharp.csharpFiles) {
      if (isCSharpTestCode(context, file)) continue;
      const classification = context.csharp.classify(file);
      if (classification.contract !== "transport" || !/\[RivetContract\b[^\]]*\]/.test(context.csharp.mask(file))) continue;
      const masked = context.csharp.mask(file), owner = classification.contractOwner;
      const payload = /\b(?:RouteDefinition|InputRouteDefinition|FileRouteDefinition)\s*</g;
      for (const match of masked.matchAll(payload)) {
        const open = masked.indexOf("<", match.index), close = matchingCSharpDelimiter(masked, open, "<", ">");
        if (close < 0) continue;
        inspect(file, owner, masked.slice(open + 1, close), open + 1);
      }
      for (const match of masked.matchAll(/\.Returns\s*</g)) {
        const open = masked.indexOf("<", match.index), close = matchingCSharpDelimiter(masked, open, "<", ">");
        if (close < 0) continue;
        inspect(file, owner, masked.slice(open + 1, close), open + 1);
      }
    }
  },
});

export const rvCSharpRules = Object.freeze([
  rv001,
  rv002,
  rv003,
  rv006,
  rv007,
  rv008,
  rv009,
  rv010,
  rv011,
]);
