(function () {
  'use strict';

  const STORAGE_KEYS = {
    REPORTS: 'guardedberm_reports',
    COORDS: 'guardedberm_user_coords',
    ALERTS: 'guardedberm_alerts',
    OWNER: 'guardedberm_owner_id'
  };

  const DEFAULT_COORDS = { lat: 33.7833, lon: 72.7167 };
  const CACHE_TTL = 5 * 60 * 1000;
  const pendingJsonRequests = new Map();

  function getValue(key, fallback = null) {
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch (error) {
      console.error(`Unable to read local storage key "${key}".`, error);
      return fallback;
    }
  }

  function setValue(key, value) {
    try {
      localStorage.setItem(key, String(value));
      return true;
    } catch (error) {
      console.error(`Unable to write local storage key "${key}".`, error);
      return false;
    }
  }

  function removeValue(key) {
    try {
      localStorage.removeItem(key);
      return true;
    } catch (error) {
      console.error(`Unable to remove local storage key "${key}".`, error);
      return false;
    }
  }

  function setText(id, value) {
    const element = document.getElementById(id);
    if (!element) return false;
    element.textContent = String(value);
    return true;
  }

  function setValue(id, value) {
    const element = document.getElementById(id);
    if (!element) return false;
    element.value = value;
    return true;
  }

  function setHtml(id, value) {
    const element = document.getElementById(id);
    if (!element) return false;
    element.innerHTML = value;
    return true;
  }

  function setChecked(id, value) {
    const element = document.getElementById(id);
    if (!element) return false;
    element.checked = Boolean(value);
    return true;
  }

  function setSource(id, value) {
    const element = document.getElementById(id);
    if (!element) return false;
    element.src = value;
    return true;
  }

  function setClassName(id, value) {
    const element = document.getElementById(id);
    if (!element) return false;
    element.className = value;
    return true;
  }

  function toggleClass(id, className, enabled) {
    const element = document.getElementById(id);
    if (!element) return false;
    element.classList.toggle(className, Boolean(enabled));
    return true;
  }

  function getStorage(key, fallback) {
    try {
      const item = getValue(key);
      return item === null ? fallback : JSON.parse(item);
    } catch (error) {
      console.error(`Unable to parse local storage key "${key}".`, error);
      removeValue(key);
      return fallback;
    }
  }

  function setStorage(key, value) {
    try {
      return setValue(key, JSON.stringify(value));
    } catch (error) {
      console.error(`Unable to serialize local storage key "${key}".`, error);
      return false;
    }
  }

  function getSessionStorage(key, fallback = null) {
    try {
      const value = sessionStorage.getItem(key);
      return value === null ? fallback : JSON.parse(value);
    } catch (error) {
      console.error(`Unable to read session storage key "${key}".`, error);
      try { sessionStorage.removeItem(key); } catch (removeError) {
        console.error(`Unable to remove invalid session storage key "${key}".`, removeError);
      }
      return fallback;
    }
  }

  function setSessionStorage(key, value) {
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      console.error(`Unable to write session storage key "${key}".`, error);
      return false;
    }
  }

  function createPasswordSalt() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  async function hashPassword(password, salt) {
    if (!crypto.subtle) throw new Error('Password protection is unavailable in this browser context.');
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const digest = await crypto.subtle.deriveBits({
      name: 'PBKDF2',
      salt: new TextEncoder().encode(salt),
      iterations: 100000,
      hash: 'SHA-256'
    }, key, 256);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }

  async function fetchCachedJson(key, fetcher) {
    const cached = getSessionStorage(key);
    if (cached && cached.expiresAt > Date.now() && cached.data) return cached.data;
    if (pendingJsonRequests.has(key)) return pendingJsonRequests.get(key);
    const request = fetcher().then(data => {
      setSessionStorage(key, { expiresAt: Date.now() + CACHE_TTL, data });
      return data;
    }).finally(() => pendingJsonRequests.delete(key));
    pendingJsonRequests.set(key, request);
    return request;
  }

  function createDebouncedJsonRequest() {
    let timer = null;
    let controller = null;
    let rejectPending = null;
    return url => new Promise((resolve, reject) => {
      if (timer) clearTimeout(timer);
      if (controller) controller.abort();
      if (rejectPending) {
        const error = new Error('A newer location request replaced this one.');
        error.name = 'AbortError';
        rejectPending(error);
      }

      const requestController = new AbortController();
      controller = requestController;
      rejectPending = reject;
      timer = setTimeout(async () => {
        timer = null;
        try {
          const response = await fetch(url, { signal: requestController.signal });
          if (!response.ok) throw new Error('Location lookup failed.');
          resolve(await response.json());
        } catch (error) {
          reject(error);
        } finally {
          if (controller === requestController) {
            controller = null;
            rejectPending = null;
          }
        }
      }, 400);
    });
  }

  const requestNominatim = createDebouncedJsonRequest();

  function getOwnerId() {
    let id = getValue(STORAGE_KEYS.OWNER);
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString();
      setValue(STORAGE_KEYS.OWNER, id);
    }
    return id;
  }

  function getCoords() {
    const saved = getStorage(STORAGE_KEYS.COORDS, DEFAULT_COORDS) || DEFAULT_COORDS;
    const lat = Number(saved.lat);
    const lon = Number(saved.lon);
    return {
      lat: Number.isFinite(lat) && lat >= -90 && lat <= 90 ? lat : DEFAULT_COORDS.lat,
      lon: Number.isFinite(lon) && lon >= -180 && lon <= 180 ? lon : DEFAULT_COORDS.lon
    };
  }

  function saveCoords(lat, lon) {
    const parsedLat = Number(lat);
    const parsedLon = Number(lon);
    if (isNaN(parsedLat) || isNaN(parsedLon) || parsedLat < -90 || parsedLat > 90 || parsedLon < -180 || parsedLon > 180) {
      throw new Error('Invalid coordinates provided.');
    }
    if (!setStorage(STORAGE_KEYS.COORDS, { lat: parsedLat, lon: parsedLon })) {
      throw new Error('Unable to save coordinates in this browser.');
    }
    return { lat: parsedLat, lon: parsedLon };
  }

  function getReports() {
    const reports = getStorage(STORAGE_KEYS.REPORTS, []);
    return Array.isArray(reports) ? reports : [];
  }

  function createReport(data) {
    const reports = getReports();
    const newReport = {
      id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
      ownerId: getOwnerId(),
      category: data.category,
      description: data.description,
      lat: Number(data.lat),
      lon: Number(data.lon),
      severity: data.severity || 'Moderate',
      roadStatus: data.roadStatus || 'Passable with Caution',
      impactTags: Array.isArray(data.impactTags) ? data.impactTags : [],
      locationName: data.locationName || '',
      timestamp: new Date().toISOString(),
      status: 'Unverified',
      upvotes: 0
    };
    reports.unshift(newReport);
    if (!setStorage(STORAGE_KEYS.REPORTS, reports)) throw new Error('Unable to save hazard report.');
    return newReport;
  }

  function updateReport(id, updates) {
    const reports = getReports();
    const index = reports.findIndex(r => r.id === id);
    if (index !== -1) {
      reports[index] = { ...reports[index], ...updates };
      if (!setStorage(STORAGE_KEYS.REPORTS, reports)) throw new Error('Unable to update hazard report.');
      return reports[index];
    }
    return null;
  }

  function deleteReport(id) {
    if (!setStorage(STORAGE_KEYS.REPORTS, getReports().filter(r => r.id !== id))) throw new Error('Unable to delete hazard report.');
  }

  function getAlerts() {
    const alerts = getStorage(STORAGE_KEYS.ALERTS, []);
    return Array.isArray(alerts) ? alerts : [];
  }

  function addAlert(alert) {
    const alerts = getAlerts();
    if (!alerts.some(a => a.id === alert.id)) {
      alerts.unshift({ ...alert, createdAt: new Date().toISOString(), dismissed: false });
      if (!setStorage(STORAGE_KEYS.ALERTS, alerts)) throw new Error('Unable to save alert.');
    }
  }

  function dismissAlert(id) {
    if (!setStorage(STORAGE_KEYS.ALERTS, getAlerts().map(a => a.id === id ? { ...a, dismissed: true } : a))) {
      throw new Error('Unable to dismiss alert.');
    }
  }

  function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  function calculateRiskScore(lat, lon, precipitation = 0, earthquakes = []) {
    const verified = getReports().filter(r => r.status === 'Verified' && haversineDistance(lat, lon, r.lat, r.lon) <= 5);
    let seismicFactor = 0;
    earthquakes.forEach(eq => {
      const [eqLon, eqLat] = eq.geometry.coordinates;
      const dist = haversineDistance(lat, lon, eqLat, eqLon);
      if (dist <= 100) seismicFactor = Math.max(seismicFactor, Math.max(0, eq.properties.mag * (1 - dist / 100) * 2));
    });
    return Math.min(100, (precipitation * 3.5) + (verified.length * 15) + seismicFactor);
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]));
  }

  async function fetchWeather(lat, lon) {
    const key = `guardedberm:weather:${Number(lat).toFixed(2)},${Number(lon).toFixed(2)}`;
    return fetchCachedJson(key, async () => {
      const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,precipitation,rain,wind_speed_10m`);
      if (!res.ok) throw new Error('Weather fetch failed');
      return res.json();
    });
  }

  async function fetchEarthquakes(lat, lon) {
    const hasCoords = lat !== null && lat !== undefined && lon !== null && lon !== undefined &&
      Number.isFinite(Number(lat)) && Number.isFinite(Number(lon));
    const key = `guardedberm:earthquakes:${hasCoords ? `${Number(lat).toFixed(2)},${Number(lon).toFixed(2)}` : 'global'}`;
    return fetchCachedJson(key, async () => {
      const startTime = new Date(Date.now() - 86400000).toISOString();
      let url = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&minmagnitude=2.5&limit=100&orderby=time&starttime=${encodeURIComponent(startTime)}`;
      if (hasCoords) url += `&latitude=${lat}&longitude=${lon}&maxradiuskm=300`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Seismic fetch failed');
      return res.json();
    });
  }

  async function geocodeAddress(address) {
    const coords = address.split(',').map(Number);
    if (coords.length === 2 && coords.every(n => !isNaN(n)) &&
      coords[0] >= -90 && coords[0] <= 90 && coords[1] >= -180 && coords[1] <= 180) {
      return { lat: coords[0], lon: coords[1], displayName: address };
    }
    if (coords.length === 2 && coords.every(n => !isNaN(n)) && (coords[0] < -90 || coords[0] > 90 || coords[1] < -180 || coords[1] > 180)) {
      throw new Error('Invalid coordinates.');
    }
    const data = await requestNominatim(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`);
    if (!data[0]) throw new Error('Location not found');
    return { lat: Number(data[0].lat), lon: Number(data[0].lon), displayName: data[0].display_name };
  }

  async function reverseGeocode(lat, lon) {
    const data = await requestNominatim(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`);
    return data.display_name || 'Unknown Location';
  }

  function showToast(message, type = 'danger') {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container position-fixed bottom-0 end-0 p-3';
      document.body.appendChild(container);
    }
    const toastEl = document.createElement('div');
    toastEl.className = `toast align-items-center text-bg-${type} border-0`;
    toastEl.innerHTML = '<div class="d-flex"><div class="toast-body"></div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>';
    toastEl.querySelector('.toast-body').textContent = String(message);
    container.appendChild(toastEl);
    new bootstrap.Toast(toastEl, { delay: 4000 }).show();
    toastEl.addEventListener('hidden.bs.toast', () => toastEl.remove());
  }

  function setLoading(button, isLoading, text = 'Loading...') {
    if (!button) return;
    if (isLoading) {
      button.dataset.originalText = button.innerHTML;
      button.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>${text}`;
      button.disabled = true;
    } else {
      button.innerHTML = button.dataset.originalText || 'Submit';
      button.disabled = false;
    }
  }

  window.GuardedBerm = {
    getCoords, saveCoords, getReports, createReport, updateReport, deleteReport, getOwnerId,
    getAlerts, addAlert, dismissAlert, haversineDistance, calculateRiskScore, escapeHtml,
    fetchWeather, fetchEarthquakes, geocodeAddress, reverseGeocode, showToast, setLoading,
    getJson: getStorage, setJson: setStorage, getValue, setValue, removeValue,
    getSessionJson: getSessionStorage, setSessionJson: setSessionStorage,
    createPasswordSalt, hashPassword, setText, setValueForElement: setValue, setHtml,
    setChecked, setSource, setClassName, toggleClass
  };

  document.querySelectorAll('.logout-btn').forEach(button => {
    button.addEventListener('click', () => {
      removeValue('guardedberm_session_active');
      window.location.href = 'login.html';
    });
  });
})();