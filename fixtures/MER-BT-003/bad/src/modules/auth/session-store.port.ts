export abstract class SessionStore { private constructor() {} abstract save(): Promise<void>; }
