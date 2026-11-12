export interface RoutePoint {
  id: string;
  latitude: number;
  longitude: number;
}

const EARTH_RADIUS_METERS = 6_371_008.8;

export function haversineMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const toRadians = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * toRadians;
  const dLon = (b.longitude - a.longitude) * toRadians;
  const lat1 = a.latitude * toRadians;
  const lat2 = b.latitude * toRadians;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

function pathDistance(
  start: RoutePoint,
  points: readonly RoutePoint[],
): number {
  let total = 0;
  let previous = start;
  for (const point of points) {
    total += haversineMeters(previous, point);
    previous = point;
  }
  return total;
}

function reverseSegment<T>(
  points: readonly T[],
  from: number,
  to: number,
): T[] {
  return [
    ...points.slice(0, from),
    ...points.slice(from, to + 1).reverse(),
    ...points.slice(to + 1),
  ];
}

/**
 * Nearest-neighbour construction plus a bounded 2-opt pass. Deterministic for
 * a given input and start point, with O(n²) per pass and a hard cap so a
 * pathological day cannot pin a request thread.
 */
export function optimizeRoute<T extends RoutePoint>(
  start: { latitude: number; longitude: number },
  points: readonly T[],
  options: { maxTwoOptPoints?: number } = {},
): { ordered: T[]; totalDistanceMeters: number } {
  const remaining = [...points];
  const ordered: T[] = [];
  let cursor: RoutePoint = { id: "__start__", ...start };

  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < remaining.length; index += 1) {
      const distance = haversineMeters(cursor, remaining[index]!);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
    const [next] = remaining.splice(bestIndex, 1);
    if (!next) break;
    ordered.push(next);
    cursor = next;
  }

  const maxTwoOpt = options.maxTwoOptPoints ?? 25;
  let distance = pathDistance({ id: "__start__", ...start }, ordered);
  if (ordered.length > 2 && ordered.length <= maxTwoOpt) {
    let improved = true;
    let passes = 0;
    while (improved && passes < 4) {
      improved = false;
      passes += 1;
      for (let i = 0; i < ordered.length - 1; i += 1) {
        for (let j = i + 1; j < ordered.length; j += 1) {
          const candidate = reverseSegment(ordered, i, j);
          const candidateDistance = pathDistance(
            { id: "__start__", ...start },
            candidate,
          );
          if (candidateDistance + 1 < distance) {
            ordered.splice(0, ordered.length, ...candidate);
            distance = candidateDistance;
            improved = true;
          }
        }
      }
    }
  }

  return { ordered, totalDistanceMeters: Math.round(distance) };
}

/** Conservative urban driving estimate with a small per-stop service buffer. */
export function estimateDriveMinutes(meters: number, stops: number): number {
  const driving = meters / (32_000 / 60);
  return Math.max(0, Math.round(driving + stops * 4));
}
