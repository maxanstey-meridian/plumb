import { provideAuth as installAuth } from "../ports/auth";
import * as authPort from "../ports/auth";

installAuth(createAuth());
authPort.provideAuth(createAuth());
