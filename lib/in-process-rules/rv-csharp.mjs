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
// beside them, unless its body goes through them (a helper owning an error path).
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
// `Task<Results<Ok, NotFound>>`, `ValueTask<IActionResult>`, `Microsoft.AspNetCore.Http.HttpResults.Ok<T>`, `JsonHttpResult<T>`.
const returnsHttpResult = (type) => {
  let name = type.replace(/\s+/g, "").replace(/^global::/, "");
  for (let unwrapped; (unwrapped = /^(?:[\w.]+\.)?(?:Task|ValueTask)<(.+)>\??$/.exec(name));) name = unwrapped[1].replace(/^global::/, "");
  const outer = /^(?:\w+\.)*(\w+)/.exec(name)?.[1] ?? "";
  return httpResults.has(outer) || outer.endsWith("HttpResult");
};
// The end of the statement or expression starting at `from`: the first `;` outside brackets.
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
// That, or reading what Rivet's adapter produced (`RivetActionResult`, whose StatusCode and Value a bridge copies
// into a result of its own).
const NATIVE_RESULT = new RegExp(String.raw`${BUILDS_RESULT.source}|\bRivetActionResult\b`);
// A returned expression that ends in Rivet's adapter, awaited or not.
const ADAPTED = /\.\s*To(?:Action)?Result\s*\(\s*\)(?:\s*\.\s*ConfigureAwait\s*\([^()]*\))?\s*$/;
const STATEMENT_WORDS = new Set(["if", "while", "for", "foreach", "switch", "catch", "using", "lock", "fixed", "return", "await", "new", "nameof", "typeof", "sizeof", "when", "else", "throw", "yield", "case", "in", "is", "as"]);

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

// The values a returned expression can produce: each arm of a top-level ?:, each arm of a switch expression,
// and each lambda body of a call made only of lambdas (`.Match(ok => …, error => …)`), down to plain values.
function arms(expression) {
  const value = expression.replace(/^\s*await\b/, "").trim();
  let depth = 0;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if ("([{".includes(character)) depth++;
    else if (")]}".includes(character)) depth--;
    else if (character === "?" && !depth && !"?.[".includes(value[index + 1]) && value[index - 1] !== "?") {
      // The `:` that closes this ?: is the first top-level one not taken by a nested ?:.
      let nested = 0;
      for (let colon = index + 1, inner = 0; colon < value.length; colon++) {
        const next = value[colon];
        if ("([{".includes(next)) inner++;
        else if (")]}".includes(next)) inner--;
        else if (next === "?" && !inner && !"?.[".includes(value[colon + 1]) && value[colon - 1] !== "?") nested++;
        else if (next === ":" && !inner && !nested--) return [...arms(value.slice(index + 1, colon)), ...arms(value.slice(colon + 1))];
      }
      return [value];
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
    if (args.length && args.every((arg) => /^\s*(?:\w+\s*:\s*)?(?:\w+|\([^()]*\))\s*=>/.test(arg))) {
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
  for (const local of body.matchAll(/\b([A-Za-z_][\w<>?,.[\]]*)\s+([A-Za-z_]\w*)\s*(?:<[^<>()]*>)?\s*\(/g)) {
    if (STATEMENT_WORDS.has(local[1]) || STATEMENT_WORDS.has(local[2])) continue;
    const open = local.index + local[0].length - 1, close = matchingCSharpDelimiter(own, open);
    const brace = close > 0 ? /^\s*\{/.exec(own.slice(close + 1)) : null;
    if (brace) blank(close + brace[0].length);
  }
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
// block, outside the lambdas and local functions in it.
function returnedRanges(text, { from, to, block }) {
  if (!block) return [[from, to]];
  const own = ownStatements(text.slice(from, to));
  return [...own.matchAll(/\breturn\b/g)].map((match) => {
    const at = match.index + match[0].length;
    return [from + at, from + statementEnd(own, at)];
  });
}

// Whether the method whose parameter list opens at `open` is a helper that goes through Rivet's adapter: every
// value it returns, arm by arm, ends in .ToResult()/.ToActionResult() and it builds no HTTP result of its own. A
// bridge has to call the adapter too (the result's status and body are internal), then copies its output into
// a new result, so calling it somewhere is not enough.
function adapts(text, open) {
  const close = matchingCSharpDelimiter(text, open);
  const body = close < 0 ? null : memberBody(text, close + 1);
  if (!body || NATIVE_RESULT.test(text.slice(body.from, body.to))) return false;
  const own = body.block ? text.slice(0, body.from) + ownStatements(text.slice(body.from, body.to)) : text;
  const returned = returnedRanges(text, body).map(([from, to]) => own.slice(from, to));
  return returned.length > 0 && returned.flatMap(arms).every((value) => ADAPTED.test(value.trim()));
}

// Copying Rivet's adapter output out of it (see rv007): building an HTTP result of the framework's own
// (`Results.Json(…)`, `new ObjectResult`, `request.CreateResponse(…)`), or writing the response
// (`Response.StatusCode =`, `response.WriteAsync(…)`, `WriteAsJsonAsync(…)`, `Response.Body`, `context.Result =`).
// An app type named like a result (`AuditResult`, `ValidationResult`), a member called Results (`Results.Add`)
// and another writer (`channel.Writer.WriteAsync`, an audit entry's `.Result =`) are neither.
const COPIES_INTO = new RegExp([
  String.raw`(?<![.\w])(?:Results|TypedResults)\s*\.\s*(?:Json|Ok|Problem|ValidationProblem|StatusCode|Content|Text|Bytes|Stream|File|Created\w*|Accepted\w*|NoContent|NotFound|BadRequest|Conflict|UnprocessableEntity|Unauthorized|Forbid|Challenge|SignIn|SignOut|Redirect\w*|LocalRedirect|Empty|InternalServerError)\b`,
  String.raw`\bnew\s+(?:[\w.]+\.)?(?:\w*(?:Object|Content|Json|StatusCode|File\w*|Ok|NoContent|NotFound|BadRequest|Conflict|Empty|Redirect\w*|Challenge|Forbid|SignIn|SignOut|Accepted\w*|Created\w*|UnprocessableEntity|Unauthorized|Problem)Result|HttpResponseData)\b`,
  String.raw`\bCreateResponse\s*\(`,
  String.raw`\b[Rr]esponse\s*\.\s*StatusCode\s*=(?!=)`,
  String.raw`\b[Rr]esponse\s*\.\s*(?:Body(?:Writer)?\s*\.\s*)?Write\w*Async\s*\(`,
  String.raw`\.\s*WriteAsJsonAsync\s*\(`,
  String.raw`\bResponse\s*\.\s*Body\b`,
  String.raw`\b(?:\w*[Cc]ontext|ctx)\s*\.\s*Result\s*=(?!=)`,
].join("|"));
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
const VALUE_WORDS = new Set(["new", "switch", "with", "is", "and", "or", "not"]);

// Whether the `{` at `index` opens a block (a type, member, accessor, lambda or statement body, or a nested
// block) rather than an initializer, an anonymous object, a collection, a property pattern or a switch
// expression's arms.
function opensBlock(text, index) {
  let at = index - 1;
  while (at >= 0 && /\s/.test(text[at])) at--;
  if (at < 0 || ";{}:".includes(text[at]) || (text[at] === ">" && text[at - 1] === "=")) return true;
  const head = text.slice(Math.max(0, at - 300), at + 1);
  const constructed = (before) => /\bnew\b[^;{}()=]*$/.test(before) && !/\bwhere\b[^;{}]*\bnew\s*$/.test(before);
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
  // `new List<int> {`, `new[] {`; otherwise a generic type's header.
  if (text[at] === ">" || text[at] === "]") return !constructed(head);
  return false;
}

// The [from, to, head] ranges of the statements in a type's or a file's own code: split at each `;` outside
// brackets, at each block's `{` and `}`, and after an `if (…)`/`foreach (…)`/… head, whose condition only decides
// (`head` is true for it). An
// initializer's or a switch expression's braces stay inside their statement, and a lambda's block has
// statements of its own.
function statementRanges(text) {
  const ranges = [], frames = [{ block: true, depth: 0, head: false }];
  let start = 0;
  const cut = (end, next, head = false) => {
    if (/\S/.test(text.slice(start, end))) ranges.push([start, end, head]);
    start = next;
  };
  for (let index = 0; index < text.length; index++) {
    const character = text[index], frame = frames.at(-1);
    if (character === "(" || character === "[") {
      if (character === "(" && frame.block && !frame.depth) frame.head = CONTROL_HEADS.has(/(\w+)\s*$/.exec(text.slice(Math.max(0, index - 20), index))?.[1]);
      frame.depth++;
    } else if (character === ")" || character === "]") {
      if (frame.depth) frame.depth--;
      if (!frame.depth && frame.head) { frame.head = false; cut(index + 1, index + 1, true); }
    } else if (character === "{") {
      const block = opensBlock(text, index);
      frames.push({ block, depth: 0, head: false });
      if (block) cut(index, index + 1);
    } else if (character === "}") {
      const closed = frames.length > 1 ? frames.pop() : frame;
      if (closed.block) cut(index, index + 1);
    } else if (character === ";" && frame.block && !frame.depth) cut(index + 1, index + 1);
  }
  cut(text.length, text.length);
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
    if (!["and", "or", "not", "when", "with", "switch", "is", "as", "in"].includes(match[1])) bindings.push({ name: match[1], offset: match.index });
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
  const namedRead = (names) => new RegExp(String.raw`(?<![\w@.])(?:this\s*\.\s*)?@?(?:${names.map((name) => name.replace(/^@/, "")).join("|")})\b(?=\s*!?\s*\??\s*\.\s*(?:${fields})\b)`, "g");
  for (const [index, [from, to]] of members.entries()) {
    const names = [...new Set([...wide, ...bindings.filter((binding) => rangeOf(binding.offset) === index).map((binding) => binding.name)])];
    if (!names.length) continue;
    for (const match of text.slice(from, to).matchAll(namedRead(names))) reads.push(from + match.index);
  }
  for (const match of text.matchAll(new RegExp(String.raw`\((?=\s*\(\s*${adapterType}\s*\??\s*\))`, "g"))) {
    const close = matchingCSharpDelimiter(text, match.index);
    if (close > 0 && member.test(text.slice(close + 1, close + 100))) reads.push(match.index);
  }
  for (const match of text.matchAll(new RegExp(String.raw`\bas\s+${adapterType}\s*\??\s*\)`, "g"))) {
    const close = match.index + match[0].length - 1;
    if (member.test(text.slice(close + 1, close + 100))) reads.push(match.index);
  }
  for (const match of text.matchAll(new RegExp(String.raw`\bnew\s+${adapterType}\s*\(`, "g"))) {
    const close = matchingCSharpDelimiter(text, match.index + match[0].length - 1);
    if (close > 0 && member.test(text.slice(close + 1, close + 100))) reads.push(match.index);
  }
  return reads;
}

// A statement that declares or assigns `name` (by default any, captured): `var status = …`, `int status = …`,
// `status = …`, not `status == …` or `status => …`. The match ends just past the `=`.
const assigns = (name = String.raw`(@?[A-Za-z_]\w*)`) => new RegExp(String.raw`^\s*(?:(?:var|[A-Za-z_][\w.<>?,[\]]*)\s+)?${name}\s*=(?![=>])`);
const LOCAL_FROM_READ = assigns();

// The [from, to) ranges of the lambdas and expression-bodied local functions in `text` that take `name` as a
// parameter (`name => …`, `(item, name) => …`, `int Show(int name) => …`), each with its body: the name is
// theirs there.
function lambdasTaking(text, name) {
  const ranges = [], parameter = new RegExp(String.raw`(?<![\w@.])@?${name}\b`);
  for (const arrow of text.matchAll(/=>/g)) {
    let at = arrow.index - 1, from = -1;
    while (at >= 0 && /\s/.test(text[at])) at--;
    if (text[at] === ")") {
      for (let depth = 0, index = at; index >= 0; index--) {
        if (text[index] === ")") depth++;
        else if (text[index] === "(" && !--depth) { from = index; break; }
      }
      if (from < 0 || !parameter.test(text.slice(from, at))) continue;
    } else {
      const single = /@?[A-Za-z_]\w*$/.exec(text.slice(Math.max(0, at - 100), at + 1));
      if (!single || single[0].replace(/^@/, "") !== name) continue;
      from = at + 1 - single[0].length;
    }
    let body = arrow.index + 2;
    while (/\s/.test(text[body] ?? "")) body++;
    const to = text[body] === "{" ? matchingCSharpDelimiter(text, body) + 1 : statementEnd(text, body, ";,");
    ranges.push([from, to > 0 ? to : text.length]);
  }
  return ranges;
}

// Where a type's or a file's own code copies the adapter output's Value or StatusCode out: the reads that share
// a statement with a result it builds or a response it writes (`controller`: with a controller's own helpers
// too). A read reaches further through what holds it, chains included:
// - a local declared or assigned from a read (`var status = adapted.StatusCode;`, then `new ObjectResult(null) {
//   StatusCode = status }`), up to the name's next assignment or declaration in its member; a named argument's
//   label (`statusCode: 500`) and a lambda's own parameter of that name are not the local;
// - a member that returns a read (`int Status() => adapted.StatusCode;`, `return adapted.Value;`): its calls in
//   the type (`Status()`, `this.Status()`), and its nested types' too (`nested`, each `{ type, returns }`: a
//   pattern for the nested type's name and the members it hands reads back through) where the receiver is clear: a
//   name bound to the nested type, `new Reader(adapted).Body()`, a cast, or `Reader.Body(adapted)`.
// A filter may read them (Rivet's doc says so), and a statement that only logs or branches on them, beside
// another that sets `context.Result`, copies nothing. `perMember` says whether `text` is a type's (scoped per
// member) or top-level code (one scope). Returns the copies' offsets, and the names of the type's members that
// return a read (for the types around it). Known limits: a property pattern's bindings (`{ StatusCode: var status
// }`), a read through IStatusCodeActionResult, and an interpolated string's holes (masked) are not seen.
function adapterCopies(text, adapterType, { controller = false, perMember = true, nested = [] } = {}) {
  const own = withoutTypeMentions(text);
  const scopes = perMember ? memberRanges(own) : [[0, own.length]];
  const reads = new Set(adapterReads(own, adapterType, scopes));
  for (const { type, returns } of nested) {
    const fields = returns.join("|");
    for (const offset of adapterReads(own, type, scopes, fields)) reads.add(offset);
    for (const match of own.matchAll(new RegExp(String.raw`${type}\s*\.\s*(?:${fields})\b`, "g"))) reads.add(match.index);
  }
  if (!reads.size) return { copies: [], returns: [] };
  const statements = statementRanges(own).filter(([, , head]) => !head);
  const holds = (from, to) => [...reads].some((offset) => from <= offset && offset < to);
  const locals = new Set(), returns = new Map();
  for (let size = -1; size !== reads.size;) {
    size = reads.size;
    for (const [start, end] of statements) {
      const local = !locals.has(start) && holds(start, end) && LOCAL_FROM_READ.exec(own.slice(start, end));
      const scope = local && scopes.find(([from, to]) => from <= start && start < to);
      if (!scope) continue;
      locals.add(start);
      const name = local[1].replace(/^@/, "");
      const until = statements.find(([from, to]) => end <= from && from < scope[1] && assigns(String.raw`@?${name}\b`).test(own.slice(from, to)))?.[0] ?? scope[1];
      const window = own.slice(end, until), shadowed = lambdasTaking(window, name);
      for (const match of window.matchAll(new RegExp(String.raw`(?<![\w@.])@?${name}\b(?!\s*=(?!=))`, "g"))) {
        const label = /[(,]\s*$/.test(window.slice(Math.max(0, match.index - 50), match.index)) && /^\s*:(?!:)/.test(window.slice(match.index + match[0].length));
        if (!label && !shadowed.some(([from, to]) => from <= match.index && match.index < to)) reads.add(end + match.index);
      }
    }
    for (const [index, [from, to]] of scopes.entries()) {
      const head = perMember && index && !returns.has(from) && /^[^;{}()=]*?(?<![\w@])(@?[A-Za-z_]\w*)\s*(?:<[^<>()]*>\s*)?(\(|=>|\{)/.exec(own.slice(from, to));
      if (!head) continue;
      const at = from + head[0].length - head[2].length, close = head[2] === "(" ? matchingCSharpDelimiter(own, at) : at - 1;
      const body = close < 0 ? null : memberBody(own, close + 1);
      if (!body || !returnedRanges(own, body).some(([start, end]) => holds(start, end))) continue;
      const name = head[1].replace(/^@/, "");
      returns.set(from, name);
      const call = head[2] === "(" ? String.raw`\s*(?:<[^<>()]*>\s*)?\(` : String.raw`\b(?!\s*(?:=(?!=)|\(|:(?!:)))`;
      for (const match of own.matchAll(new RegExp(String.raw`(?<![\w@.])(?:this\s*\.\s*)?@?${name}${call}`, "g"))) reads.add(match.index);
    }
  }
  const copies = statements.flatMap(([start, end]) => {
    const inside = [...reads].filter((offset) => start <= offset && offset < end);
    const statement = own.slice(start, end);
    return inside.length && (COPIES_INTO.test(statement) || (controller && CONTROLLER_HELPER.test(statement))) ? inside : [];
  });
  return { copies, returns: [...new Set(returns.values())] };
}

const rv007 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-RV-007", source }),
  requirements: [Capability.CSHARP, Capability.DOTNET_PROJECTS],
  analyze(context) {
    const modifiers = /^(?:(?:public|internal|private|protected|static|async|new|unsafe|extern|partial|override|virtual|sealed|readonly)\s+)*/;
    const extension = /\bstatic\b([^;{}()=]*?)\s+([A-Za-z_]\w*)\s*(?:<\s*\w+(?:\s*,\s*\w+)*\s*>)?\s*\(\s*this\s+(?:global::)?(?:\w+\.)*RivetResult\b/g;
    // Rivet's own namespace, `Rivet` itself, is where its adapters and their output belong; `Rivet.Shims` in an
    // app's tree is the app's.
    const inRivet = (namespace) => namespace === "Rivet";
    // RivetActionResult is what Rivet's .ToActionResult() returns, and an alias names it too: a file's own `using
    // Adapted = Rivet.RivetActionResult;`, or one global to its project, the way the type resolver scopes them (a
    // `global using` in any file of the same project, or a <Using Alias> in its .csproj or Directory.Build.props).
    const namesAdapter = (target) => /^(?:\w+\.)*RivetActionResult$/.test(target);
    const sourceAliases = new Map(), projectAliases = new Map();
    for (const file of context.csharp.csharpFiles) {
      const key = context.dotnetProjects.nearestProject(file)?.path ?? "";
      for (const using of context.csharp.usings(file)) {
        if (!using.global || !using.alias || !namesAdapter(using.target)) continue;
        if (!sourceAliases.has(key)) sourceAliases.set(key, []);
        sourceAliases.get(key).push(using.alias);
      }
    }
    const aliasesOf = (project) => {
      const key = project?.path ?? "";
      if (!projectAliases.has(key)) {
        const items = project ? [project.file, ...context.dotnetProjects.propsFor(project)].flatMap((file) => context.csharp.projectUsings(file)) : [];
        projectAliases.set(key, [...(sourceAliases.get(key) ?? []), ...items
          .filter((using) => using.alias && !using.static && namesAdapter(using.target) && (project.metadataIsTest || !using.testOnly))
          .map((using) => using.alias)]);
      }
      return projectAliases.get(key);
    };
    // A file's own alias reaches the namespace block it's written in (nested blocks too), or the whole file when
    // it's written outside any; `offset` is where the name is used, -1 for top-level statements.
    const adapterTypeIn = (file, namespaces, offset) => {
      const reaches = (using) => {
        const scope = namespaces.findLast((candidate) => candidate.start <= using.offset && using.offset < candidate.end);
        return !scope || (scope.start <= offset && offset < scope.end);
      };
      const local = context.csharp.usings(file).filter((using) => !using.global && using.alias && namesAdapter(using.target) && reaches(using)).map((using) => using.alias);
      const aliases = [...new Set([...aliasesOf(context.dotnetProjects.nearestProject(file)), ...local])];
      return String.raw`(?<![\w@.])(?:(?:global\s*::\s*)?(?:[A-Za-z_]\w*\s*\.\s*)*RivetActionResult${aliases.map((alias) => `|${alias}`).join("")})\b`;
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
      // Tests may read the adapter's output to assert on it.
      const testCode = isCSharpTestCode(context, file);
      const bodies = types.map((type, index) => ownText(type.start, type.end, index + 1));
      // Each app type's copies, nested types first: the members a nested type returns a read through reach the
      // types around it.
      const copies = [];
      for (let index = types.length - 1; index >= 0 && !testCode; index--) {
        const type = types[index];
        if (inRivet(type.namespace)) continue;
        const nested = copies.flatMap((inner, at) => at > index && inner.returns.length && types[at].end <= type.end
          ? [{ type: String.raw`(?<![\w@.])(?:[A-Za-z_]\w*\s*\.\s*)*${types[at].name}\b`, returns: inner.returns }] : []);
        copies[index] = adapterCopies(bodies[index], adapterTypeIn(file, namespaces, type.offset), {
          controller: isController(type.name, text.slice(type.offset, type.end).split(/[{;]/)[0]), nested,
        });
      }
      for (const [index, type] of types.entries()) {
        if (inRivet(type.namespace)) continue;
        const body = bodies[index];
        const bridges = [], namesakes = [];
        for (const match of body.matchAll(extension)) {
          const [, returnType, name] = match;
          if (adapts(body, match.index + match[0].lastIndexOf("("))) continue;
          if (returnsHttpResult(returnType.trim().replace(modifiers, ""))) bridges.push(name);
          else if (/^To(?:Action)?Result$/.test(name)) namesakes.push(name);
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
      const adapterType = adapterTypeIn(file, namespaces, -1);
      // Top-level code (top-level statements, and anything outside a type): once per line that copies. Using
      // directives read nothing.
      const usings = context.csharp.usings(file).map((using) => [using.offset, using.end]);
      const lines = new Set();
      for (const offset of adapterCopies(blanked(ownText(0, text.length, 0), usings), adapterType, { perMember: false }).copies) {
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
