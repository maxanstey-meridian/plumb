export const useProvideInject = <T>(key: string) => [() => ({} as T), (_v: T) => {}] as const;
