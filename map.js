(function () {
  'use strict';

  const DEFAULT_COORDS = { lat: 33.7833, lon: 72.7167 };
  const TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}';
  const TILE_ATTR = 'Tiles &copy; Esri';

  function waitForSize(el, init) {
    let tries = 0;
    (function check() {
      if (el.clientHeight > 10 && el.clientWidth > 10) { init(); return; }
      if (++tries > 40) { el.style.minHeight = '480px'; init(); return; }
      setTimeout(check, 50);
    })();
  }

  function buildMap(containerId, options) {
    const container = document.getElementById(containerId);
    if (!container) { console.warn(`[MapKit] #${containerId} not found.`); return null; }

    const saved = (window.GuardedBerm && window.GuardedBerm.getCoords) ? window.GuardedBerm.getCoords() : DEFAULT_COORDS;
    const center = options.center || [saved.lat, saved.lon];
    const zoom = options.zoom || 13;

    const map = L.map(containerId, {
      zoomSnap: 0.5, zoomDelta: 0.5, preferCanvas: true,
      fadeAnimation: false, markerZoomAnimation: false
    }).setView(center, zoom);

    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTR }).addTo(map);

    [0, 100, 300, 600, 1000].forEach(ms => setTimeout(() => map.invalidateSize(), ms));
    window.addEventListener('load', () => setTimeout(() => map.invalidateSize(), 100));

    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => map.invalidateSize(), 200);
    });

    map._baseLayer = L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTR });
    return map;
  }

  function createMap(containerId, options = {}) {
    const container = document.getElementById(containerId);
    if (!container) { console.warn(`[MapKit] #${containerId} not found.`); return null; }
    if (container.clientHeight > 10 && container.clientWidth > 10) return buildMap(containerId, options);

    const stub = {
      _pending: true,
      ready: new Promise(resolve => {
        waitForSize(container, () => {
          const map = buildMap(containerId, options);
          stub._real = map;
          stub._pending = false;
          resolve(map);
        });
      })
    };
    return stub;
  }

  async function getMap(containerId, options = {}) {
    const result = createMap(containerId, options);
    if (result && result._pending) return await result.ready;
    return result;
  }

  window.MapKit = { createMap, getMap };
})();