import {
  INDUSTRIES, RADII, MAX_CANDIDATES, COMPARISON_METRICS,
  addCandidate, analyzeLocation, createCandidate, displayMoney, filterCandidates,
  formatWonToManwon, generateReport, metricText, readCandidates, scoreCandidates,
  sameCandidatePlace, writeCandidates,
} from './analysis-model.mjs';
import { findFeatureAtPoint } from './geo-boundary.mjs';

const mapElement = document.getElementById('map');
const mapLoading = document.getElementById('map-loading');
const notice = document.getElementById('notice');
const noticeText = document.getElementById('notice-text');
const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('address-input');
const searchButton = document.getElementById('search-button');
const addressElement = document.getElementById('selection-address');
const dongElement = document.getElementById('dong-name');
const commercialAreaElement = document.getElementById('commercial-area');
const commercialAreaIdElement = document.getElementById('commercial-area-id');
const latitudeElement = document.getElementById('latitude');
const longitudeElement = document.getElementById('longitude');
const selectedCheck = document.getElementById('selected-check');
const industrySelect = document.getElementById('industry');
const analyzeButton = document.getElementById('analyze-button');
const analysisResult = document.getElementById('analysis-result');
const analysisLoading = document.getElementById('analysis-loading');
const analysisError = document.getElementById('analysis-error');
const analysisContent = document.getElementById('analysis-content');
const candidateList = document.getElementById('candidate-list');
const candidateCount = document.getElementById('candidate-count');
const compareButton = document.getElementById('compare-button');
const comparisonDialog = document.getElementById('comparison-dialog');
const reportDialog = document.getElementById('report-dialog');
const toastElement = document.getElementById('toast');

const storage = (() => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
})();
let candidates = [];
let storageNotice = '';
try {
  candidates = readCandidates(storage);
} catch (error) {
  storageNotice = error.message;
}

let map;
let marker;
let radiusCircle;
let geocoder;
let addressRequestId = 0;
let boundaryFeatures = [];
let commercialFeatures = [];
let boundariesReady = false;
let radius = 500;
let currentSelection = null;
let currentAnalysis = null;
let currentAnalysisContext = null;
let analysisController = null;
let reportController = null;
let analysisRequestId = 0;
let reportRequestId = 0;
let toastTimer;
let currentReport = null;

function setNotice(message, type = '') {
  notice.className = `notice${type ? ` ${type}` : ''}`;
  noticeText.textContent = message;
}

function showToast(message, type = 'success') {
  window.clearTimeout(toastTimer);
  toastElement.textContent = message;
  toastElement.className = `toast toast-${type}`;
  toastElement.hidden = false;
  toastTimer = window.setTimeout(() => { toastElement.hidden = true; }, 4200);
}

function setAnalyzeAvailability() {
  analyzeButton.disabled = !currentSelection || !boundariesReady || Boolean(analysisController);
}

function resetAnalysis() {
  analysisRequestId += 1;
  reportRequestId += 1;
  analysisController?.abort();
  reportController?.abort();
  analysisController = null;
  reportController = null;
  currentAnalysis = null;
  currentAnalysisContext = null;
  currentReport = null;
  analysisResult.hidden = false;
  analysisLoading.hidden = true;
  analysisError.hidden = true;
  analysisContent.hidden = true;
  reportDialog.querySelector('#report-content').hidden = true;
  reportDialog.querySelector('#report-error').hidden = true;
  reportDialog.querySelector('#report-loading').hidden = true;
  document.getElementById('generate-report').disabled = true;
  if (reportDialog.open) reportDialog.close();
  analysisResult.hidden = true;
  setAnalyzeAvailability();
  renderCandidates();
}

function formatCoordinate(value) {
  return Number(value).toFixed(6);
}

function updateSelection(position, address, dongName = '—') {
  const lat = position.getLat();
  const lng = position.getLng();
  marker.setPosition(position);
  marker.setMap(map);
  map.panTo(position);
  latitudeElement.textContent = formatCoordinate(lat);
  longitudeElement.textContent = formatCoordinate(lng);
  addressElement.textContent = address || '주소 정보를 찾을 수 없습니다.';
  addressElement.classList.toggle('empty', !address);
  dongElement.textContent = dongName;
  selectedCheck.hidden = false;
  currentSelection = {
    lat,
    lng,
    name: address || '지도에서 선택한 위치',
    dongName,
  };
  const area = updateCommercialArea(position);
  currentSelection.commercialArea = area.name;
  currentSelection.commercialAreaId = area.id;
  radiusCircle?.setMap(map);
  radiusCircle?.setPosition(position);
  radiusCircle?.setRadius(radius);
  setAnalyzeAvailability();
}

function findDongAt(position) {
  return findFeatureAtPoint(boundaryFeatures, position.getLat(), position.getLng());
}

function findCommercialAreasAt(position) {
  return commercialFeatures.filter(feature =>
    findFeatureAtPoint([feature], position.getLat(), position.getLng()));
}

function updateCommercialArea(position) {
  const areas = findCommercialAreasAt(position);
  if (areas.length === 0) {
    commercialAreaElement.textContent = '상권 경계 자료 없음';
    commercialAreaIdElement.textContent = '—';
    return { name: '상권 경계 자료 없음', id: '—' };
  }

  const names = [...new Set(areas.map(feature => feature.properties.areaName))];
  const types = [...new Set(areas.map(feature => feature.properties.areaType))];
  const ids = [...new Set(areas.flatMap(feature => feature.properties.salesAreaIds))]
    .sort((a, b) => Number(a) - Number(b));
  const name = `${names.join(' · ')} (${types.join('/')})`;
  const id = ids.length === 1 ? ids[0] : ids.length ? `후보: ${ids.join(', ')}` : '연결 ID 없음';
  commercialAreaElement.textContent = name;
  commercialAreaIdElement.textContent = id;
  commercialAreaIdElement.title = ids.length > 1 ? '상권명이 매출 자료에서 여러 ID와 일치해 하나로 특정할 수 없습니다.' : '';
  return { name, id };
}

function drawBoundaries() {
  const bounds = new kakao.maps.LatLngBounds();
  boundaryFeatures.forEach(feature => {
    const geometry = feature.geometry;
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    polygons.forEach(rings => {
      const paths = rings.map(ring => ring.map(([lng, lat]) => {
        const position = new kakao.maps.LatLng(lat, lng);
        bounds.extend(position);
        return position;
      }));
      new kakao.maps.Polygon({
        map,
        path: paths,
        strokeWeight: 2,
        strokeColor: '#245bff',
        strokeOpacity: 0.8,
        strokeStyle: 'solid',
        fillColor: '#245bff',
        fillOpacity: 0.1,
      });
    });
  });
  if (!bounds.isEmpty()) map.setBounds(bounds);
}

function drawCommercialBoundaries() {
  commercialFeatures.forEach(feature => {
    const geometry = feature.geometry;
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    polygons.forEach(rings => {
      const paths = rings.map(ring => ring.map(([lng, lat]) => new kakao.maps.LatLng(lat, lng)));
      const color = feature.properties.areaType === '골목' ? '#d98b43' : '#7560aa';
      new kakao.maps.Polygon({
        map,
        path: paths,
        strokeWeight: 1,
        strokeColor: color,
        strokeOpacity: 0.62,
        strokeStyle: 'solid',
        fillColor: color,
        fillOpacity: 0.08,
      });
    });
  });
}

function loadBoundaries() {
  setNotice('안양시 행정동 경계를 불러오고 있습니다.', 'loading');
  const loadGeoJSON = path => fetch(path).then(response => {
    if (!response.ok) throw new Error(`GeoJSON 요청 실패 (${response.status})`);
    return response.json();
  });
  Promise.all([
    loadGeoJSON('./data/geojson/anyang-si.geojson'),
    loadGeoJSON('./data/geojson/anyang-commercial-areas.geojson'),
  ])
    .then(([adminGeoJSON, commercialGeoJSON]) => {
      [adminGeoJSON, commercialGeoJSON].forEach(geojson => {
        if (geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features) || geojson.features.length === 0) {
          throw new Error('GeoJSON 형식이 올바르지 않습니다.');
        }
      });
      boundaryFeatures = adminGeoJSON.features;
      commercialFeatures = commercialGeoJSON.features;
      drawBoundaries();
      drawCommercialBoundaries();
      boundariesReady = true;
      setAnalyzeAvailability();
      setNotice('안양시 경계 안에서 위치를 선택하고, 상권 경계와 매출 ID를 확인할 수 있습니다.');
    })
    .catch(error => {
      boundariesReady = false;
      setAnalyzeAvailability();
      setNotice('경계 파일을 읽지 못했습니다. data/geojson의 GeoJSON 파일과 웹 서버 실행을 확인해 주세요.', 'error');
      console.error('Failed to load Anyang boundaries:', error);
    });
}

function reverseGeocode(position, dongName) {
  const requestId = ++addressRequestId;
  updateSelection(position, '주소를 확인하고 있습니다.', dongName);
  setNotice('선택한 위치의 주소를 확인하고 있습니다.', 'loading');
  geocoder.coord2Address(position.getLng(), position.getLat(), (result, status) => {
    if (requestId !== addressRequestId) return;
    if (status === kakao.maps.services.Status.OK && result.length) {
      const item = result[0];
      const address = item.road_address?.address_name || item.address?.address_name || '';
      updateSelection(position, address, dongName);
      setNotice(address ? '위치가 선택되었습니다.' : '위치는 선택했지만 주소 정보를 찾을 수 없습니다.', address ? 'success' : '');
    } else {
      updateSelection(position, '주소 정보를 찾을 수 없습니다. 좌표를 확인해 주세요.', dongName);
      setNotice('위치는 선택되었지만 해당 좌표의 주소를 확인하지 못했습니다.', 'error');
    }
  });
}

function initMap() {
  try {
    const center = new kakao.maps.LatLng(37.3943, 126.9568);
    map = new kakao.maps.Map(mapElement, { center, level: 7, minLevel: 1, maxLevel: 12 });
    marker = new kakao.maps.Marker({ position: center });
    radiusCircle = new kakao.maps.Circle({
      map: null,
      center,
      radius,
      strokeWeight: 2,
      strokeColor: '#245bff',
      strokeOpacity: 0.85,
      strokeStyle: 'shortdash',
      fillColor: '#245bff',
      fillOpacity: 0.08,
    });
    geocoder = new kakao.maps.services.Geocoder();
    kakao.maps.event.addListener(map, 'click', event => {
      if (!boundariesReady) {
        setNotice('안양시 경계 정보를 준비하고 있습니다. 잠시 후 다시 선택해 주세요.', 'loading');
        return;
      }
      const feature = findDongAt(event.latLng);
      if (!feature) {
        setNotice('안양시 경계 밖입니다. 안양시 안의 위치를 선택해 주세요.', 'error');
        return;
      }
      resetAnalysis();
      addressRequestId += 1;
      searchButton.disabled = false;
      const dongName = feature.properties.adm_nm.replace(/^경기도 /, '');
      reverseGeocode(event.latLng, dongName);
    });
    mapLoading.hidden = true;
    loadBoundaries();
  } catch (error) {
    mapLoading.hidden = true;
    mapElement.classList.add('map-unavailable');
    setNotice('지도를 초기화하지 못했습니다. 앱을 다시 불러오고 설정을 확인해 주세요.', 'error');
    console.error('Kakao map initialization failed:', error);
  }
}

function loadKakaoMaps() {
  const appKey = window.APP_CONFIG?.kakaoMapAppKey?.trim();
  if (!appKey) {
    mapLoading.hidden = true;
    mapElement.classList.add('map-unavailable');
    setNotice('카카오맵 키가 설정되지 않았습니다. config.js에 JavaScript 키를 입력해 주세요.', 'error');
    return;
  }

  if (window.kakao?.maps) {
    kakao.maps.load(initMap);
    return;
  }

  window.kakaoMapSdkFailed = () => {
    mapLoading.hidden = true;
    mapElement.classList.add('map-unavailable');
    setNotice('카카오맵 SDK를 불러오지 못했습니다. 네트워크와 등록 도메인을 확인해 주세요.', 'error');
  };
  const script = document.createElement('script');
  script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(appKey)}&libraries=services&autoload=false&onerror=kakaoMapSdkFailed`;
  script.async = true;
  script.onerror = window.kakaoMapSdkFailed;
  script.onload = () => {
    if (!window.kakao?.maps) {
      window.kakaoMapSdkFailed();
      return;
    }
    kakao.maps.load(initMap);
  };
  document.head.appendChild(script);
}

function currentFilters() {
  return { industry: industrySelect.value, radius, mock: true };
}

function renderCandidates() {
  const visible = filterCandidates(candidates, currentFilters());
  candidateCount.textContent = `${visible.length} / ${MAX_CANDIDATES}`;
  compareButton.disabled = visible.length < 2;
  candidateList.replaceChildren();
  if (visible.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'studio-tray-empty';
    empty.append('분석 결과를 담아보세요.');
    const hint = document.createElement('span');
    hint.textContent = '같은 업종·반경의 후보지를 최대 3개까지 비교할 수 있어요.';
    empty.append(hint);
    candidateList.append(empty);
    return;
  }

  visible.forEach((item, index) => {
    const card = document.createElement('article');
    card.className = 'studio-tray-item';
    const order = document.createElement('span');
    order.className = 'studio-item-index';
    order.textContent = String(index + 1).padStart(2, '0');
    const detail = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = INDUSTRIES.find(option => option.code === item.industry)?.label || item.industry;
    const location = document.createElement('span');
    location.textContent = `${item.label} · ${item.radius}m`;
    const sales = document.createElement('b');
    sales.textContent = displayMoney(item.sales);
    detail.append(title, location, sales);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'studio-icon-button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `${item.label} 후보지 삭제`);
    remove.addEventListener('click', () => {
      const next = candidates.filter(candidate => candidate.id !== item.id);
      try {
        writeCandidates(storage, next);
        candidates = next;
        renderCandidates();
      } catch (error) {
        showToast(error.message, 'error');
      }
    });
    card.append(order, detail, remove);
    candidateList.append(card);
  });
}

function updateSaveButton() {
  const saveButton = document.getElementById('save-candidate');
  if (!currentAnalysis || !currentAnalysisContext) return;
  const visible = filterCandidates(candidates, currentAnalysisContext);
  const duplicate = candidates.some(item => sameCandidatePlace(item, {
    industry: currentAnalysisContext.industry,
    radius: currentAnalysisContext.radius,
    mock: true,
    latitude: currentAnalysisContext.location.lat,
    longitude: currentAnalysisContext.location.lng,
  }));
  saveButton.disabled = duplicate || visible.length >= MAX_CANDIDATES;
  saveButton.textContent = duplicate ? '✓ 이미 저장됨' :
    visible.length >= MAX_CANDIDATES ? '저장 한도 3개' : '＋ 비교 목록에 추가';
}

function renderAnalysis(result, context) {
  currentAnalysis = result;
  currentAnalysisContext = context;
  const industryName = INDUSTRIES.find(item => item.code === context.industry)?.label || context.industry;
  document.getElementById('result-title').textContent = `${context.location.name} · ${industryName}`;
  document.getElementById('result-context').textContent = `화면 확인용 가상 추정 · 반경 ${context.radius}m`;
  document.getElementById('monthly-sales').textContent = formatWonToManwon(result.sales);
  document.getElementById('competitor-count').textContent = metricText(result.competitor_count);
  document.getElementById('foot-traffic').textContent = metricText(result.foot_traffic);
  document.getElementById('accessibility-score').textContent = metricText(result.accessibility_score);
  analysisLoading.hidden = true;
  analysisError.hidden = true;
  analysisContent.hidden = false;
  analysisResult.hidden = false;
  document.getElementById('generate-report').disabled = false;
  updateSaveButton();
  analysisResult.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function handleAnalyze() {
  if (!currentSelection || !boundariesReady || analysisController) return;
  const controller = new AbortController();
  analysisController = controller;
  const requestId = ++analysisRequestId;
  const context = {
    industry: industrySelect.value,
    radius,
    location: { ...currentSelection },
  };
  currentAnalysis = null;
  currentAnalysisContext = null;
  analysisResult.hidden = false;
  analysisError.hidden = true;
  analysisContent.hidden = true;
  analysisLoading.hidden = false;
  setAnalyzeAvailability();
  try {
    const result = await analyzeLocation({
      industry: context.industry,
      latitude: context.location.lat,
      longitude: context.location.lng,
      radius: context.radius,
    }, { signal: controller.signal, scenario: document.getElementById('scenario').value });
    if (requestId !== analysisRequestId) return;
    renderAnalysis(result, context);
  } catch (error) {
    if (controller.signal.aborted || requestId !== analysisRequestId) return;
    analysisLoading.hidden = true;
    analysisError.hidden = false;
    analysisResult.hidden = false;
    document.getElementById('analysis-error-text').textContent = error.message || '분석 요청에 실패했습니다.';
  } finally {
    if (requestId === analysisRequestId) {
      analysisController = null;
      setAnalyzeAvailability();
    }
  }
}

function saveCurrentCandidate() {
  if (!currentAnalysis || !currentAnalysisContext) return;
  const candidate = createCandidate(currentAnalysis, currentAnalysisContext);
  try {
    const next = addCandidate(candidates, candidate);
    writeCandidates(storage, next);
    candidates = next;
    renderCandidates();
    updateSaveButton();
    showToast('비교 목록에 추가했어요.', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function renderComparison() {
  const entries = filterCandidates(candidates, currentFilters());
  document.getElementById('comparison-subtitle').textContent =
    `${INDUSTRIES.find(item => item.code === industrySelect.value)?.label} · ${radius}m · ${entries.length}개 후보`;
  const container = document.getElementById('comparison-content');
  container.replaceChildren();

  const summary = createElement('section', 'comparison-overall');
  summary.append(createElement('h3', '', '종합 평가'));
  const scored = scoreCandidates(entries);
  const cards = createElement('div', 'comparison-score-cards');
  scored.forEach(({ item, score, dataCount }, index) => {
    const card = createElement('article', 'comparison-score-card');
    const heading = createElement('div', 'comparison-score-place');
    heading.append(
      createElement('span', `rank-bubble rank-${index}`, String.fromCharCode(65 + index)),
      createElement('strong', '', item.label),
    );
    const value = createElement('div', 'comparison-score-value');
    value.append(createElement('strong', '', score === null ? '—' : String(score)),
      createElement('span', '', score === null ? '점수 산출 불가' : '/ 100점'));
    const track = createElement('div', 'comparison-score-track');
    const fill = document.createElement('span');
    fill.style.width = `${score ?? 0}%`;
    track.append(fill);
    card.append(heading, value, track, createElement('small', 'comparison-data-count', `데이터 ${dataCount} / ${COMPARISON_METRICS.length}개`));
    cards.append(card);
  });
  summary.append(cards);

  const details = createElement('section', 'comparison-detail');
  details.append(createElement('h3', '', '세부 지표'));
  const scroller = createElement('div', 'comparison-table-scroll');
  const table = createElement('table', 'comparison-table');
  const thead = document.createElement('thead');
  const headingRow = document.createElement('tr');
  headingRow.append(createElement('th', '', '비교 항목'));
  entries.forEach(item => {
    const th = document.createElement('th');
    th.append(createElement('span', '', item.label),
      createElement('small', '', `${INDUSTRIES.find(option => option.code === item.industry)?.label} · ${item.radius}m`));
    headingRow.append(th);
  });
  thead.append(headingRow);
  const tbody = document.createElement('tbody');
  COMPARISON_METRICS.forEach(metric => {
    const row = document.createElement('tr');
    const title = document.createElement('th');
    title.append(document.createTextNode(metric.label), createElement('small', '', metric.unit));
    row.append(title);
    const maximum = Math.max(0, ...entries.map(item => item[metric.key] ?? 0));
    entries.forEach((item, index) => {
      const cell = document.createElement('td');
      const rawValue = item[metric.key];
      const available = Number.isFinite(rawValue) && rawValue >= 0;
      const formatted = metric.key === 'sales' ? displayMoney(rawValue) :
        `${metricText(rawValue)}${available ? (metric.key === 'foot_traffic' ? '명' : '점') : ''}`;
      cell.append(createElement('strong', available ? '' : 'unavailable', formatted));
      const track = createElement('div', 'comparison-table-track');
      if (available) {
        const fill = createElement('span', `comparison-fill comparison-color-${index}`);
        fill.style.width = `${maximum > 0 ? rawValue / maximum * 100 : 0}%`;
        track.append(fill);
      }
      cell.append(track);
      row.append(cell);
    });
    tbody.append(row);
  });
  table.append(thead, tbody);
  scroller.append(table);
  details.append(scroller);
  container.append(summary, details);
}

async function openReport() {
  if (!currentAnalysis || !currentAnalysisContext) return;
  currentReport = null;
  document.getElementById('report-content').hidden = true;
  document.getElementById('report-error').hidden = true;
  document.getElementById('report-loading').hidden = true;
  reportDialog.showModal();
  await handleReport();
}

async function handleReport() {
  if (!currentAnalysis || !currentAnalysisContext || reportController) return;
  const controller = new AbortController();
  reportController = controller;
  const requestId = ++reportRequestId;
  const reportLoading = document.getElementById('report-loading');
  const reportError = document.getElementById('report-error');
  const reportContent = document.getElementById('report-content');
  reportLoading.hidden = false;
  reportError.hidden = true;
  try {
    currentReport = await generateReport(currentAnalysisContext, {
      signal: controller.signal,
      scenario: document.getElementById('scenario').value,
    });
    if (requestId !== reportRequestId) return;
    reportContent.replaceChildren();
    [
      ['강점', currentReport.strengths],
      ['위험 요인', currentReport.risks],
      ['추천 전략', currentReport.strategy],
    ].forEach(([title, text]) => {
      const item = createElement('article', 'report-line');
      item.append(createElement('strong', '', title), createElement('p', '', text));
      reportContent.append(item);
    });
    reportContent.append(createElement('small', 'report-fake-note', '실제 GPT 호출 없이 생성된 테스트 문장입니다.'));
    reportContent.hidden = false;
  } catch (error) {
    if (controller.signal.aborted || requestId !== reportRequestId) return;
    document.getElementById('report-error-text').textContent = error.message || '리포트 생성에 실패했습니다.';
    reportError.hidden = false;
  } finally {
    if (requestId === reportRequestId) {
      reportLoading.hidden = true;
      reportController = null;
    }
  }
}

function setRadius(nextRadius) {
  if (!RADII.includes(nextRadius) || nextRadius === radius) return;
  resetAnalysis();
  radius = nextRadius;
  document.querySelectorAll('[data-radius]').forEach(button => {
    const selected = Number(button.dataset.radius) === radius;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  radiusCircle?.setRadius(radius);
  renderCandidates();
}

industrySelect.addEventListener('change', () => {
  resetAnalysis();
  renderCandidates();
});
document.querySelectorAll('[data-radius]').forEach(button => {
  button.addEventListener('click', () => setRadius(Number(button.dataset.radius)));
});
document.querySelectorAll('.quick-location-grid button').forEach(button => {
  button.addEventListener('click', () => {
    if (!map || !boundariesReady) {
      setNotice('지도를 준비하고 있습니다. 잠시 후 다시 시도해 주세요.', 'loading');
      return;
    }
    const position = new kakao.maps.LatLng(Number(button.dataset.lat), Number(button.dataset.lng));
    const feature = findDongAt(position);
    if (!feature) {
      setNotice('빠른 위치가 안양시 경계 밖입니다. 주소 검색이나 지도에서 직접 선택해 주세요.', 'error');
      return;
    }
    resetAnalysis();
    addressRequestId += 1;
    reverseGeocode(position, feature.properties.adm_nm.replace(/^경기도 /, ''));
  });
});
analyzeButton.addEventListener('click', handleAnalyze);
document.getElementById('retry-analysis').addEventListener('click', handleAnalyze);
document.getElementById('save-candidate').addEventListener('click', saveCurrentCandidate);
document.getElementById('open-report').addEventListener('click', openReport);
document.getElementById('generate-report').addEventListener('click', handleReport);
compareButton.addEventListener('click', () => {
  renderComparison();
  comparisonDialog.showModal();
});
document.querySelectorAll('[data-close-dialog]').forEach(button => {
  button.addEventListener('click', () => document.getElementById(button.dataset.closeDialog).close());
});
document.getElementById('reset-button').addEventListener('click', () => {
  resetAnalysis();
  industrySelect.value = INDUSTRIES[0].code;
  setRadius(500);
  currentSelection = null;
  marker?.setMap(null);
  radiusCircle?.setMap(null);
  addressElement.textContent = '지도에서 위치를 선택해 주세요.';
  addressElement.classList.add('empty');
  dongElement.textContent = '—';
  commercialAreaElement.textContent = '—';
  commercialAreaIdElement.textContent = '—';
  latitudeElement.textContent = '—';
  longitudeElement.textContent = '—';
  selectedCheck.hidden = true;
  setAnalyzeAvailability();
  setNotice('업종과 반경을 초기화했습니다. 지도에서 위치를 선택해 주세요.');
  document.querySelector('.studio-panel-content').scrollTo({ top: 0, behavior: 'smooth' });
});

searchForm.addEventListener('submit', event => {
  event.preventDefault();
  const query = searchInput.value.trim();
  if (!query) {
    setNotice('검색할 주소를 입력해 주세요.', 'error');
    searchInput.focus();
    return;
  }
  if (!geocoder) {
    setNotice('지도를 사용할 수 없습니다. 카카오맵 키와 도메인 설정을 확인해 주세요.', 'error');
    return;
  }
  if (!boundariesReady) {
    setNotice('안양시 경계 정보를 준비하고 있습니다. 잠시 후 다시 검색해 주세요.', 'loading');
    return;
  }

  searchButton.disabled = true;
  setNotice('주소를 검색하고 있습니다.', 'loading');
  const requestId = ++addressRequestId;
  geocoder.addressSearch(query, (result, status) => {
    if (requestId !== addressRequestId) return;
    searchButton.disabled = false;
    if (status === kakao.maps.services.Status.OK && result.length) {
      const place = result[0];
      const position = new kakao.maps.LatLng(Number(place.y), Number(place.x));
      const feature = findDongAt(position);
      if (!feature) {
        setNotice('검색한 주소는 안양시 경계 밖입니다. 안양시 안의 주소를 검색해 주세요.', 'error');
        return;
      }
      resetAnalysis();
      map.setLevel(3);
      const dongName = feature.properties.adm_nm.replace(/^경기도 /, '');
      updateSelection(position, place.road_address?.address_name || place.address_name || query, dongName);
      setNotice('검색한 위치로 이동했습니다.', 'success');
    } else if (status === kakao.maps.services.Status.ZERO_RESULT) {
      setNotice('검색 결과가 없습니다. 도로명이나 지번 주소를 확인해 주세요.', 'error');
    } else {
      setNotice('주소 검색에 실패했습니다. 잠시 후 다시 시도해 주세요.', 'error');
    }
  });
});

renderCandidates();
setAnalyzeAvailability();
if (storageNotice) showToast(storageNotice, 'error');
loadKakaoMaps();
