const EPSILON = 1e-10;

function onSegment(point, start, end) {
  const cross = (point.lat - start[1]) * (end[0] - start[0]) -
    (point.lng - start[0]) * (end[1] - start[1]);
  if (Math.abs(cross) > EPSILON) return false;
  return point.lng >= Math.min(start[0], end[0]) - EPSILON &&
    point.lng <= Math.max(start[0], end[0]) + EPSILON &&
    point.lat >= Math.min(start[1], end[1]) - EPSILON &&
    point.lat <= Math.max(start[1], end[1]) + EPSILON;
}

function inRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const start = ring[j];
    const end = ring[i];
    if (onSegment(point, start, end)) return { inside: true, boundary: true };
    const crossesLatitude = (start[1] > point.lat) !== (end[1] > point.lat);
    if (crossesLatitude &&
        point.lng < ((end[0] - start[0]) * (point.lat - start[1])) / (end[1] - start[1]) + start[0]) {
      inside = !inside;
    }
  }
  return { inside, boundary: false };
}

function inPolygon(point, rings) {
  const outer = inRing(point, rings[0]);
  if (!outer.inside) return false;
  for (const hole of rings.slice(1)) {
    const result = inRing(point, hole);
    if (result.boundary) return true;
    if (result.inside) return false;
  }
  return true;
}

export function featureContainsPoint(feature, lat, lng) {
  const point = { lat, lng };
  const geometry = feature?.type === 'Feature' ? feature.geometry : feature;
  if (!geometry || !Array.isArray(geometry.coordinates)) return false;
  if (geometry.type === 'Polygon') return inPolygon(point, geometry.coordinates);
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.some(rings => inPolygon(point, rings));
  }
  return false;
}

export function findFeatureAtPoint(features, lat, lng) {
  return features.find(feature => featureContainsPoint(feature, lat, lng));
}
