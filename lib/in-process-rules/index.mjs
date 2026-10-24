import { btRules } from "./bt.mjs";
import { btTypescriptRules } from "./bt-typescript.mjs";
import { beCSharpRules } from "./be-csharp.mjs";
import { beTransportRules } from "./be-transport.mjs";
import { cpRules } from "./cp-server-ids.mjs";
import { dotnetRules } from "./dotnet-rules.mjs";
import { feGraphRules } from "./fe-graph-rules.mjs";
import { feRules } from "./fe.mjs";
import { feTemplateRules } from "./fe-template.mjs";
import { feTypeScriptRules } from "./fe-typescript.mjs";
import { rvRules } from "./rv.mjs";
import { rvCSharpRules } from "./rv-csharp.mjs";
import { rvResponseRules } from "./rv-responses.mjs";
import { teApiFixtureRules } from "./te-api-fixtures.mjs";
import { teRules } from "./te.mjs";
import { toCommentRules } from "./to-comments.mjs";
import { toRules } from "./to.mjs";
import { toTypeScriptRules } from "./to-typescript.mjs";

export const inProcessRules = Object.freeze([
  ...beCSharpRules,
  ...beTransportRules,
  ...cpRules,
  ...btRules,
  ...btTypescriptRules,
  ...feRules,
  ...feTypeScriptRules,
  ...feTemplateRules,
  ...feGraphRules,
  ...rvRules,
  ...rvCSharpRules,
  ...rvResponseRules,
  ...teRules,
  ...teApiFixtureRules,
  ...dotnetRules,
  ...toRules,
  ...toCommentRules,
  ...toTypeScriptRules,
]);
