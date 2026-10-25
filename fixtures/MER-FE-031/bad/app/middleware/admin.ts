import { loginPath } from "~/shared/logic/redirect";
export default (to: { path: string }) => loginPath(to.path);
