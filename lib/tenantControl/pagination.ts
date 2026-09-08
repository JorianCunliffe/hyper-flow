export function readPage(query: any, fail: (message: string) => never) {
  const after = String(query?.after || ""),
    limit = query?.limit === undefined ? 50 : Number(query.limit);
  if (after && !/^[a-zA-Z0-9_-]{1,200}$/.test(after))
    fail("Invalid page cursor");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    fail("Page size must be 1 to 100");
  return { after, limit };
}
export function pageRows<T extends { id: string }>(rows: T[], limit: number) {
  return {
    rows: rows.slice(0, limit),
    next: rows.length > limit ? rows[limit - 1].id : null,
  };
}
