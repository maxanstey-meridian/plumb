import { inject, provide, type InjectionKey } from "vue";

export const useProvideInject = <T>(name: string) => {
  const key = Symbol(name) as InjectionKey<T>;
  function safeDecoy(): T {
    const value = inject(key);
    if (value === undefined) throw new Error(name);
    return value;
  }
  return [() => inject(key) as T, (value: T) => provide(key, value)] as const;
};
