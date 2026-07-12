export const loadCatalog = (container: { get(id: string): unknown }) =>
  container.get("catalog");
