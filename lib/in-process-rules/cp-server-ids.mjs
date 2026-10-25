import { Capability, createRuleDescriptor, defineRepositoryRule } from "../engine/contracts.mjs";
import { isCSharpTestCode, isGenerated, isTestScript, report, under, walk } from "./helpers.mjs";
import { parseTemplateExpression, templateExpressions } from "./vue-template.mjs";

const source = "in-process/cp-server-ids.mjs";
const serverRulesRef = "frontend-pa-vsa.md#server-rules-stay-on-the-server";
// An id worth matching: a word-like token, not a route, sentence or format string.
const ID_VALUE = /^[A-Za-z][A-Za-z0-9_.-]{2,}$/;
const SCRIPT = /\.(?:[cm]?ts|vue)$/;
// `public const string XId`, also with the `new` modifier before or after `public`.
const SERVER_ID = /\b(?:public\s+(?:new\s+)?|new\s+public\s+)const\s+string\s+([A-Z]\w*Id)\s*=\s*"/g;

// A test double kept in the backend (a fake connector the dev seed wires in) owns nothing the UI reads.
// The doctrine's test-double prefixes only: `Test…` names production types too (`TestIntegrationConnectionUseCase`).
const TEST_DOUBLE = /^(?:Fake|InMemory|Inline)[A-Z]/;

// `public const string <Name>Id = "<value>"` in non-test backend code (by test project, folder or file name),
// outside test doubles: what the server owns, by value, with its qualified name (the enclosing type chain) for
// the message.
function serverIds(context) {
  const ids = new Map();
  for (const file of context.csharp.csharpFiles) {
    if (!context.csharp.classify(file).backendRoot || isCSharpTestCode(context, file)) continue;
    const masked = context.csharp.mask(file, { preserveStringDelimiters: true });
    const text = file.text();
    for (const match of masked.matchAll(SERVER_ID)) {
      const start = match.index + match[0].length;
      const value = text.slice(start, masked.indexOf('"', start));
      if (!ID_VALUE.test(value) || ids.has(value)) continue;
      const owners = context.csharp.enclosingTypes(file, match.index);
      if (owners.some((owner) => TEST_DOUBLE.test(owner))) continue;
      ids.set(value, [...owners, match[1]].join("."));
    }
  }
  return ids;
}

// A MIME type ("text/csv", "application/json;charset=utf-8"): a format, not a path, though its subtype can spell an id.
const MIME_TYPE = /^(?:application|audio|font|image|message|model|multipart|text|video)\/[\w!#$&^.+-]+(?:;.*)?$/i;
// A path: a literal, or a template literal's piece, holding a `/`. Whitespace and MIME types are judged on `whole`,
// the full string (templateText): "Choose import/export" and `Choose ${mode}/export` are wording, "text/csv" a format.
// A value bound to a link (`link`: `to`, `href`, as boundAttribute reads it) is a path without a `/` and even when
// MIME-shaped: `to="?integration=acme-crm"` builds the link, and `to="text/acme-crm"` is a relative one.
const isPath = (text, whole = text, link = false) =>
  (link || text.includes("/")) && !/\s/.test(whole) && (link || !MIME_TYPE.test(whole));

// The template literal a piece (its head, a middle or its tail) belongs to.
const templateOf = (ts, piece) => (ts.isTemplateHead(piece) ? piece.parent : piece.parent.parent);

// A template literal's text pieces: its head, then each substitution's following text.
const piecesOf = (template) => [template.head, ...template.templateSpans.map((span) => span.literal)];

// A template literal's text with each substitution standing as `x`, from any of its pieces: whole for isPath.
const templateText = (ts, piece) => piecesOf(templateOf(ts, piece)).map((part) => part.text).join("x");

// A string value's first text, past a template literal's leading substitutions: "" when it is only substitutions
// (`` `${base}` ``, `` `${a}${b}` ``). `value` is unwrapped (isLabel).
const leadingText = (ts, value) =>
  (ts.isTemplateExpression(value) ? piecesOf(value) : [value]).find((piece) => piece.text !== "")?.text ?? "";

// A `#` that starts a fragment: one not followed by `/`, which starts a hash-mode route (`#/crm/acme-crm`).
const FRAGMENT = /#(?!\/)/;

// The server id a frontend literal copies: the whole literal, or one whole segment of a path or one of its query
// values (`/crm?integration=acme-crm`), in the URL and in a hash-mode route after it (`/#/crm/acme-crm`), a route
// too. A query parameter's name (`/invite?email=…`, `?export=1`, `?export`, `&csv`) names a parameter, not an id,
// and a fragment (`#acme-crm`, FRAGMENT) only scrolls to an element, presentation like the `id="acme-crm"` it names,
// so neither is read; the path and query before a fragment are. `path` is the caller's isPath verdict, judged on the
// whole string (a template's piece "text/acme-crm" in `${base}text/acme-crm` is a path, though alone it reads as a
// MIME type).
function copiedId(ids, literal, path) {
  if (ids.has(literal)) return literal;
  if (!path) return null;
  return literal.split(FRAGMENT)[0].split("#")
    .flatMap((url) => {
      const [route, ...query] = url.split(/[?&]/);
      return [route, ...query.filter((part) => part.includes("="))];
    })
    .flatMap((part) => part.split("/"))
    .map((segment) => segment.slice(segment.indexOf("=") + 1))
    .find((segment) => ids.has(segment)) ?? null;
}

const CLIENT_METHOD = /^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE)$/;

// The path handed to the generated openapi-fetch client (`api.GET("/api/people/{id}/export")`): the
// client types it against the schema, so it names an endpoint rather than keeping a copy of a rule.
function isClientPath(ts, node) {
  const call = node.parent;
  return !!call && ts.isCallExpression(call) && call.arguments[0] === node &&
    ts.isPropertyAccessExpression(call.expression) && CLIENT_METHOD.test(call.expression.name.text);
}

// A name that says its value is an id rather than wording, by its last word (camelCase, kebab-case or
// snake_case, with `Id` split off an acronym): `handlerId`, `handler-id`, `data-kind`, `integrationKey`,
// `externalCRMId`. `valid`, `typeface`, `typeLabel`, `data-testid`, `noun` and `subject` don't, so an
// id-valued word given to them is presentation; nor do test hooks (`data-test-id`, `testId`, `data-qa-id`),
// whose value is a selector the tests read. A hook is `test`/`qa` + `id` alone: `abTestId` is an id. A name
// ending `By…` is judged before it (`labelsByKind` holds labels).
const ID_WORDS = new Set(["id", "ids", "uuid", "uuids", "guid", "guids", "handler", "handlers", "kind", "kinds", "type", "types", "key", "keys"]);
const TEST_HOOK_WORDS = new Set(["test", "qa"]);
const words = (name) =>
  name.split(/[-_:\s]+|(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z]{2})|(?<=[A-Z])(?=Ids?$)/).map((word) => word.toLowerCase());
const isTestHook = (parts) => {
  const hook = parts[0] === "data" ? parts.slice(1) : parts;
  return hook.length === 2 && TEST_HOOK_WORDS.has(hook[0]) && /^ids?$/.test(hook[1]);
};
const isIdName = (name) => {
  const all = words(name);
  const by = all.lastIndexOf("by");
  const parts = by > 0 ? all.slice(0, by) : all;
  return ID_WORDS.has(parts.at(-1)) && !isTestHook(parts);
};
// An attribute holds a link or an id by its name. A bare `id` is the DOM id on every tag (a component passes it
// through to its element), and Vue reserves `key` on every element, so neither names a server id. HTML's own `type`
// on a native HTML or SVG element doesn't either, though a component's `type` prop can, unless the component is an
// input or button (`UInput`, `UButton`) and the `type` is one of HTML's input or button types, which it passes to
// its element.
const LINK_ATTRIBUTE = new Set(["to", "href"]);
const HTML_TYPES = new Set(["button", "checkbox", "color", "date", "datetime-local", "email", "file", "hidden", "image", "month",
  "number", "password", "radio", "range", "reset", "search", "submit", "tel", "text", "time", "url", "week"]);
const isInputComponent = (tag) => /(?:Input|Button|Btn)$|-(?:input|button|btn)$/.test(tag ?? "");
function isIdAttribute(name, element, value) {
  if (LINK_ATTRIBUTE.has(name)) return true;
  const bare = name.toLowerCase();
  if (bare === "key" || bare === "id") return false;
  if (bare === "type" && (element.native || (isInputComponent(element.tag) && HTML_TYPES.has(value)))) return false;
  return isIdName(name);
}
// `:class` and `:style` objects key on class names and CSS properties, not ids.
const PRESENTATION_BINDING = new Set(["class", "style"]);

const EQUALITY = ["EqualsEqualsEqualsToken", "ExclamationEqualsEqualsToken", "EqualsEqualsToken", "ExclamationEqualsToken"];
const FALLBACK = ["QuestionQuestionToken", "BarBarToken"];
const ASSIGNMENT = ["EqualsToken", "QuestionQuestionEqualsToken", "BarBarEqualsToken", "AmpersandAmpersandEqualsToken"];
const isOperator = (ts, binary, kinds) => kinds.some((kind) => binary.operatorToken.kind === ts.SyntaxKind[kind]);
const MEMBERSHIP = new Set(["includes", "has", "indexOf"]);
const isMembership = (ts, callee) => ts.isPropertyAccessExpression(callee) && MEMBERSHIP.has(callee.name.text);
const KEYED = new Set(["get", "set"]);
const isKeyed = (ts, callee) => ts.isPropertyAccessExpression(callee) && KEYED.has(callee.name.text);
const REF = new Set(["ref", "shallowRef"]);
const isRefCall = (ts, call, value) =>
  ts.isCallExpression(call) && call.arguments[0] === value && ts.isIdentifier(call.expression) && REF.has(call.expression.text);
const COLLECTION = new Set(["Set", "Map"]);
const isNewCollection = (ts, node, value, names = COLLECTION) =>
  ts.isNewExpression(node) && node.arguments?.[0] === value && ts.isIdentifier(node.expression) && names.has(node.expression.text);
const MAP = new Set(["Map"]);
const isWrapper = (ts, node) =>
  ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) ||
  ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node);
// `node` with the parentheses, `as`, `satisfies`, `!` and `<T>x` around it, which pass it through unchanged.
const wrapped = (ts, node) => {
  let value = node;
  while (value.parent && isWrapper(ts, value.parent)) value = value.parent;
  return value;
};
// `node` without the parentheses, `as`, `satisfies`, `!` and `<T>x` around it.
const unwrapped = (ts, node) => {
  let value = node;
  while (value && isWrapper(ts, value)) value = value.expression;
  return value;
};
// A route: a path (isPath) that starts with `/`, `./`, `../` or `#/` (`"/settings/crm"`, `"../crm"`, a hash-mode
// `"#/settings/crm"`, though a fragment, `"#export"`, is no route: FRAGMENT), or a URL, full or
// protocol-relative (`"https://acme.example/connect"`, `"//acme.example"`); in a template literal, its first text
// after any leading substitutions does (leadingText: `` `/settings/${tab}` ``, `` `${base}/crm` ``, `` `${a}${b}/crm`
// ``). A `/` alone doesn't make one: "Read/Write" is wording. Nor does a file, whose last path segment (before any `?`
// or `#`, past a URL's host) ends in a web asset's extension (`"/logos/acme.svg"`, `` `${base}/acme.png` ``,
// `"/exports/acme.csv"`): an owner-accepted trade-off, since a link to a file (an image, font, script, document or
// archive) is an asset or a download, not a route. Any other dot is part of the route: a name (`"/users/john.doe"`) or
// a version (`"/docs/crm/1.10"`). `value` is unwrapped (isLabel).
const ASSET_EXTENSIONS = new Set([
  "svg", "png", "jpg", "jpeg", "gif", "webp", "avif", "ico", "bmp", // images
  "woff", "woff2", "ttf", "otf", "eot", // fonts
  "css", "js", "mjs", "map", // styles and scripts
  "json", "xml", "txt", "csv", "pdf", "zip", // data and documents
  "mp3", "mp4", "webm", "wav", "ogg", // media
]);
const URL_ORIGIN = /^(?:[a-z][a-z0-9+.-]*:)?\/\/[^/?#]*/i;
const isAsset = (text) => {
  const segment = text.replace(URL_ORIGIN, "").split(/[?#]/)[0].split("/").at(-1);
  return ASSET_EXTENSIONS.has(segment.match(/\.([^.]+)$/)?.[1].toLowerCase());
};
const isRoute = (ts, value) => {
  const start = leadingText(ts, value);
  const text = ts.isTemplateExpression(value) ? templateText(ts, value.head) : value.text;
  return (/^(?:\.{0,2}|#)\//.test(start) || URL_ORIGIN.test(start)) && isPath(text) && !isAsset(text);
};
// A label: a translation call (`t("acme")`, `$t("acme")`, `i18n.t("acme")`), a value whose every result is a label
// (both branches of `busy ? "Connecting" : "Acme CRM"`, both sides of `??` and `||`, through `as const`, `<const>`,
// `!` and parentheses; a `null` or `undefined` result is no answer either way, so `isBeta ? "Beta" : undefined` is a
// label while `null ?? undefined` isn't), or a string value (`"Acme CRM"`, `"Read/Write"`, `` `${name} CRM` ``) that is
// neither a server id (`ids`) nor a route (isRoute). A template literal of only substitutions (`` `${base}` ``) holds
// whatever they do, so it is no label. Mapping a server value to a string label, colour or icon is presentation, so a
// key mapped to one is no copy. A string naming a component (`{ "acme-crm": "AcmeCrmPanel" }`) is a label too: the
// accepted reading, since Nuxt dispatches on the imported component, and a key mapped to that (`{ "acme-crm":
// AcmeCrmPanel }`) is flagged as dispatch. A key mapped to anything else is a
// table of what each id may do, where it routes or which panel renders it: a copied rule, flagged, since the DTO
// should name the capability, route or panel. That covers `true`, `["export"]`, another id (`{ "acme-crm":
// "export" }`), a route (`{ "acme-crm": "/settings/crm" }`), the imported component, and a number (`{ "acme-crm":
// 1 }`), whether it is an ordering or a limit, since a limit is a rule. A value is judged by whether it equals an
// id, not by what it means, so a label that happens to equal one (`new Map([["csv", "export"]])`, "export" an id) is
// flagged too: a deliberate trade-off, since a table routing one id to another is the real harm.
const TRANSLATE = new Set(["t", "$t"]);
const isTranslation = (ts, value) => ts.isCallExpression(value) &&
  ((ts.isIdentifier(value.expression) && TRANSLATE.has(value.expression.text)) ||
    (ts.isPropertyAccessExpression(value.expression) && TRANSLATE.has(value.expression.name.text)));
const isNullish = (ts, value) => value.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(value) && value.text === "undefined");
const isLabel = (ts, ids, node) => {
  if (!node) return false;
  const answers = results(ts, node, isBranch).filter((value) => !isNullish(ts, value));
  return answers.length > 0 && answers.every((value) => isLabelValue(ts, ids, value));
};
// One result of a value (isLabel): a translation, or a string with text that is neither an id nor a route.
const isLabelValue = (ts, ids, value) => {
  if (isTranslation(ts, value)) return true;
  if (!(ts.isTemplateExpression(value) || ts.isStringLiteralLike(value))) return false;
  if (ts.isTemplateExpression(value) && leadingText(ts, value) === "") return false;
  return !isRoute(ts, value) && !isIdLiteral(ts, ids, value);
};
// A string literal (unwrapped) that is a server id.
const isIdLiteral = (ts, ids, value) => !!value && ts.isStringLiteralLike(value) && ids.has(value.text);
// A quoted or computed property name that is a server id: `{ "acme-crm": … }`, `{ ["acme-crm"]: … }`.
const isIdKey = (ts, ids, name) => isIdLiteral(ts, ids, ts.isComputedPropertyName(name) ? name.expression : name);
// An unquoted key that is a server id with a server id among its value's results (passesThrough: `{ csv: "export" }`,
// `{ csv: ["export"] }`, `{ email: flag ? "export" : "csv" }`): an id-to-id map, both sides copies. An unquoted key is
// otherwise a field name (`{ email: true }`, `{ csv: "Comma separated" }`), so it counts only beside an id.
const isIdPair = (ts, ids, property) =>
  ts.isIdentifier(property.name) && ids.has(property.name.text) && hasIdResult(ts, ids, property.initializer);
// Whether a server id is among a value's results (passesThrough).
const hasIdResult = (ts, ids, value) => !!value && results(ts, value, passesThrough).some((result) => isIdLiteral(ts, ids, result));
// An entry of the list given to `new Map(…)` or `Object.fromEntries(…)` (`["csv", ["export"]]`, also `as const` or
// with the list `satisfies` a type). Its elements are judged where they stand: its key, element 0, like a quoted
// object key (an id key when its value isn't a label, however the result is used), and its value, element 1, by its
// key (isIdPosition).
const isMapEntry = (ts, array) => {
  const list = wrapped(ts, array).parent;
  if (!list || !ts.isArrayLiteralExpression(list)) return false;
  const argument = wrapped(ts, list);
  return isNewCollection(ts, argument.parent, argument, MAP) || isFromEntries(ts, argument.parent, argument);
};
const isFromEntries = (ts, call, value) =>
  ts.isCallExpression(call) && call.arguments[0] === value && ts.isPropertyAccessExpression(call.expression) &&
  call.expression.name.text === "fromEntries" && ts.isIdentifier(call.expression.expression) && call.expression.expression.text === "Object";

// Whether `parent` is a branch that results in `value` as it is: parentheses, `as`, `satisfies`, `!` or `<T>x`
// around it, either branch of a conditional (not its condition), or either side of `??` and `||`.
const isBranch = (ts, parent, value) =>
  (isWrapper(ts, parent) && parent.expression === value) ||
  (ts.isConditionalExpression(parent) && (parent.whenTrue === value || parent.whenFalse === value)) ||
  (ts.isBinaryExpression(parent) && (parent.left === value || parent.right === value) && isOperator(ts, parent, FALLBACK));
// Whether `parent` passes `value` through unchanged as one of its possible results: a branch (isBranch), the right
// side of `&&`, an array literal's element (not a Map entry's, isMapEntry, judged where it stands), the list given to
// `new Set(…)`/`new Map(…)`, and `ref(…)`'s initial value (what holds the ref decides).
const passesThrough = (ts, parent, value) =>
  isBranch(ts, parent, value) ||
  (ts.isBinaryExpression(parent) && parent.right === value && isOperator(ts, parent, ["AmpersandAmpersandToken"])) ||
  (ts.isArrayLiteralExpression(parent) && !isMapEntry(ts, parent)) ||
  isNewCollection(ts, parent, value) || isRefCall(ts, parent, value);

// The expression a literal stands as, through what `follows` (passesThrough, or isBranch) passes up.
function outermost(ts, node, follows = passesThrough) {
  let value = node;
  while (value.parent && follows(ts, value.parent, value)) value = value.parent;
  return value;
}

// The values `node` can result in, outermost's reading top down: the expressions `follows` (isBranch or
// passesThrough) passes up to it, each standing as `node` (`busy ? "export" : ["csv"]` results in "export" and
// either `["csv"]` or, through the array, "csv").
function results(ts, node, follows) {
  const found = [];
  const visit = (value) => {
    let passes = false;
    ts.forEachChild(value, (child) => {
      if (!follows(ts, value, child)) return;
      passes = true;
      visit(child);
    });
    if (!passes) found.push(value);
  };
  visit(node);
  return found;
}

// The top-level object of an argument-less `v-bind="{…}"` or `v-on="{…}"`, also through a branch or fallback
// (`v-bind="cond ? { id: x } : {}"`, as outermost reads it), not a nested one (`{ meta: { handlerId: x } }`). Its keys
// are attribute or event names, not an id-keyed table, and a `v-bind` object's value is its key's attribute value
// (`v-bind="{ to: x }"` is `:to="x"`). `template` is isIdPosition's.
const BARE_OBJECT_DIRECTIVES = new Set(["bind", "on"]);
const isBareObject = (ts, object, template) =>
  !!template?.whole && !template.hasArgument && BARE_OBJECT_DIRECTIVES.has(template.directive) &&
  outermost(ts, object) === template.whole;

// The names a file binds, anywhere in it (scope-free), to a router, to a router's navigation methods, or to search
// params: `const r = useRouter()`, `const { push, replace: go } = useRouter()` or `= r` (any router isRouter knows),
// `const params = new URLSearchParams()` or `= url.searchParams`. A Vue file's script names are its template's too.
function boundNames(ts, sourceFiles) {
  const names = { routers: new Set(), navigators: new Set(), searchParams: new Set() };
  for (const sourceFile of sourceFiles) {
    walk(ts, sourceFile, (node) => {
      if (!ts.isVariableDeclaration(node) || !node.initializer) return;
      const value = unwrapped(ts, node.initializer);
      if (isUseRouter(ts, value) && ts.isIdentifier(node.name)) names.routers.add(node.name.text);
      if (ts.isObjectBindingPattern(node.name) && isRouter(ts, value, names)) {
        for (const element of node.name.elements) {
          const method = propertyName(ts, element.propertyName ?? element.name);
          if (NAVIGATION.has(method) && ts.isIdentifier(element.name)) names.navigators.add(element.name.text);
        }
      }
      if (isSearchParams(ts, value, names) && ts.isIdentifier(node.name)) names.searchParams.add(node.name.text);
    });
  }
  return names;
}

// A call that navigates to its first argument as a link's `to` would: `navigateTo(x)`, a router's navigation method
// bound by name (boundNames: `push(x)` from `const { push } = useRouter()`), and `.push(x)`, `.replace(x)` or
// `.resolve(x)` on a router (one bound from `useRouter()`, `useRouter()` itself, or by its name: `router`, `$router`,
// `this.$router`, `appRouter`), not on an array.
const NAVIGATION = new Set(["push", "replace", "resolve"]);
const isUseRouter = (ts, node) => ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "useRouter";
const isRouter = (ts, node, names) => {
  if (isUseRouter(ts, node) || (ts.isIdentifier(node) && names.routers.has(node.text))) return true;
  const name = ts.isIdentifier(node) ? node.text : ts.isPropertyAccessExpression(node) ? node.name.text : "";
  return words(name.replace(/^\$/, "")).at(-1) === "router";
};
const isNavigation = (ts, value, names) => {
  const call = value.parent;
  if (!call || !ts.isCallExpression(call) || call.arguments[0] !== value) return false;
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text === "navigateTo" || names.navigators.has(callee.text);
  return ts.isPropertyAccessExpression(callee) && NAVIGATION.has(callee.name.text) && isRouter(ts, callee.expression, names);
};

// A query, as `URLSearchParams` builds it: `new URLSearchParams(…)`, a URL's `searchParams`, or a name bound to
// either (boundNames). Its values build a URL or query the UI builds, like a route location's `query` does: the
// initial value (`new URLSearchParams("integration=x")`, `[["integration", x]]`, or `{ integration: x }`'s values)
// and the value `.set` or `.append` writes (`url.searchParams.set("integration", x)`). Its parameters' names are
// queryName's.
const URL_SEARCH_PARAMS = new Set(["URLSearchParams"]);
const SEARCH_WRITES = new Set(["set", "append"]);
const SEARCH_NAMED = new Set(["set", "get", "getAll", "has", "append"]);
const isSearchParams = (ts, node, names) =>
  (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && URL_SEARCH_PARAMS.has(node.expression.text)) ||
  (ts.isPropertyAccessExpression(node) && node.name.text === "searchParams") ||
  (ts.isIdentifier(node) && names.searchParams.has(node.text));
const isSearchInit = (ts, value) => !!value.parent && isNewCollection(ts, value.parent, value, URL_SEARCH_PARAMS);
const isSearchWrite = (ts, value, names) => {
  const call = value.parent;
  return !!call && ts.isCallExpression(call) && call.arguments[1] === value && ts.isPropertyAccessExpression(call.expression) &&
    SEARCH_WRITES.has(call.expression.name.text) && isSearchParams(ts, call.expression.expression, names);
};
// A query parameter's name (`node`, a literal or an unquoted key) where URLSearchParams takes one: `.set`, `.get`,
// `.getAll`, `.has` or `.append`'s first argument on search params (`url.searchParams.set("email", x)`,
// `params.has("email")`), an initial object's key (`new URLSearchParams({ email: x })`) or an initial entry's element 0
// (`[["email", x]]`). Returns `{ value }`, the value given with it (none for `.get`, `.getAll` or `.has`): a name counts
// only beside an id value, as an unquoted key does (isIdPair). Undefined when `node` names no parameter.
function queryName(ts, node, names) {
  const name = wrapped(ts, node);
  const parent = name.parent;
  if (!parent) return undefined;
  if (ts.isCallExpression(parent) && parent.arguments[0] === name && ts.isPropertyAccessExpression(parent.expression) &&
      SEARCH_NAMED.has(parent.expression.name.text) && isSearchParams(ts, parent.expression.expression, names)) {
    return { value: parent.arguments[1] };
  }
  const key = ts.isComputedPropertyName(parent) ? parent : name;
  if (key.parent && ts.isPropertyAssignment(key.parent) && key.parent.name === key && isSearchInit(ts, outermost(ts, key.parent.parent))) {
    return { value: key.parent.initializer };
  }
  if (ts.isArrayLiteralExpression(parent) && parent.elements[0] === name && ts.isArrayLiteralExpression(wrapped(ts, parent).parent) &&
      isSearchInit(ts, outermost(ts, parent))) {
    return { value: parent.elements[1] };
  }
  return undefined;
}

// A route location's part that is its link's text: its `path` (a `hash` only scrolls, as copiedId reads a fragment).
// And those whose values build it: `params` and `query`.
const LOCATION_TEXT = new Set(["path"]);
const ROUTE_VALUES = new Set(["params", "query"]);
// The link a route location (`location`, an object) is bound to, if it is a link's.
const locationLink = (ts, location, template, names) => {
  const link = boundAttribute(ts, outermost(ts, location), template, names);
  return LINK_ATTRIBUTE.has(link) ? link : undefined;
};

// The attribute an expression (`value`, as outermost reads it) is bound to as its value: a template's whole
// expression (`:to="'x'"`, also through a branch) is its attribute's, a bare `v-bind` object's value its key's
// (isBareObject), a navigation call's first argument (isNavigation) and a search params value (isSearchParams) are
// `to`'s, and the `path` of a route location bound to a link (`:to="{ path: x }"`, `v-bind="{ to: { path: x } }"`,
// `router.push({ path: x })`), or a value of its `params` or `query` (`:to="{ name: 'crm', params: { integration: x }
// }"`), is that link's. A value of a request's `query` (isRequestOptions, or ofetch's `params`, its alias) builds the
// request's URL, so it is `to`'s too. Undefined elsewhere, and for a whole expression bound to no attribute.
// `template` is isIdPosition's, undefined in a script; `names` the file's (boundNames).
function boundAttribute(ts, value, template, names) {
  if (isNavigation(ts, value, names) || isSearchInit(ts, value) || isSearchWrite(ts, value, names)) return "to";
  if (template?.whole && value === template.whole) return template.name;
  const parent = value.parent;
  if (!parent || !ts.isPropertyAssignment(parent) || parent.initializer !== value) return undefined;
  const key = propertyName(ts, parent.name);
  if (template?.directive === "bind" && isBareObject(ts, parent.parent, template)) return key;
  if (LOCATION_TEXT.has(key)) return locationLink(ts, parent.parent, template, names);
  const part = outermost(ts, parent.parent);
  if (isSearchInit(ts, part)) return "to";
  const holder = part.parent;
  if (!holder || !ts.isPropertyAssignment(holder) || holder.initializer !== part || !ROUTE_VALUES.has(propertyName(ts, holder.name))) {
    return undefined;
  }
  if (isRequestOptions(ts, outermost(ts, holder.parent))) return "to";
  return locationLink(ts, holder.parent, template, names);
}

// The options a request call takes as its second argument: `$fetch(url, { query })`, `useFetch(url, { query })`,
// `useLazyFetch(url, { query })`.
const REQUESTS = new Set(["$fetch", "useFetch", "useLazyFetch"]);
const isRequestOptions = (ts, options) => {
  const call = options.parent;
  return !!call && ts.isCallExpression(call) && call.arguments[1] === options && ts.isIdentifier(call.expression) &&
    REQUESTS.has(call.expression.text);
};

// A property's name as text, reading a computed string (`["handlerId"]`) as the name it spells.
const propertyName = (ts, name) =>
  ts.isComputedPropertyName(name) ? (ts.isStringLiteralLike(name.expression) ? name.expression.text : "") : (name.text ?? "");

// The name an assignment's target holds its value under: a bare variable's (or a ref's, `tab.value`) holds
// it whatever its name, like an initialiser; a property or element (`state.handlerId`, `el["title"]`) by
// its own name; an element at a computed index (`kinds[i]`, `state.kinds[i]`, a ref's `kinds.value[i]`) by its
// collection's name.
function holdsAsId(ts, target) {
  if (ts.isIdentifier(target)) return true;
  if (ts.isPropertyAccessExpression(target)) {
    return (target.name.text === "value" && ts.isIdentifier(target.expression)) || isIdName(target.name.text);
  }
  if (!ts.isElementAccessExpression(target)) return false;
  if (ts.isStringLiteralLike(target.argumentExpression)) return isIdName(target.argumentExpression.text);
  let collection = target.expression;
  if (ts.isPropertyAccessExpression(collection) && collection.name.text === "value" && ts.isIdentifier(collection.expression)) collection = collection.expression;
  return isIdName(ts.isIdentifier(collection) ? collection.text : ts.isPropertyAccessExpression(collection) ? collection.name.text : "");
}

// An element written at a server id's index (`table["acme-crm"] = x`, isLabel's `ids`).
const isIdIndex = (ts, ids, target) => ts.isElementAccessExpression(target) && isIdLiteral(ts, ids, unwrapped(ts, target.argumentExpression));
// The assignment that writes an element access (`table[key] = x`), if one does.
const assignmentTo = (ts, access) => {
  const target = wrapped(ts, access);
  const write = target.parent;
  return write && ts.isBinaryExpression(write) && write.left === target && isOperator(ts, write, ASSIGNMENT) ? write : undefined;
};
// `.set(key, value)` on a table, as isKeyed reads it.
const isSet = (ts, call) => isKeyed(ts, call.expression) && call.expression.name.text === "set";

// isIdPosition's answer for a key a table is built on (a property name, a Map entry's key, `.set`'s first argument,
// an index assigned to), which may still map the id to labels, colours or icons; `true` is any other id position.
const TABLE_KEY = "table key";

// Where a literal equal to an id is the UI's copy of it rather than wording. The literal stands as its
// outermost expression, which is the copy when it's compared (`===`, `in`, `case`, `.includes`/`.has`/
// `.indexOf` either way round), held (a variable, parameter, enum or static field initialiser, an assignment or
// instance field by the name it's held under, a property under an id-named key), used as a key (read by index or
// `.get`, or a table's key, TABLE_KEY, whose value isn't a label: `.set`'s first argument, an index assigned to, or a
// quoted, computed or Map entry (isMapEntry) key; or an unquoted key with an id among its value's results, isIdPair),
// a query parameter's name beside an id value (queryName), the value under a
// key that is itself a server id (both ids of `{ "acme-crm": "acme-webhook" }`, `{ csv: "export" }`, a Map entry,
// `.set("acme-crm", "acme-webhook")` or `table["acme-crm"] = "acme-webhook"` are copies), or a value bound to an
// id-named attribute or a link (boundAttribute: a template's whole expression, a bare `v-bind` object's value judged
// by its key as an attribute, a navigation call's argument, a search params value, a route location's `path`,
// `params` or `query` under a link, or a request's `query`). Returned or passed to a plain call (`pluralise(count, "export")`), it's
// wording. `ids` are the server's (isLabel) and `names` the file's (boundNames); `template` is the parsed template
// expression, the attribute (`name`, `tag`, `native`) it's bound to, and its `directive` and `hasArgument`.
function isIdPosition(ts, ids, names, node, template) {
  const query = queryName(ts, node, names);
  if (query) return hasIdResult(ts, ids, query.value);
  const value = outermost(ts, node);
  const parent = value.parent;
  if (!parent) return false;
  const attribute = boundAttribute(ts, value, template, names);
  if (attribute !== undefined) return isIdAttribute(attribute, template, node.text);
  // A `:class`/`:style` key is a class name or CSS property, and a bare `v-bind`/`v-on` object's an attribute or event.
  const property = ts.isComputedPropertyName(parent) ? parent.parent : parent;
  const bare = ts.isPropertyAssignment(property) && isBareObject(ts, property.parent, template);
  const isKey = !PRESENTATION_BINDING.has(template?.name) && !bare;
  if (ts.isBinaryExpression(parent)) {
    return isOperator(ts, parent, EQUALITY) || (parent.left === value && isOperator(ts, parent, ["InKeyword"])) ||
      (parent.right === value && isOperator(ts, parent, ASSIGNMENT) &&
        (holdsAsId(ts, parent.left) || isIdIndex(ts, ids, unwrapped(ts, parent.left))));
  }
  if (ts.isCaseClause(parent)) return parent.expression === value;
  if (ts.isCallExpression(parent)) {
    if (parent.arguments[0] === value && isKeyed(ts, parent.expression)) {
      return !isSet(ts, parent) || (!isLabel(ts, ids, parent.arguments[1]) && TABLE_KEY);
    }
    if (parent.arguments[1] === value && isSet(ts, parent)) return isIdLiteral(ts, ids, unwrapped(ts, parent.arguments[0]));
    return parent.arguments.includes(value) && isMembership(ts, parent.expression);
  }
  if (ts.isPropertyAccessExpression(parent)) {
    return parent.expression === value && isMembership(ts, parent) && !!parent.parent &&
      ts.isCallExpression(parent.parent) && parent.parent.expression === parent;
  }
  if (ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isBindingElement(parent) ||
      ts.isEnumMember(parent)) return parent.initializer === value;
  if (ts.isPropertyDeclaration(parent)) {
    return parent.initializer === value &&
      (!!parent.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword) || isIdName(propertyName(ts, parent.name)));
  }
  if (ts.isShorthandPropertyAssignment(parent)) return parent.objectAssignmentInitializer === value;
  if (ts.isPropertyAssignment(parent)) {
    if (parent.name === value) {
      return isKey && (ts.isIdentifier(value) ? isIdPair(ts, ids, parent) : !isLabel(ts, ids, parent.initializer)) && TABLE_KEY;
    }
    // The value of an id-to-id pair (isIdPair) is this literal under an unquoted id key: judged on the literal alone,
    // as walking the whole value (results) for each of its literals is quadratic in a long list.
    const underIdName = ts.isIdentifier(parent.name) && ids.has(parent.name.text) && ids.has(node.text);
    return isIdName(propertyName(ts, parent.name)) || (isKey && (isIdKey(ts, ids, parent.name) || underIdName));
  }
  if (ts.isComputedPropertyName(parent)) {
    return isKey && !(ts.isPropertyAssignment(parent.parent) && isLabel(ts, ids, parent.parent.initializer)) && TABLE_KEY;
  }
  // A Map entry's (isMapEntry) key, element 0, like a quoted key, and its value, element 1, by its key.
  if (ts.isArrayLiteralExpression(parent) && isMapEntry(ts, parent)) {
    if (parent.elements[0] === value) return isKey && !isLabel(ts, ids, parent.elements[1]) && TABLE_KEY;
    return parent.elements[1] === value && isKey && isIdLiteral(ts, ids, unwrapped(ts, parent.elements[0]));
  }
  if (ts.isElementAccessExpression(parent)) {
    if (parent.argumentExpression !== value) return false;
    const write = assignmentTo(ts, parent);
    return !write || (!isLabel(ts, ids, write.right) && TABLE_KEY);
  }
  return false;
}

// Each literal that could copy a server id: a path anywhere, and a whole literal, or an unquoted key (isIdPair), only
// in an id position. A template literal's piece past a fragment's `#` (FRAGMENT) is the fragment's (copiedId). The
// string given to `new URLSearchParams(…)`, also through a branch, is a query from its start (`"export&tab=1"`), so
// copiedId reads it after a `?`. `visit` gets the literal's text, its isPath verdict, for copiedId, and whether it is a
// table's key (TABLE_KEY). A query parameter's name (queryName) is no link's value. `ids`, `names` and `template` are
// isIdPosition's.
function literalsIn(ts, ids, names, sourceFile, visit, template) {
  walk(ts, sourceFile, (node) => {
    if (ts.isIdentifier(node)) {
      if (!node.parent || !ts.isPropertyAssignment(node.parent) || node.parent.name !== node) return;
      const position = isIdPosition(ts, ids, names, node, template);
      if (position) visit(node, node.text, false, position === TABLE_KEY);
      return;
    }
    const isText = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
    if (!isText && !ts.isTemplateHead(node) && !ts.isTemplateMiddle(node) && !ts.isTemplateTail(node)) return;
    // Type positions never count. A literal type (`kind: "export" | "form"`), a template literal type or an
    // interface member name is only a type; a value compared against it is flagged where that value is written.
    if (ts.findAncestor(node.parent, (ancestor) => ts.isTypeNode(ancestor) || ts.isTypeElement(ancestor))) return;
    if (isText) {
      const parent = node.parent;
      if (parent && (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isExternalModuleReference(parent))) return;
      if (parent && ts.isCallExpression(parent) && parent.expression.kind === ts.SyntaxKind.ImportKeyword) return;
      if (isClientPath(ts, node)) return;
    } else {
      const pieces = piecesOf(templateOf(ts, node));
      if (pieces.slice(0, pieces.indexOf(node)).some((piece) => FRAGMENT.test(piece.text))) return;
    }
    const literal = isText ? node : templateOf(ts, node);
    const link = !(isText && queryName(ts, node, names)) &&
      LINK_ATTRIBUTE.has(boundAttribute(ts, outermost(ts, literal), template, names));
    const path = isPath(node.text, isText ? node.text : templateText(ts, node), link);
    const position = isText && isIdPosition(ts, ids, names, node, template);
    const query = (isText || ts.isTemplateHead(node)) && isSearchInit(ts, outermost(ts, literal, isBranch));
    if (path || position) visit(node, query ? `?${node.text}` : node.text, path, position === TABLE_KEY);
  });
}

async function scriptRepresentations(context, file) {
  if (!file.path.endsWith(".vue")) {
    const representation = await context.typescript.source(file);
    return representation ? [representation] : [];
  }
  return (await Promise.all(context.typescript.vueScripts(file).map((block) => context.typescript.vueSource(block)))).filter(Boolean);
}

// The UI keeping its own copy of an id the server owns: held, compared against, keyed on or built into a URL. It
// agrees today and drifts later; the DTO should carry it. A path counts anywhere, a whole literal only
// in an id position (isIdPosition, and id-named template attributes): the same word as UI wording
// (`noun: "export"`, `subject="export"`, `pluralise(count, "export")`) is presentation. A table keyed on a
// server id, a dispatch table included, is judged by its values (isLabel).
const cp001 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-CP-001", source }),
  requirements: [Capability.CSHARP, Capability.DOTNET_PROJECTS, Capability.TYPESCRIPT, Capability.FRONTEND_ROOTS],
  async analyze(context) {
    const ids = serverIds(context);
    if (!ids.size) return;
    const ts = await context.typescript.runtime();
    if (!ts) return;
    const seenFiles = new Set();
    for (const root of context.frontendRoots.withinDepth(6)) {
      for (const file of context.files) {
        if (!SCRIPT.test(file.path) || file.path.endsWith(".d.ts") || !under(file.path, root.appPath) ||
            isTestScript(context, file) || seenFiles.has(file.path) || isGenerated(file)) continue;
        seenFiles.add(file.path);
        const reported = new Set();
        const emit = (line, literal, path, tableKey = false) => {
          const id = copiedId(ids, literal, path);
          if (!id || reported.has(`${line}\0${id}`)) return;
          reported.add(`${line}\0${id}`);
          report(context, "warn", file.path, line,
            `"${id}" is the server's ${ids.get(id)}; keep no copy of it in the UI (comparing, holding, keying on or ` +
              "building a URL from it) — have the DTO carry the answer: availableActions, a named flag, the route, or the " +
              "id itself." + (tableKey ? " A table keyed on it may map it only to labels, colours or icons." : ""),
            serverRulesRef);
        };
        const representations = await scriptRepresentations(context, file);
        const names = boundNames(ts, representations.map((representation) => representation.sourceFile));
        for (const representation of representations) {
          literalsIn(ts, ids, names, representation.sourceFile, (node, literal, path, tableKey) =>
            emit(representation.lineOf(node), literal, path, tableKey));
        }
        if (!file.path.endsWith(".vue")) continue;
        for (const entry of templateExpressions(context, file, { attributes: true })) {
          // An attribute's whole value counts only when the attribute holds a link or an id (`to`, `href`,
          // `data-kind`, `handler-id`, a component's `type`, bound or static); `class`, `icon`, `subject`,
          // `noun` and any tag's `id` are presentation.
          if (entry.kind === "attribute") {
            if (isIdAttribute(entry.name, entry, entry.content)) {
              emit(entry.line, entry.content, isPath(entry.content, entry.content, LINK_ATTRIBUTE.has(entry.name)));
            }
            continue;
          }
          const parsed = parseTemplateExpression(ts, entry);
          literalsIn(ts, ids, names, parsed.sourceFile, (node, literal, path, tableKey) => emit(parsed.lineOf(node), literal, path, tableKey), {
            whole: parsed.whole, name: entry.name, tag: entry.tag, native: entry.native,
            directive: entry.directive, hasArgument: entry.hasArgument,
          });
        }
      }
    }
  },
});

export const cpRules = Object.freeze([cp001]);
