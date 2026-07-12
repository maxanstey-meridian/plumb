declare const schema: { parse(value: unknown): unknown };

export const config = schema.parse(process.env);
