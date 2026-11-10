import { useProvideInject } from "../../shared/use-provide-inject";

export type Theme = { dark: boolean };

const [readTheme, installTheme] = useProvideInject<Theme>("Theme");

export { readTheme, installTheme };
