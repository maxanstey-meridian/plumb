import { slugify } from "~/shared/logic/slug";
export const pageSlug = (title: string) => slugify(title);
