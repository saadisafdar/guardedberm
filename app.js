(function () {
  'use strict';

  const STORAGE_KEYS = {
    REPORTS: 'guardedberm_reports',
    COORDS: 'guardedberm_user_coords',
    ALERTS: 'guardedberm_alerts',
    OWNER: 'guardedberm_owner_id'
  };

  const DEFAULT_COORDS = { lat: 33.7833, lon: 72.7167 };

  function getStorage(key, fallback) {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : fallback;
    } catch (e) {
      console.error("Error reading storage:", e);
      return fallback;
    }
  }

  function setStorage(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function getOwnerId() {
    let id = localStorage.getItem(STORAGE_KEYS.OWNER);
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString();
      localStorage.setItem(STORAGE_KEYS.OWNER, id);
    }
    return id;
  }

  function getCoords() {
    const saved = getStorage(STORAGE_KEYS.COORDS, DEFAULT_COORDS);
    return {
      lat: Number(saved.lat) || DEFAULT_COORDS.lat,
      lon: Number(saved.lon) || DEFAULT_COORDS.lon
    };
  }

  function saveCoords(lat, lon) {
    const parsedLat = Number(lat);
    const parsedLon = Number(lon);
    if (isNaN(parsedLat) || isNaN(parsedLon) || parsedLat < -90 || parsedLat > 90 || parsedLon < -180 || parsedLon > 180) {
      throw new Error('Invalid coordinates provided.');
    }
    setStorage(STORAGE_KEYS.COORDS, { lat: parsedLat, lon: parsedLon });
    return { lat: parsedLat, lon: parsedLon };
  }

  function getReports() { return getStorage(STORAGE_KEYS.REPORTS, []); }

  function createReport(data) {
    const reports = getReports();
    const newReport = {
      id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
      ownerId: getOwnerId(),
      category: data.category,
      description: data.description,
      lat: Number(data.lat),
      lon: Number(data.lon),
      timestamp: new Date().toISOString(),
      status: 'Unverified',
      upvotes: 0
    };
    reports.unshift(newReport);
    setStorage(STORAGE_KEYS.REPORTS, reports);
    return newReport;
  }

  function updateReport(id, updates) {
    const reports = getReports();
    const index = reports.findIndex(r => r.id === id);
    if (index !== -1) {
      reports[index] = { ...reports[index], ...updates };
      setStorage(STORAGE_KEYS.REPORTS, reports);
      return reports[index];
    }
    return null;
  }

  function deleteReport(id) {
    setStorage(STORAGE_KEYS.REPORTS, getReports().filter(r => r.id !== id));
  }

  function getAlerts() { return getStorage(STORAGE_KEYS.ALERTS, []); }

  function addAlert(alert) {
    const alerts = getAlerts();
    if (!alerts.some(a => a.id === alert.id)) {
      alerts.unshift({ ...alert, createdAt: new Date().toISOString(), dismissed: false });
      setStorage(STORAGE_KEYS.ALERTS, alerts);
    }
  }

  function dismissAlert(id) {
    setStorage(STORAGE_KEYS.ALERTS, getAlerts().map(a => a.id === id ? { ...a, dismissed: true } : a));
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
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,precipitation,rain,wind_speed_10m`);
    if (!res.ok) throw new Error('Weather fetch failed');
    return res.json();
  }

  async function fetchEarthquakes(lat, lon, radius = 300) {
    const startTime = new Date(Date.now() - 86400000).toISOString();
    let url = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&minmagnitude=2.5&limit=10&orderby=time&starttime=${encodeURIComponent(startTime)}`;
    if (lat && lon) url += `&latitude=${lat}&longitude=${lon}&maxradiuskm=${radius}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Seismic fetch failed');
    return res.json();
  }

  async function geocodeAddress(address) {
    const coords = address.split(',').map(Number);
    if (coords.length === 2 && coords.every(n => !isNaN(n)) && coords[0] >= -90 && coords[0] <= 90) {
      return { lat: coords[0], lon: coords[1], displayName: address };
    }
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`);
    const data = await res.json();
    if (!data[0]) throw new Error('Location not found');
    return { lat: Number(data[0].lat), lon: Number(data[0].lon), displayName: data[0].display_name };
  }

  async function reverseGeocode(lat, lon) {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`);
    const data = await res.json();
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
    toastEl.innerHTML = `<div class="d-flex"><div class="toast-body">${message}</div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>`;
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
    fetchWeather, fetchEarthquakes, geocodeAddress, reverseGeocode, showToast, setLoading
  };
})();