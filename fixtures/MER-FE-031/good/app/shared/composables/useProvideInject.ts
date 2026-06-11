// §7 exception: the useProvideInject helper is doctrine infrastructure, exempt
// from single-consumer promotion checks even when one root consumes it.
import { inject, provide, type InjectionKey } from "vue";
export const useProvideInject = <T>(key: string): [() => T, (v: T) => void] => {
  const k = Symbol(key) as InjectionKey<T>;
  return [() => inject(k) as T, (v: T) => provide(k, v)];
};
