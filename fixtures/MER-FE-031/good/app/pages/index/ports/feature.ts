import { useProvideInject } from "~/shared/composables/useProvideInject";
export interface Feature { run: () => void }
export const [injectFeature, provideFeature] = useProvideInject<Feature>("Feature");
