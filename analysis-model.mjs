export const INDUSTRIES = Object.freeze([
  { code: 'cafe', label: '카페 · 디저트' },
  { code: 'korean', label: '한식 음식점' },
  { code: 'chicken', label: '치킨 · 패스트푸드' },
  { code: 'snack', label: '분식 · 간편식' },
]);

export const RADII = Object.freeze([300, 500, 1000]);
export const MAX_CANDIDATES = 3;
export const STORAGE_KEY = 'mildang-root-comparison-v1';

const INDUSTRY_FACTORS = Object.freeze({ cafe: 1, korean: 1.21, chicken: 0.86, snack: 0.79 });
const METRICS = Object.freeze([
  { key: 'sales', label: '예상 월매출', unit: '원' },
  { key: 'foot_traffic', label: '일평균 유동인구', unit: '명/일' },
  { key: 'accessibility_score', label: '접근성 지수', unit: '점' },
]);

export class AnalysisError extends Error {
  constructor(message, code = 'UNKNOWN') {
    super(message);
    this.name = 'AnalysisError';
    this.code = code;
  }
}

function abortError() {
  return new DOMException('요청이 취소되었습니다.', 'AbortError');
}

function delay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    function onAbort() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(abortError());
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function validateInput({ industry, latitude, longitude, radius }) {
  if (!INDUSTRY_FACTORS[industry]) throw new AnalysisError('지원하지 않는 업종입니다.', 'UNSUPPORTED_INDUSTRY');
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new AnalysisError('유효한 지도 위치를 선택해 주세요.', 'INVALID_LOCATION');
  }
  if (!RADII.includes(radius)) throw new AnalysisError('분석 반경을 다시 선택해 주세요.', 'INVALID_RADIUS');
}

function validateAnalysisResponse(response) {
  if (!response || response.status !== 'success' ||
      typeof response.sales !== 'number' || !Number.isFinite(response.sales) || response.sales < 0 ||
      !RADII.includes(response.radius)) {
    throw new AnalysisError('응답 형식 오류가 발생했습니다. 다시 시도해 주세요.', 'INVALID_RESPONSE');
  }
  return response;
}

export async function analyzeLocation(input, { signal, scenario = 'success' } = {}) {
  validateInput(input);
  await delay(scenario === 'slow' ? 2400 : 650, signal);

  const scenarioErrors = {
    data_unavailable: ['데이터가 없습니다. 다른 위치를 선택해 주세요.', 'DATA_UNAVAILABLE'],
    model_unavailable: ['예측 모델 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.', 'MODEL_UNAVAILABLE'],
    server_error: ['서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.', 'SERVER_ERROR'],
  };
  if (scenarioErrors[scenario]) {
    const [message, code] = scenarioErrors[scenario];
    throw new AnalysisError(message, code);
  }
  if (scenario === 'invalid_response') {
    return validateAnalysisResponse({ status: 'success', sales: 'invalid', radius: input.radius });
  }

  const { latitude, longitude, industry, radius } = input;
  const seed = Math.abs(Math.round(latitude * 100000) * 31 + Math.round(longitude * 100000) * 19 + radius);
  const scale = 1 + (radius - 500) / 5000;
  return validateAnalysisResponse({
    status: 'success',
    sales: Math.round(((2100 + (seed % 550) * 2) * INDUSTRY_FACTORS[industry] * scale) / 10) * 100000,
    competitor_count: seed % 13 === 0 ? null : 8 + (seed % 24),
    foot_traffic: seed % 7 === 0 ? null : 3200 + (seed % 14) * 530,
    accessibility_score: seed % 11 === 0 ? null : 58 + (seed % 36),
    radius,
    mock: true,
  });
}

export async function generateReport({ location, industry, radius }, { signal, scenario = 'success' } = {}) {
  if (!location || !INDUSTRY_FACTORS[industry] || !RADII.includes(radius)) {
    throw new AnalysisError('분석 조건을 확인한 뒤 다시 시도해 주세요.', 'INVALID_REQUEST');
  }
  await delay(scenario === 'report_error' ? 500 : 450, signal);
  if (scenario === 'report_error') {
    throw new AnalysisError('리포트 생성 오류입니다. 기본 분석 결과는 유지됩니다.', 'REPORT_FAILED');
  }
  return {
    mock: true,
    strengths: `${location.name} 인근 ${INDUSTRIES.find(item => item.code === industry).label} 입지를 검토하는 화면 확인용 샘플입니다.`,
    risks: `반경 ${radius}m 지표는 모두 가상 수치입니다. 실제 점포 현황과 임대료를 별도로 확인해야 합니다.`,
    strategy: '시간대별 수요와 주변 점포를 직접 조사하고, 임대료·인건비를 포함한 손익분기점을 계산해 보세요.',
  };
}

export function formatWonToManwon(value) {
  if (value === null || value === undefined) return '—';
  return Math.round(value / 10000).toLocaleString('ko-KR');
}

export function displayMoney(value) {
  if (value === null || value === undefined) return '—';
  const manwon = Math.round(value / 10000);
  return manwon >= 10000 ? `${(manwon / 10000).toFixed(1)}억 원` : `${manwon.toLocaleString('ko-KR')}만 원`;
}

export function metricText(value) {
  return value === null || value === undefined ? '자료 없음' : Number(value).toLocaleString('ko-KR');
}

function sameScenario(left, right) {
  return left.industry === right.industry &&
    left.radius === right.radius &&
    left.mock === right.mock;
}

export function sameCandidatePlace(left, right) {
  return sameScenario(left, right) &&
    Math.abs(left.latitude - right.latitude) < 0.00015 &&
    Math.abs(left.longitude - right.longitude) < 0.00015;
}

function isCandidate(value) {
  return value && typeof value.id === 'string' && typeof value.label === 'string' &&
    INDUSTRY_FACTORS[value.industry] && RADII.includes(value.radius) &&
    typeof value.mock === 'boolean' &&
    Number.isFinite(value.latitude) && Number.isFinite(value.longitude) &&
    Number.isFinite(value.sales) && value.sales >= 0 &&
    [value.foot_traffic, value.accessibility_score].every(metric =>
      metric === null || (typeof metric === 'number' && Number.isFinite(metric) && metric >= 0)) &&
    typeof value.saved_at === 'string';
}

export function readCandidates(storage) {
  if (!storage) throw new Error('브라우저 저장 공간을 사용할 수 없습니다.');
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('저장된 비교 목록을 읽을 수 없습니다. 목록을 초기화하고 다시 시도해 주세요.');
  }
  if (!Array.isArray(parsed) || !parsed.every(isCandidate)) {
    throw new Error('저장된 비교 목록의 형식이 올바르지 않습니다.');
  }
  return parsed;
}

export function writeCandidates(storage, candidates) {
  if (!storage) throw new Error('브라우저 저장 공간을 사용할 수 없습니다.');
  storage.setItem(STORAGE_KEY, JSON.stringify(candidates));
}

export function filterCandidates(candidates, filters) {
  return candidates.filter(item => sameScenario(item, filters))
    .sort((left, right) => right.saved_at.localeCompare(left.saved_at));
}

export function addCandidate(candidates, candidate) {
  if (!isCandidate(candidate)) throw new Error('저장할 분석 결과의 형식이 올바르지 않습니다.');
  const matching = filterCandidates(candidates, candidate);
  if (matching.length >= MAX_CANDIDATES) {
    throw new Error('같은 업종·반경에서는 후보지를 최대 3개까지 저장할 수 있습니다.');
  }
  if (candidates.some(item => sameCandidatePlace(item, candidate))) {
    throw new Error('같은 조건과 가까운 위치의 후보지가 이미 저장되어 있습니다.');
  }
  return [...candidates, candidate];
}

export function createCandidate(result, context) {
  return {
    id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
    label: context.location.name,
    industry: context.industry,
    radius: context.radius,
    latitude: context.location.lat,
    longitude: context.location.lng,
    sales: result.sales,
    foot_traffic: result.foot_traffic,
    accessibility_score: result.accessibility_score,
    mock: true,
    saved_at: new Date().toISOString(),
  };
}

export function scoreCandidates(candidates) {
  const maxima = Object.fromEntries(METRICS.map(({ key }) => [
    key,
    Math.max(0, ...candidates.map(item => item[key] ?? 0)),
  ]));
  return candidates.map(item => {
    const scores = METRICS.map(({ key }) => {
      const value = item[key];
      return Number.isFinite(value) && value >= 0 ?
        (maxima[key] ? value / maxima[key] * 100 : 0) : null;
    }).filter(value => value !== null);
    return {
      item,
      score: scores.length ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length) : null,
      dataCount: scores.length,
    };
  });
}

export const COMPARISON_METRICS = METRICS;
