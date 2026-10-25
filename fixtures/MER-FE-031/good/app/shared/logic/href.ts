// Consumed only by app/components/, which Nuxt registers app-wide.
export const isSafeHref = (href: string) => /^https?:\/\//.test(href);
