(() => {
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

  let map;
  let marker;
  let geocoder;
  let addressRequestId = 0;
  let boundaryFeatures = [];
  let commercialFeatures = [];
  let boundariesReady = false;

  function setNotice(message, type = '') {
    notice.className = `notice${type ? ` ${type}` : ''}`;
    noticeText.textContent = message;
  }

  function showMapError(message) {
    mapLoading.hidden = true;
    mapElement.classList.add('map-unavailable');
    setNotice(message, 'error');
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
    updateCommercialArea(position);
  }

  function pointOnSegment(point, start, end) {
    const cross = (point.lat - start[1]) * (end[0] - start[0]) - (point.lng - start[0]) * (end[1] - start[1]);
    if (Math.abs(cross) > 1e-10) return false;
    return point.lng >= Math.min(start[0], end[0]) - 1e-10
      && point.lng <= Math.max(start[0], end[0]) + 1e-10
      && point.lat >= Math.min(start[1], end[1]) - 1e-10
      && point.lat <= Math.max(start[1], end[1]) + 1e-10;
  }

  function isInsideRing(point, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const start = ring[j];
      const end = ring[i];
      if (pointOnSegment(point, start, end)) return true;
      const crossesLatitude = (start[1] > point.lat) !== (end[1] > point.lat);
      if (crossesLatitude && point.lng < ((end[0] - start[0]) * (point.lat - start[1])) / (end[1] - start[1]) + start[0]) {
        inside = !inside;
      }
    }
    return inside;
  }

  function featureContainsPoint(feature, point) {
    const { type, coordinates } = feature.geometry;
    const polygons = type === 'Polygon' ? [coordinates] : coordinates;
    return polygons.some((rings) => isInsideRing(point, rings[0]) && !rings.slice(1).some((ring) => isInsideRing(point, ring)));
  }

  function findDongAt(position) {
    const point = { lat: position.getLat(), lng: position.getLng() };
    return boundaryFeatures.find((feature) => featureContainsPoint(feature, point));
  }

  function findCommercialAreasAt(position) {
    const point = { lat: position.getLat(), lng: position.getLng() };
    return commercialFeatures.filter((feature) => featureContainsPoint(feature, point));
  }

  function updateCommercialArea(position) {
    const areas = findCommercialAreasAt(position);
    if (areas.length === 0) {
      commercialAreaElement.textContent = '상권 경계 자료 없음';
      commercialAreaIdElement.textContent = '—';
      return;
    }

    const names = [...new Set(areas.map((feature) => feature.properties.areaName))];
    const types = [...new Set(areas.map((feature) => feature.properties.areaType))];
    const ids = [...new Set(areas.flatMap((feature) => feature.properties.salesAreaIds))]
      .sort((a, b) => Number(a) - Number(b));
    commercialAreaElement.textContent = `${names.join(' · ')} (${types.join('/')})`;
    commercialAreaIdElement.textContent = ids.length === 1 ? ids[0] : ids.length ? `후보: ${ids.join(', ')}` : '연결 ID 없음';
    commercialAreaIdElement.title = ids.length > 1 ? '상권명이 매출 자료에서 여러 ID와 일치해 하나로 특정할 수 없습니다.' : '';
  }

  function drawBoundaries() {
    const bounds = new kakao.maps.LatLngBounds();
    boundaryFeatures.forEach((feature) => {
      const geometry = feature.geometry;
      const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
      polygons.forEach((rings) => {
        const paths = rings.map((ring) => ring.map(([lng, lat]) => {
          const position = new kakao.maps.LatLng(lat, lng);
          bounds.extend(position);
          return position;
        }));
        new kakao.maps.Polygon({
          map,
          path: paths,
          strokeWeight: 2,
          strokeColor: '#14836c',
          strokeOpacity: 0.8,
          strokeStyle: 'solid',
          fillColor: '#31a486',
          fillOpacity: 0.13,
        });
      });
    });
    if (!bounds.isEmpty()) map.setBounds(bounds);
  }

  function drawCommercialBoundaries() {
    commercialFeatures.forEach((feature) => {
      const geometry = feature.geometry;
      const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
      polygons.forEach((rings) => {
        const paths = rings.map((ring) => ring.map(([lng, lat]) => new kakao.maps.LatLng(lat, lng)));
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
    const loadGeoJSON = (path) => fetch(path).then((response) => {
        if (!response.ok) throw new Error(`GeoJSON 요청 실패 (${response.status})`);
        return response.json();
      });
    Promise.all([
      loadGeoJSON('./data/geojson/anyang-si.geojson'),
      loadGeoJSON('./data/geojson/anyang-commercial-areas.geojson'),
    ])
      .then(([adminGeoJSON, commercialGeoJSON]) => {
        [adminGeoJSON, commercialGeoJSON].forEach((geojson) => {
          if (geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features) || geojson.features.length === 0) {
          throw new Error('GeoJSON 형식이 올바르지 않습니다.');
          }
        });
        boundaryFeatures = adminGeoJSON.features;
        commercialFeatures = commercialGeoJSON.features;
        drawBoundaries();
        drawCommercialBoundaries();
        boundariesReady = true;
        setNotice('안양시 경계 안에서 위치를 선택하고, 상권 경계와 매출 ID를 확인할 수 있습니다.');
      })
      .catch((error) => {
        boundariesReady = false;
        setNotice('경계 파일을 읽지 못했습니다. data/geojson의 GeoJSON 파일과 웹 서버 실행을 확인해 주세요.', 'error');
        console.error('Failed to load Anyang boundaries:', error);
      });
  }

  function reverseGeocode(position, dongName) {
    const requestId = ++addressRequestId;
    updateSelection(position, '주소를 확인하고 있습니다.');
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
      map = new kakao.maps.Map(mapElement, {
        center,
        level: 7,
        minLevel: 1,
        maxLevel: 12,
      });
      marker = new kakao.maps.Marker({ position: center });
      geocoder = new kakao.maps.services.Geocoder();
      kakao.maps.event.addListener(map, 'click', (event) => {
        if (!boundariesReady) {
          setNotice('안양시 경계 정보를 준비하고 있습니다. 잠시 후 다시 선택해 주세요.', 'loading');
          return;
        }
        const feature = findDongAt(event.latLng);
        if (!feature) {
          setNotice('안양시 경계 밖입니다. 안양시 안의 위치를 선택해 주세요.', 'error');
          return;
        }
        addressRequestId += 1;
        searchButton.disabled = false;
        const dongName = feature.properties.adm_nm.replace(/^경기도 /, '');
        reverseGeocode(event.latLng, dongName);
      });
      mapLoading.hidden = true;
      loadBoundaries();
    } catch (error) {
      showMapError('지도를 초기화하지 못했습니다. 앱을 다시 불러오고 설정을 확인해 주세요.');
      console.error('Kakao map initialization failed:', error);
    }
  }

  function loadKakaoMaps() {
    const appKey = window.APP_CONFIG?.kakaoMapAppKey?.trim();
    if (!appKey) {
      showMapError('카카오맵 키가 설정되지 않았습니다. config.js에 JavaScript 키를 입력해 주세요.');
      return;
    }

    if (window.kakao?.maps) {
      kakao.maps.load(initMap);
      return;
    }

    window.kakaoMapSdkFailed = () => showMapError('카카오맵 SDK를 불러오지 못했습니다. 네트워크와 등록 도메인을 확인해 주세요.');
    const script = document.createElement('script');
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(appKey)}&libraries=services&autoload=false&onerror=kakaoMapSdkFailed`;
    script.async = true;
    script.onerror = window.kakaoMapSdkFailed;
    script.onload = () => {
      if (!window.kakao?.maps) {
        showMapError('카카오맵 SDK를 사용할 수 없습니다. JavaScript 키와 등록 도메인을 확인해 주세요.');
        return;
      }
      kakao.maps.load(initMap);
    };
    document.head.appendChild(script);
  }

  searchForm.addEventListener('submit', (event) => {
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
        const feature = boundariesReady ? findDongAt(position) : null;
        if (!feature) {
          setNotice('검색한 주소는 안양시 경계 밖입니다. 안양시 안의 주소를 검색해 주세요.', 'error');
          return;
        }
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

  loadKakaoMaps();
})();
