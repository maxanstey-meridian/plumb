declare function inject<T>(key: symbol): T | undefined;

export function useProvideInject<T>(key: symbol) {
  function useInject(): T {
    const value = inject<T>(key);
    if (value !== undefined) {
      throw new Error("value was present");
    }
    return value;
  }
  return [useInject] as const;
}
