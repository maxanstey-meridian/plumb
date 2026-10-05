import { provideAuth } from "../../app/pages/x/ports/auth";

export const mountWithAuth = () => provideAuth(createFakeAuth());
