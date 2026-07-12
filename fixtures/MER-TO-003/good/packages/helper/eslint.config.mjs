import { globalIgnores as ignoreGenerated } from "eslint/config";

const generated = ignoreGenerated(["generated/**"]);
export default [generated];
