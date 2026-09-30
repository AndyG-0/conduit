/**
 * Swaps the positions of two ids in an order array. A no-op (returns the
 * same array reference) if either id is missing or they're the same id.
 */
export function swapIds(ids: string[], a: string, b: string): string[] {
  if (a === b) return ids;
  const indexA = ids.indexOf(a);
  const indexB = ids.indexOf(b);
  if (indexA === -1 || indexB === -1) return ids;

  const next = ids.slice();
  next[indexA] = b;
  next[indexB] = a;
  return next;
}

/**
 * Returns the id immediately after `id` in an order array, or null if `id`
 * is missing or already last. Used to translate an "insert after this tile"
 * drop target into the "insert before this id" shape `moveIdBefore` takes.
 */
export function idAfter(ids: string[], id: string): string | null {
  const index = ids.indexOf(id);
  if (index === -1 || index === ids.length - 1) return null;
  return ids[index + 1];
}

/**
 * Removes `movedId` from an order array and reinserts it immediately before
 * `beforeId` (or at the end if `beforeId` is null). A no-op (returns the
 * same array reference) if `movedId` is missing, `beforeId` doesn't exist in
 * the array, or the move wouldn't change anything.
 */
export function moveIdBefore(
  ids: string[],
  movedId: string,
  beforeId: string | null,
): string[] {
  const fromIndex = ids.indexOf(movedId);
  if (fromIndex === -1) return ids;
  if (beforeId !== null && !ids.includes(beforeId)) return ids;
  if (movedId === beforeId) return ids;

  const without = ids.slice(0, fromIndex).concat(ids.slice(fromIndex + 1));
  if (beforeId === null) {
    return [...without, movedId];
  }

  const insertAt = without.indexOf(beforeId);
  return [...without.slice(0, insertAt), movedId, ...without.slice(insertAt)];
}
