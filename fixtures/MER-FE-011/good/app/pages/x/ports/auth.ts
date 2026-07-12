export const [injectAuth, provideAuth] = useProvideInject<Auth>("Auth");
const [injectClock, provideClock] = (useProvideInject<Clock>("Clock") as readonly [() => Clock, (value: Clock) => void]);
export { injectClock, provideClock };
