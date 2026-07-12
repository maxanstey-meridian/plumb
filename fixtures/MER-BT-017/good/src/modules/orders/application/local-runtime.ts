export const readLocalRuntime = (
  process: { env: Record<string, string> },
  Bun: { env: Record<string, string> },
  Deno: { env: { get(name: string): string } },
) => [process.env.ORDER_QUEUE, Bun.env.PORT, Deno.env.get("PORT")];
