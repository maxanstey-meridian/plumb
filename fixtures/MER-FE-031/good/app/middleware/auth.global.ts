import { isPublicPath } from "~/shared/logic/guard";
export default (to: { path: string }) => isPublicPath(to.path);
