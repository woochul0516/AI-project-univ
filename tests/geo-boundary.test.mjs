import test from 'node:test';
import assert from 'node:assert/strict';
import { featureContainsPoint, findFeatureAtPoint } from '../geo-boundary.mjs';

const polygon = coordinates => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates } });
const outerRing = [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]];

test('행정 경계 안팎을 판정하고 바깥 경계선은 내부로 포함한다', () => {
  const feature = polygon([outerRing]);
  assert.equal(featureContainsPoint(feature, 2, 2), true);
  assert.equal(featureContainsPoint(feature, 2, 0), true);
  assert.equal(featureContainsPoint(feature, 5, 2), false);
  assert.equal(findFeatureAtPoint([feature], 2, 2), feature);
});

test('폴리곤 구멍 안은 제외하고 구멍 경계는 포함한다', () => {
  const hole = [[1, 1], [3, 1], [3, 3], [1, 3], [1, 1]];
  const feature = polygon([outerRing, hole]);
  assert.equal(featureContainsPoint(feature, 2, 2), false);
  assert.equal(featureContainsPoint(feature, 2, 1), true);
});

test('멀티폴리곤과 GeoJSON Feature geometry를 판정한다', () => {
  const feature = {
    type: 'Feature',
    geometry: {
      type: 'MultiPolygon',
      coordinates: [
        [outerRing],
        [[[10, 10], [12, 10], [12, 12], [10, 12], [10, 10]]],
      ],
    },
  };
  assert.equal(featureContainsPoint(feature, 11, 11), true);
  assert.equal(featureContainsPoint(feature, 7, 7), false);
  assert.equal(featureContainsPoint({ type: 'Point', coordinates: [2, 2] }, 2, 2), false);
});
