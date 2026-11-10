import { useProvideInject } from "../../shared/use-provide-inject";

export type Clock = { now(): Date };

const [readClock, installClock] = useProvideInject<Clock>("Clock");

export { readClock, installClock };
