import { useProvideInject } from "../../app/shared/use-provide-inject";

export const [injectProbe, provideProbe] = useProvideInject<{ seen: boolean }>("Probe");

export const readProbe = () => injectProbe();
