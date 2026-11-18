import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INDUSTRIES, INDUSTRY_CATEGORIES, STORAGE_KEY, addCandidate, analyzeLocation, createCandidate, filterCandidates, formatWonToManwon,
  generateReport, readCandidates, sameCandidatePlace, writeCandidates,
} from '../analysis-model.mjs';

function candidate(id, overrides = {}) {
  return {
    id,
    label: `후보 ${id}`,
    industry: 'cafe',
    radius: 500,
    latitude: 37.39 + Number(id) * 0.002,
    longitude: 126.95,
    sales: 28000000,
    foot_traffic: 1200,
    accessibility_score: 82,
    mock: true,
    saved_at: `2026-11-18T00:00:0${id}.000Z`,
    ...overrides,
  };
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test('창업 업종 대분류와 세부 업종을 분석 코드로 지원한다', async () => {
  assert.deepEqual(INDUSTRY_CATEGORIES.map(category => [
    category.label,
    category.subcategories.map(subcategory => subcategory.label),
  ]), [
    ['한식', ['백반•가정식', '국밥•탕', '고기•구이', '족발•보쌈', '분식']],
    ['일식', ['초밥', '돈까스', '라멘•우동']],
    ['중식', ['짜장•짬뽕', '마라탕']],
    ['치킨', []],
    ['피자', []],
    ['햄버거', []],
  ]);
  const industryCodes = INDUSTRY_CATEGORIES.flatMap(category =>
    category.subcategories.map(subcategory => subcategory.code)
      .concat(category.subcategories.length ? [] : category.code));
  const results = await Promise.all(industryCodes.map(industry => analyzeLocation({
    industry, latitude: 37.39, longitude: 126.95, radius: 500,
  })));
  assert.equal(results.length, 13);
  assert.ok(results.every(result => result.mock && result.radius === 500));
  assert.equal(INDUSTRIES.find(industry => industry.code === 'japanese-sushi')?.label, '일식 · 초밥');

  const context = {
    location: { name: '범계역 일대', lat: 37.39, lng: 126.95 },
    industry: 'japanese-sushi',
    radius: 500,
  };
  const sushiResult = results[industryCodes.indexOf(context.industry)];
  const sushiCandidate = createCandidate(sushiResult, context);
  const saved = addCandidate([], sushiCandidate);
  assert.equal(saved[0].industry, context.industry);
  assert.equal(filterCandidates(saved, { ...context, mock: true }).length, 1);
  assert.equal(filterCandidates(saved, { ...context, industry: 'japanese-tonkatsu', mock: true }).length, 0);
  const report = await generateReport(context);
  assert.match(report.strengths, /일식 · 초밥/);
});

test('비교 목록은 조건과 무관하게 최대 3개까지 담을 수 있다', () => {
  const saved = [
    candidate('1'),
    candidate('2', { industry: 'korean' }),
    candidate('3', { radius: 1000 }),
  ];
  assert.equal(filterCandidates(saved, { industry: 'cafe', radius: 500, mock: true }).length, 1);
  assert.equal(addCandidate(saved.slice(0, 2), candidate('4', {
    industry: 'pizza', radius: 300,
  })).length, 3);
  assert.throws(() => addCandidate(saved, candidate('4', {
    industry: 'pizza', radius: 300,
  })), /비교 목록에는 후보지를 최대 3개/);
});

test('같은 조건의 근접 좌표 중복 저장을 막는다', () => {
  const saved = candidate('1');
  const nearby = candidate('2', { latitude: saved.latitude + 0.00005 });
  assert.equal(sameCandidatePlace(saved, nearby), true);
  assert.throws(() => addCandidate([saved], nearby), /이미 저장/);
});

test('비교 후보를 localStorage 형식으로 읽고 쓰며 손상 데이터를 알린다', () => {
  const storage = memoryStorage();
  const list = [candidate('1')];
  writeCandidates(storage, list);
  assert.deepEqual(readCandidates(storage), list);
  storage.setItem(STORAGE_KEY, '{broken');
  assert.throws(() => readCandidates(storage), /읽을 수 없습니다/);
  assert.throws(() => readCandidates(null), /저장 공간/);
});

test('가상 분석 응답의 금액 변환과 API 오류 시나리오를 검증한다', async () => {
  const result = await analyzeLocation({
    industry: 'cafe', latitude: 37.39, longitude: 126.95, radius: 500,
  });
  assert.equal(result.mock, true);
  assert.equal(result.radius, 500);
  assert.match(formatWonToManwon(result.sales), /^\d{1,3}(,\d{3})*$/);
  await assert.rejects(analyzeLocation({
    industry: 'cafe', latitude: 37.39, longitude: 126.95, radius: 500,
  }, { scenario: 'data_unavailable' }), /데이터가 없습니다/);
  await assert.rejects(analyzeLocation({
    industry: 'cafe', latitude: 37.39, longitude: 126.95, radius: 500,
  }, { scenario: 'model_unavailable' }), /모델 오류/);
  await assert.rejects(analyzeLocation({
    industry: 'cafe', latitude: 37.39, longitude: 126.95, radius: 500,
  }, { scenario: 'server_error' }), /서버 오류/);
  await assert.rejects(analyzeLocation({
    industry: 'cafe', latitude: 37.39, longitude: 126.95, radius: 500,
  }, { scenario: 'invalid_response' }), /응답 형식 오류/);
});

test('리포트 생성 실패는 기본 분석 결과와 분리된 오류다', async () => {
  const context = {
    location: { lat: 37.39, lng: 126.95, name: '범계역 일대' },
    industry: 'cafe',
    radius: 500,
  };
  const report = await generateReport(context);
  assert.equal(report.mock, true);
  assert.ok(report.strengths);
  await assert.rejects(generateReport(context, { scenario: 'report_error' }), /리포트 생성 오류/);
});

test('느린 분석은 취소할 수 있다', async () => {
  const controller = new AbortController();
  const request = analyzeLocation({
    industry: 'cafe', latitude: 37.39, longitude: 126.95, radius: 500,
  }, { signal: controller.signal, scenario: 'slow' });
  controller.abort();
  await assert.rejects(request, error => error.name === 'AbortError');
});
