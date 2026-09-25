export interface RectLike {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export type Direction = "up" | "down" | "left" | "right";

export interface FocusCandidate {
  id: string;
  rect: RectLike;
}

function center(rect: RectLike): { x: number; y: number } {
  return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
}

/**
 * Geometry-only nearest-neighbor search: given the currently-focused
 * candidate and a direction, returns the id of whichever other candidate is
 * the best next focus target, or null if none exists in that direction.
 *
 * A candidate only qualifies if it's actually positioned in the requested
 * direction from the current one (its center is strictly past the current
 * center along that axis). Among qualifying candidates, we minimize a
 * weighted distance that favors staying aligned on the cross axis (so
 * moving down in a grid prefers the tile directly below over one that's
 * closer only because it's diagonally adjacent).
 */
export function findNextFocusTarget(
  candidates: FocusCandidate[],
  currentId: string,
  direction: Direction,
): string | null {
  const current = candidates.find((c) => c.id === currentId);
  if (!current) return null;
  const from = center(current.rect);

  let best: { id: string; score: number } | null = null;

  for (const candidate of candidates) {
    if (candidate.id === currentId) continue;
    const to = center(candidate.rect);
    const dx = to.x - from.x;
    const dy = to.y - from.y;

    let primary: number;
    let cross: number;
    switch (direction) {
      case "up":
        if (dy >= 0) continue;
        primary = -dy;
        cross = Math.abs(dx);
        break;
      case "down":
        if (dy <= 0) continue;
        primary = dy;
        cross = Math.abs(dx);
        break;
      case "left":
        if (dx >= 0) continue;
        primary = -dx;
        cross = Math.abs(dy);
        break;
      case "right":
        if (dx <= 0) continue;
        primary = dx;
        cross = Math.abs(dy);
        break;
    }

    // Weight cross-axis deviation heavily so alignment wins over raw
    // Euclidean distance, but primary-axis distance still breaks ties
    // between equally-aligned candidates.
    const score = cross * 3 + primary;
    if (!best || score < best.score) {
      best = { id: candidate.id, score };
    }
  }

  return best?.id ?? null;
}
