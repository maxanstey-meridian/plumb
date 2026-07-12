export const [useAuth, provideAuth] = useProvideInject<Auth>("Auth");
const [injectClock, provideClock] = useProvideInject<Clock>("Clock");
export const [injectSession, provideAuthSession] = useProvideInject<Session>("Session");
export const [injectFlags, provideFlags] = makeTuple<Flags>("Flags");
export const [injectAudit, provideAudit, auditKey] = useProvideInject<Audit>("Audit");
