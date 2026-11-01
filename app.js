(function () {
  'use strict';

  const DEFAULT_COORDS = { lat: 33.7833, lon: 72.7167 };
  const REPORTS_KEY = 'guardedberm_reports';
  const COORDS_KEY = 'guardedberm_user_coords';
  const ALERTS_KEY = 'guardedberm_alerts';
  const OWNER_KEY = 'guardedberm_owner_id';

  function read(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch (error) {
      console.error(`Unable to read ${key}:`, error);
      return fallback;
    }
  }

  function write(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function getReports() {
    return read(REPORTS_KEY, []);
  }

  function saveReports(reports) {
    write(REPORTS_KEY, reports);
    return reports;
  }

  function createReport(report) {
    const reports = getReports();
    const created = {
      id: window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      ownerId: getOwnerId(),
      category: report.category,
      description: report.description,
      lat: Number(report.lat),
      lon: Number(report.lon),
      timestamp: new Date().toISOString(),
      status: 'Unverified',
      upvotes: 0
    };
    reports.unshift(created);
    saveReports(reports);
    return created;
  }

  function updateReport(id, updates) {
    const reports = getReports().map(report => report.id === id ? { ...report, ...updates } : report);
    return saveReports(reports).find(report => report.id === id);
  }

  function deleteReport(id) {
    saveReports(getReports().filter(report => report.id !== id));
  }

  function getOwnerId() {
    let ownerId = localStorage.getItem(OWNER_KEY);
    if (!ownerId) {
      ownerId = window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
      localStorage.setItem(OWNER_KEY, ownerId);
    }
    return ownerId;
  }

  function getCoords() {
    const coords = read(COORDS_KEY, DEFAULT_COORDS);
    return {
      lat: Number.isFinite(Number(coords.lat)) ? Number(coords.lat) : DEFAULT_COORDS.lat,
      lon: Number.isFinite(Number(coords.lon)) ? Number(coords.lon) : DEFAULT_COORDS.lon
    };
  }

  function saveCoords(lat, lon) {
    const coords = { lat: Number(lat), lon: Number(lon) };
    if (!Number.isFinite(coords.lat) || !Number.isFinite(coords.lon) ||
      coords.lat < -90 || coords.lat > 90 || coords.lon < -180 || coords.lon > 180) {
      throw new Error('Enter valid latitude and longitude values.');
    }
    write(COORDS_KEY, coords);
    return coords;
  }

  function getAlerts() {
    return read(ALERTS_KEY, []);
  }

  function saveAlerts(alerts) {
    write(ALERTS_KEY, alerts);
    return alerts;
  }

  function addAlert(alert) {
    const alerts = getAlerts();
    if (!alerts.some(item => item.id === alert.id)) {
      alerts.unshift({ ...alert, createdAt: new Date().toISOString(), dismissed: false });
      saveAlerts(alerts);
    }
    return alerts;
  }

  function dismissAlert(id) {
    saveAlerts(getAlerts().map(alert => alert.id === id ? { ...alert, dismissed: true } : alert));
  }

  function haversineDistance(lat1, lon1, lat2, lon2) {
    const earthRadius = 6371;
    const radians = value => value * Math.PI / 180;
    const deltaLat = radians(lat2 - lat1);
    const deltaLon = radians(lon2 - lon1);
    const a = Math.sin(deltaLat / 2) ** 2 +
      Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(deltaLon / 2) ** 2;
    return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  async function fetchJson(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    return response.json();
  }

  async function fetchWeather(coords) {
    return fetchJson(`https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&current=temperature_2m,precipitation,rain,wind_speed_10m`);
  }

  async function fetchEarthquakes() {
    const startTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    return fetchJson(`https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&minmagnitude=2.5&limit=10&orderby=time&starttime=${encodeURIComponent(startTime)}`);
  }

  async function geocodeAddress(address) {
    const coordinates = address.split(',').map(Number);
    if (coordinates.length === 2 && coordinates.every(Number.isFinite) &&
      coordinates[0] >= -90 && coordinates[0] <= 90 && coordinates[1] >= -180 && coordinates[1] <= 180) {
      return { lat: coordinates[0], lon: coordinates[1], displayName: address };
    }
    const data = await fetchJson(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`);
    if (!data[0]) throw new Error('Location not found.');
    return { lat: Number(data[0].lat), lon: Number(data[0].lon), displayName: data[0].display_name };
  }

  async function reverseGeocode(lat, lon) {
    const data = await fetchJson(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`);
    return data.display_name || 'Pinned location';
  }

  function calculateRiskScore(userLat, userLon, precipitation = 0, earthquakes = []) {
    const nearbyHazards = getReports().filter(report =>
      report.status === 'Verified' &&
      haversineDistance(userLat, userLon, report.lat, report.lon) <= 5
    );
    const seismicFactor = earthquakes.reduce((factor, earthquake) => {
      const coordinates = earthquake.geometry?.coordinates;
      const magnitude = earthquake.properties?.mag;
      if (!coordinates || typeof magnitude !== 'number') return factor;
      const distance = haversineDistance(userLat, userLon, coordinates[1], coordinates[0]);
      return distance <= 100 ? Math.max(factor, Math.max(0, magnitude * (1 - distance / 100) * 2)) : factor;
    }, 0);
    return Math.min(100, (Number(precipitation) * 3.5) + (nearbyHazards.length * 15) + seismicFactor);
  }

  function showToast(message, type = 'danger') {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container position-fixed bottom-0 end-0 p-3';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast align-items-center text-bg-${type} border-0`;
    toast.setAttribute('role', 'alert');
    toast.innerHTML = `<div class="d-flex"><div class="toast-body">${message}</div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button></div>`;
    container.appendChild(toast);
    const instance = bootstrap.Toast.getOrCreateInstance(toast, { delay: 5000 });
    instance.show();
    toast.addEventListener('hidden.bs.toast', () => toast.remove());
  }

  function setLoading(element, loading, text = 'Loading...') {
    if (!element) return;
    if (loading) {
      element.dataset.previousText = element.textContent;
      element.innerHTML = `<span class="spinner-border spinner-border-sm me-2" role="status"></span>${text}`;
    } else if (element.dataset.previousText) {
      element.textContent = element.dataset.previousText;
      delete element.dataset.previousText;
    }
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[character]));
  }

  window.GuardedBerm = {
    DEFAULT_COORDS, getReports, createReport, updateReport, deleteReport, getOwnerId, getCoords, saveCoords,
    getAlerts, addAlert, dismissAlert, haversineDistance, fetchWeather, fetchEarthquakes,
    geocodeAddress, reverseGeocode, calculateRiskScore, showToast, setLoading, escapeHtml
  };
})();
