// WatchOver dashboard main client script.
// Structure: DOM refs/state → network helpers → init/auth → UI actions → notifications → map/devices → history → geofence → utilities.

// ===== DOM references & state =====
const historyBtn = document.getElementById('historyBtn');
const homeBtn = document.getElementById('homeBtn');
const logoutBtn = document.getElementById('logoutBtn');
const nameModal = document.getElementById('nameModal');
const activityModal = document.getElementById('activityModal');
const activityClose = document.getElementById('activityClose');
const activityList = document.getElementById('activityList');

let csrfToken = null;
let loggedInDeviceId = null;
let notificationsEnabled = false;
let deviceActive = false;
let lastNotifiedLocation = null;
let geofenceLayers = {};
let geofenceCircle = null;
let geofenceEnabled = false;
let lastGeofenceStatus = false;
let pendingMapClick = null;
let map;
let markers = {};
let allDeviceIds = [];
let isInitialLoad = true;
let lastUpdateTimestamp = 0;
let updateInterval;
let timeUpdateInterval;
let activityHistoryUpdateInterval;
let lastUpdateTime = null;
let lastValidLocation = {
    lat: null,
    lng: null,
    locationName: null,
    battery: null
};
let activityHistory = [];
let isFirstActivityClick = true;

// ===== Constants =====
const UPDATE_COOLDOWN_SECONDS = 15;
const FETCH_RESULTS_LIMIT = 100;
const DEVICE_TIMEOUT_MINUTES = 5;
const NOTIFICATION_DISPLAY_MS = 10000;
const DEFAULT_GEOFENCE_RADIUS_METERS = 100;

let cursorCircle = null;
let geofenceCenterLat = null;
let geofenceCenterLng = null;
let mobileGeofenceOverlay = null;
let mobileMapMoveHandler = null;

// Detect mobile/touch devices
const isMobileDevice = () => 'ontouchstart' in window || navigator.maxTouchPoints > 0 || window.matchMedia('(max-width: 768px)').matches;

// --- Performance caches ---
// Device location cache: last known location per device
const deviceLocationCache = {};
// Geofence cache: geofence data per device
const geofenceCache = {};
// Activity history cache: history per device
const activityHistoryCache = {};
// AbortController for canceling pending requests when switching devices
let currentAbortController = null;

// Track history markers on the map
let historyMarkers = {};

// Global function so onclick inside marker HTML can trigger it
window.removeHistoryMarker = function (id) {
    if (historyMarkers[id]) {
        map.removeLayer(historyMarkers[id]);
        delete historyMarkers[id];

        // Restore opacity of the corresponding list item
        const listItem = document.getElementById(`list-item-${id}`);
        if (listItem) {
            listItem.style.opacity = '1';
        }
    }
};// ===== MQTT (real-time) =====
const MQTT_BROKER_URL = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.hostname}:9001`;
let mqttClient = null;
let mqttConnected = false;
let mqttWsUrlFromServer = null;
let mqttRetryTimer = null;
let mqttConnectInProgress = false;
let lastMqttErrorLogAt = 0;
let mqttOnlineListenerBound = false;
let mqttExplicitlyDisabled = false;

function startLocationPolling() {
    if (updateInterval) return;

    // Fetch immediately, then continue on interval.
    updateLocation().catch(() => { });
    updateInterval = setInterval(() => {
        updateLocation().catch(() => { });
    }, UPDATE_COOLDOWN_SECONDS * 1000);
}

function stopLocationPolling() {
    if (updateInterval) {
        clearInterval(updateInterval);
        updateInterval = null;
    }
}

function throttleMqttErrorLog(prefix, err) {
    const now = Date.now();
    // Log at most once every 15s to reduce console spam.
    if (now - lastMqttErrorLogAt >= 15000) {
        lastMqttErrorLogAt = now;
        console.error(prefix, err || 'connection failed');
    }
}

function getMqttCandidateUrls() {
    if (mqttExplicitlyDisabled) {
        return [];
    }

    const list = [];

    if (mqttWsUrlFromServer && typeof mqttWsUrlFromServer === 'string') {
        const trimmed = mqttWsUrlFromServer.trim();
        if (trimmed) list.push(trimmed);
    }

    MQTT_FALLBACK_BROKER_URLS.forEach(url => {
        if (url && !list.includes(url)) list.push(url);
    });

    return list;
}

function scheduleMQTTRetry() {
    if (mqttRetryTimer) return;
    mqttRetryTimer = setTimeout(() => {
        mqttRetryTimer = null;
        if (!mqttConnected) {
            initMQTT();
        }
    }, MQTT_RETRY_DELAY_MS);
}

async function loadRealtimeConfig() {
    try {
        const data = await apiCall('getRealtimeConfig');
        if (data && data.success && data.mqtt_enabled === true && typeof data.mqtt_ws_url === 'string' && data.mqtt_ws_url.trim()) {
            mqttWsUrlFromServer = data.mqtt_ws_url.trim();
            mqttExplicitlyDisabled = false;
        } else if (data && data.success && data.mqtt_enabled === false) {
            // Explicitly disabled server-side: skip MQTT entirely.
            mqttWsUrlFromServer = null;
            mqttExplicitlyDisabled = true;
        }
    } catch (e) {
        // Ignore config fetch errors and use fallback URLs.
    }
}

// Initialize MQTT connection for real-time updates
function initMQTT() {
    if (typeof mqtt === 'undefined') {
        startLocationPolling();
        return;
    }

    if (mqttConnected || mqttConnectInProgress) {
        return;
    }

    if (mqttClient) {
        try {
            mqttClient.end(true);
        } catch (e) { }
        mqttClient = null;
    }

    const candidates = getMqttCandidateUrls();
    if (candidates.length === 0) {
        startLocationPolling();
        return;
    }

    mqttConnectInProgress = true;

    const tryCandidate = (index) => {
        if (index >= candidates.length) {
            mqttConnectInProgress = false;
            mqttConnected = false;
            startLocationPolling();
            scheduleMQTTRetry();
            return;
        }

        const brokerUrl = candidates[index];
        let didConnect = false;
        let movedNext = false;

        const moveNext = () => {
            if (movedNext) return;
            movedNext = true;
            try {
                if (mqttClient) {
                    mqttClient.end(true);
                }
            } catch (e) { }
            mqttClient = null;
            tryCandidate(index + 1);
        };

        try {
            mqttClient = mqtt.connect(brokerUrl, {
                reconnectPeriod: 0,
                connectTimeout: 10000,
                clean: true
            });

            mqttClient.on('connect', () => {
                didConnect = true;
                movedNext = true;
                mqttConnected = true;
                mqttConnectInProgress = false;
                stopLocationPolling();

                if (mqttRetryTimer) {
                    clearTimeout(mqttRetryTimer);
                    mqttRetryTimer = null;
                }

                // Subscribe to all known devices
                allDeviceIds.forEach(deviceId => {
                    mqttClient.subscribe(`watchover/device/${deviceId}/location`);
                });
            });

            mqttClient.on('message', (topic, message) => {
                try {
                    const data = JSON.parse(message.toString());
                    const location = {
                        lat: data.lat,
                        lng: data.lng,
                        battery: data.battery,
                        timestamp: data.timestamp,
                        device_id: data.device_id,
                        device_name: data.device_name,
                        locationName: data.locationName
                    };
                    // Invalidate history cache for this device (new data arrived)
                    delete activityHistoryCache[data.device_id];
                    // Always update cache for ALL devices, not just selected one
                    processLocationUpdate(location, data.device_id, data.device_id === loggedInDeviceId);
                } catch (e) {
                    console.error('MQTT message parse error:', e);
                }
            });

            mqttClient.on('error', (err) => {
                mqttConnected = false;
                throttleMqttErrorLog('MQTT error:', err);
                if (!didConnect) {
                    moveNext();
                    return;
                }
                startLocationPolling();
                scheduleMQTTRetry();
            });

            mqttClient.on('close', () => {
                const wasConnected = didConnect;
                mqttConnected = false;
                if (!wasConnected) {
                    moveNext();
                    return;
                }
                startLocationPolling();
                scheduleMQTTRetry();
            });

        } catch (e) {
            throttleMqttErrorLog('MQTT initialization error:', e);
            moveNext();
        }
    };

    tryCandidate(0);

    // Force immediate reconnect when network comes back online (e.g. WiFi -> Data switch)
    if (!mqttOnlineListenerBound) {
        mqttOnlineListenerBound = true;
        window.addEventListener('online', () => {
            if (!mqttConnected) {
                initMQTT();
            }
        });
    }
}

// Subscribe to a new device's MQTT topic
function subscribeToDevice(deviceId) {
    if (!mqttClient) {
        return; // MQTT not initialized yet
    }

    if (mqttConnected) {
        mqttClient.subscribe(`watchover/device/${deviceId}/location`);
    }
}

// ===== Network helpers =====
// Handles API requests with CSRF protection and error handling
async function apiCall(action, method = 'GET', body = null) {
    const headers = {};

    if (csrfToken) {
        headers['X-CSRF-Token'] = csrfToken;
    }

    if (body) {
        headers['Content-Type'] = 'application/json';
    }

    const options = {
        method: method,
        headers: headers,
        credentials: 'include',
    };

    if (body) {
        options.body = JSON.stringify(body);
    }

    try {
        const response = await fetch(`../api.php?action=${action}`, options);
        return await response.json();
    } catch (error) {
        return { success: false, error: 'Network connection failed' };
    }
}

// ===== App bootstrap =====
// Initializes application on load including auth check and map setup
window.addEventListener('DOMContentLoaded', async function () {
    const loader = document.getElementById('initial-loader');

    try {
        const tokenData = await apiCall('getCSRFToken');
        if (tokenData && tokenData.token) {
            csrfToken = tokenData.token;
        }

        const isAuthenticated = await checkAuthentication();
        if (!isAuthenticated) return;

        loggedInDeviceId = localStorage.getItem('loggedInDeviceId');

        await loadRealtimeConfig();

        initMap();
        await loadUserDevices();
        initializeEventListeners();
        requestNotificationPermission();
        initNotifToggleBtn();
        checkVibrateCooldown();
        initActivityToolbar();

        // Set bottom-nav CSS variables once (static values)
        try {
            document.documentElement.style.setProperty('--bottom-extra', '12px');
            const nav = document.querySelector('.bottom-nav');
            if (nav) document.documentElement.style.setProperty('--bottom-nav-height', (nav.offsetHeight || 56) + 'px');
        } catch (e) { }

    } catch (error) {
        // Initialization failed
    } finally {
        if (loader) {
            loader.classList.add('hidden');
            setTimeout(() => loader.remove(), 500);
        }
    }
});

// ===== Authentication & session =====
// Verifies if the current user session is valid
async function checkAuthentication() {
    const data = await apiCall('checkSession');

    if (data.authenticated) {
        if (data.user_id) {
            localStorage.setItem('user_id', data.user_id);
        }
        return true;
    } else {
        window.location.href = '../login/login.html';
        return false;
    }
}

// Logs user out and clears local storage
async function logout() {
    await apiCall('logout', 'POST');

    const sessionKeys = ['isLoggedIn', 'loggedInDeviceId', 'loggedInPassword', 'user_id', 'userId', 'loggedInUserId'];
    sessionKeys.forEach(key => localStorage.removeItem(key));

    window.location.href = '../login/login.html';
}

// ===== UI event wiring =====
// Sets up click listeners for all UI buttons and modals
function initializeEventListeners() {
    const eventMappings = [
        // --- Main Navigation ---
        { id: 'historyBtn', event: 'click', handler: openActivityModal },
        { id: 'homeBtn', event: 'click', handler: centerMapToDevice },
        { id: 'logoutBtn', event: 'click', handler: logout },
        { id: 'toggleGeofence', event: 'click', handler: toggleGeofenceDrawing },

        // --- Action Buttons (Panel) ---
        { id: 'vibrateBtn', event: 'click', handler: vibrateDevice },
        { id: 'devicePasswordBtn', event: 'click', handler: openDevicePasswordModal },

        // --- Account Password (Bottom Nav) ---
        { id: 'changePasswordBtn', event: 'click', handler: openPasswordModal },
        { id: 'closePasswordModal', event: 'click', handler: closePasswordModal },
        { id: 'cancelPasswordBtn', event: 'click', handler: closePasswordModal },
        { id: 'savePasswordBtn', event: 'click', handler: saveNewPassword },
        { id: 'currentPassword', event: 'keypress', handler: (e) => { if (e.key === 'Enter') saveNewPassword(); } },
        { id: 'newPassword', event: 'keypress', handler: (e) => { if (e.key === 'Enter') saveNewPassword(); } },

        // --- Device Password (New Modal) ---
        { id: 'closeDevicePasswordModal', event: 'click', handler: closeDevicePasswordModal },
        { id: 'cancelDevicePassBtn', event: 'click', handler: closeDevicePasswordModal },
        { id: 'saveDevicePassBtn', event: 'click', handler: saveDevicePassword },
        { id: 'currentDevicePass', event: 'keypress', handler: (e) => { if (e.key === 'Enter') saveDevicePassword(); } },
        { id: 'newDevicePass', event: 'keypress', handler: (e) => { if (e.key === 'Enter') saveDevicePassword(); } },

        // --- Modals ---
        { id: 'activityClose', event: 'click', handler: closeActivityModal },

        { id: 'saveNameBtn', event: 'click', handler: saveDeviceName },
        { id: 'closeNameModal', event: 'click', handler: closeNameModal },
        { id: 'cancelNameBtn', event: 'click', handler: closeNameModal },
        { id: 'deviceName', event: 'click', handler: openNameModal },
        { id: 'locationName', event: 'click', handler: centerMapToDevice },

        { id: 'addDeviceBtn', event: 'click', handler: openAddDeviceModal },
        { id: 'closeAddDeviceModal', event: 'click', handler: () => document.getElementById('addDeviceModal').classList.remove('active') },
        { id: 'cancelAddDevice', event: 'click', handler: () => document.getElementById('addDeviceModal').classList.remove('active') },
        { id: 'saveAddDevice', event: 'click', handler: saveNewDeviceLink },
        { id: 'newDeviceId', event: 'keypress', handler: (e) => { if (e.key === 'Enter') saveNewDeviceLink(); } },
        { id: 'newDevicePassword', event: 'keypress', handler: (e) => { if (e.key === 'Enter') saveNewDeviceLink(); } },

        // --- Activity History Pagination ---
        { id: 'prevPageBtn', event: 'click', handler: prevPage },
        { id: 'nextPageBtn', event: 'click', handler: nextPage }
    ];

    eventMappings.forEach(({ id, event, handler }) => {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener(event, handler);
        }
    });

    enableDeviceTabsWheelScroll();
}

// Allows scrolling the horizontal device tabs with the mouse wheel
function enableDeviceTabsWheelScroll() {
    const tabs = document.querySelector('.device-tabs');
    if (!tabs) return;

    tabs.addEventListener('wheel', (e) => {
        // Only translate vertical wheel into horizontal scroll when vertical intent is stronger
        if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
        e.preventDefault();
        tabs.scrollLeft += e.deltaY;
    }, { passive: false });
}

// ===== Vibrate action & cooldown =====
const VIBRATE_COOLDOWN_SECONDS = 30;
const VIBRATE_COOLDOWN_KEY_PREFIX = 'vibrateCooldownEnd_';
let vibrateCooldownInterval = null;

// Gets the device-specific cooldown key
function getVibrateCooldownKey(deviceId) {
    return VIBRATE_COOLDOWN_KEY_PREFIX + (deviceId || loggedInDeviceId);
}

// Gets the visible text node inside the vibrate button (preserves SVG icon)
function getVibrateBtnText(btn) {
    return btn.querySelector('[data-i18n="map.vibrateDevice"]')
        || Array.from(btn.childNodes).find(node => node.nodeType === 3 && node.textContent.trim().length > 0);
}

function getTranslationText(key, fallback) {
    if (typeof getNestedTranslation === 'function') {
        return getNestedTranslation(key) || fallback;
    }
    return fallback;
}

function getGeofenceBtnLabel(btn) {
    return btn ? btn.querySelector('[data-i18n]') : null;
}

// Checks and updates the vibrate button cooldown state for current device
function checkVibrateCooldown() {
    const btn = document.getElementById('vibrateBtn');
    if (!btn || !loggedInDeviceId) return false;

    const cooldownKey = getVibrateCooldownKey(loggedInDeviceId);
    const cooldownEnd = localStorage.getItem(cooldownKey);

    if (vibrateCooldownInterval) {
        clearInterval(vibrateCooldownInterval);
        vibrateCooldownInterval = null;
    }

    if (cooldownEnd) {
        const remaining = Math.ceil((parseInt(cooldownEnd) - Date.now()) / 1000);
        if (remaining > 0) {
            btn.disabled = true;
            const textNode = getVibrateBtnText(btn);
            if (textNode) textNode.textContent = `Wait ${remaining}s`;

            vibrateCooldownInterval = setInterval(() => {
                const currentKey = getVibrateCooldownKey(loggedInDeviceId);
                const currentCooldownEnd = localStorage.getItem(currentKey);
                if (!currentCooldownEnd) {
                    clearInterval(vibrateCooldownInterval);
                    vibrateCooldownInterval = null;
                    const t = getVibrateBtnText(btn);
                    if (t) t.textContent = getTranslationText('map.vibrateDevice', 'Vibrate Device');
                    btn.disabled = false;
                    return;
                }
                const newRemaining = Math.ceil((parseInt(currentCooldownEnd) - Date.now()) / 1000);
                if (newRemaining <= 0) {
                    clearInterval(vibrateCooldownInterval);
                    vibrateCooldownInterval = null;
                    localStorage.removeItem(currentKey);
                    const t = getVibrateBtnText(btn);
                    if (t) t.textContent = getTranslationText('map.vibrateDevice', 'Vibrate Device');
                    btn.disabled = false;
                } else {
                    const t = getVibrateBtnText(btn);
                    if (t) t.textContent = `Wait ${newRemaining}s`;
                }
            }, 1000);
            return true;
        } else {
            localStorage.removeItem(cooldownKey);
        }
    }

    const textNode = getVibrateBtnText(btn);
    if (textNode) textNode.textContent = getTranslationText('map.vibrateDevice', 'Vibrate Device');
    btn.disabled = false;
    return false;
}

async function vibrateDevice() {
    if (!loggedInDeviceId) return;

    if (!lastUpdateTime || (Date.now() - lastUpdateTime > 300000)) {
        if (typeof showAlert !== 'undefined') {
            showAlert(getTranslationText('alerts.deviceNotActive', 'Device is not active'), 'error');
        }
        return;
    }

    const btn = document.getElementById('vibrateBtn');
    if (checkVibrateCooldown()) return;

    const textNode = getVibrateBtnText(btn);
    if (textNode) textNode.textContent = getTranslationText('alerts.sending', 'Sending...');
    btn.disabled = true;

    await apiCall(`vibrateDevice&device_id=${encodeURIComponent(loggedInDeviceId)}`);
    showAlert(getTranslationText('alerts.vibrationSent', 'Vibration command sent!'), 'success');

    const cooldownKey = getVibrateCooldownKey(loggedInDeviceId);
    const cooldownEnd = Date.now() + (VIBRATE_COOLDOWN_SECONDS * 1000);
    localStorage.setItem(cooldownKey, cooldownEnd.toString());
    checkVibrateCooldown();
}

// ===== Device password management =====

function openDevicePasswordModal() {
    const modal = document.getElementById('devicePasswordModal');
    if (modal) {
        modal.classList.add('active');
        const input = document.getElementById('newDevicePass');
        if (input) {
            input.value = '';
            input.focus();
        }
    }
}

function closeDevicePasswordModal() {
    const modal = document.getElementById('devicePasswordModal');
    if (modal) modal.classList.remove('active');
}

async function saveDevicePassword() {
    const currentPassInput = document.getElementById('currentDevicePass');
    const newPassInput = document.getElementById('newDevicePass');

    const currentPass = currentPassInput ? currentPassInput.value : '';
    const newPass = newPassInput ? newPassInput.value : '';
    const saveBtn = document.getElementById('saveDevicePassBtn');

    if (!currentPass || !newPass) return showAlert(getTranslationText('alerts.fillAllFields', 'Please fill all fields'));
    if (currentPass === newPass) return showAlert(getTranslationText('alerts.samePassword', 'New password cannot be the same as the current password'));
    if (!loggedInDeviceId) return;

    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.dataset.originalText = saveBtn.textContent;
        saveBtn.innerHTML = `<span class="btn-spinner"></span>${getTranslationText('alerts.updating', 'Updating...')}`;
    }

    // Call API to update DEVICE password
    const result = await apiCall('updateDevicePassword', 'POST', {
        device_id: loggedInDeviceId,
        current_password: currentPass,
        new_password: newPass
    });

    if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = saveBtn.dataset.originalText || getTranslationText('modal.update', 'Save');
    }

    if (result.success) {
        closeDevicePasswordModal();
        const unlinked = result.unlinked_count || 0;
        const msg = unlinked > 0
            ? getTranslationText('alerts.devicePasswordUpdatedUnlinked', `Device password updated. ${unlinked} other linked user(s) were automatically unlinked.`).replace('{count}', unlinked)
            : getTranslationText('alerts.devicePasswordUpdated', 'Device password updated successfully.');
        showAlert(msg, 'success');
        if (currentPassInput) currentPassInput.value = '';
        if (newPassInput) newPassInput.value = '';
    } else {
        showAlert(result.error || getTranslationText('alerts.failedUpdatePassword', 'Failed to update password'));
    }
}

// Links a new device to the current user account
async function saveNewDeviceLink() {
    const deviceId = document.getElementById('newDeviceId').value.trim();
    const devicePassword = document.getElementById('newDevicePassword').value;
    const userid = localStorage.getItem('user_id');
    const saveBtn = document.getElementById('saveAddDevice');

    if (!deviceId || !devicePassword) {
        showAlert(getTranslationText('alerts.fillAllFields', 'Please fill all fields'));
        return;
    }

    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.dataset.originalText = saveBtn.textContent;
        saveBtn.innerHTML = `<span class="btn-spinner"></span>${getTranslationText('alerts.adding', 'Adding...')}`;
    }

    const result = await apiCall('linkDevice', 'POST', {
        user_id: userid,
        device_id: deviceId,
        device_password: devicePassword
    });

    if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = saveBtn.dataset.originalText || getTranslationText('modal.addDevice', 'Add Device');
    }

    if (result.success) {
        showAlert(getTranslationText('alerts.deviceLinked', 'Device linked successfully!'), 'success');
        document.getElementById('addDeviceModal').classList.remove('active');
        document.getElementById('newDeviceId').value = '';
        document.getElementById('newDevicePassword').value = '';
        loadUserDevices();
    } else {
        showAlert(result.error || getTranslationText('alerts.failedLinkDevice', 'Failed to link device'));
    }
}

// ===== Device list & selection =====
function fitMapToAllDevices() {
    const markerKeys = Object.keys(markers);
    if (markerKeys.length === 0) return;

    const bounds = [];
    markerKeys.forEach(id => {
        if (markers[id]) {
            bounds.push(markers[id].getLatLng());
        }
    });

    if (bounds.length > 0) {
        map.fitBounds(bounds, { padding: [50, 50] });
    }
}

// Fetches and displays the list of devices associated with the user
async function loadUserDevices() {
    const deviceTabs = document.getElementById('deviceTabs');
    const userid = localStorage.getItem('user_id');

    if (!deviceTabs || !userid) return;

    const data = await apiCall(`getUserDevices&user_id=${encodeURIComponent(userid)}`);

    if (data.success && data.devices && data.devices.length > 0) {
        allDeviceIds = data.devices.map(d => d.device_id);

        deviceTabs.innerHTML = '';

        // Preload ALL device data including geocoding (in parallel)
        const preloadPromises = data.devices.map(async (device) => {
            // Create tab for device
            const deviceTab = createDeviceTab(device);
            deviceTabs.appendChild(deviceTab);

            // Cache location data (handling valid OR invalid/0.0 coordinates)
            if (device.current_latitude !== null && device.current_longitude !== null) {
                const lat = parseFloat(device.current_latitude);
                const lng = parseFloat(device.current_longitude);

                // Check if GPS coordinates are valid (not 0 or near 0)
                const isValidGPS = Math.abs(lat) > 0.01 && Math.abs(lng) > 0.01;

                let locationName = null;
                let locationData = null;

                if (isValidGPS) {
                    // Valid GPS: Use server-provided address
                    locationName = device.location_address || `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

                    locationData = {
                        lat: lat,
                        lng: lng,
                        battery: device.battery_level,
                        timestamp: device.timestamp,
                        locationName: locationName
                    };

                    // Create marker for this device
                    if (!markers[device.device_id]) {
                        markers[device.device_id] = L.marker([lat, lng], {
                            icon: createCustomMarkerIcon(device.device_name || device.device_id)
                        }).addTo(map);

                        markers[device.device_id].on('click', (e) => {
                            if (pendingMapClick) {
                                // Use the click location for geofence placement
                                pendingMapClick({ latlng: e.latlng });
                                // Prevent default zoom behavior
                                return;
                            }
                            selectDevice(device.device_id);
                            map.setView([lat, lng], 18);
                        });
                    }
                } else {
                    // Invalid GPS (0,0): Use last known coordinates if available
                    locationName = `No GPS Signal`;

                    // Get last known coordinates from API if available
                    const lastKnownLat = device.last_known_latitude ? parseFloat(device.last_known_latitude) : null;
                    const lastKnownLng = device.last_known_longitude ? parseFloat(device.last_known_longitude) : null;
                    const hasLastKnownCoords = lastKnownLat && lastKnownLng && Math.abs(lastKnownLat) > 0.01 && Math.abs(lastKnownLng) > 0.01;

                    locationData = {
                        lat: hasLastKnownCoords ? lastKnownLat : null,
                        lng: hasLastKnownCoords ? lastKnownLng : null,
                        battery: device.battery_level,
                        timestamp: device.timestamp,
                        locationName: locationName,
                        lastKnownAddress: device.last_known_address
                    };

                    // Create marker with last known coordinates if available
                    if (hasLastKnownCoords && !markers[device.device_id]) {
                        markers[device.device_id] = L.marker([lastKnownLat, lastKnownLng], {
                            icon: createCustomMarkerIcon(device.device_name || device.device_id)
                        }).addTo(map);

                        markers[device.device_id].on('click', (e) => {
                            if (pendingMapClick) {
                                // Use the click location for geofence placement
                                pendingMapClick({ latlng: e.latlng });
                                // Prevent default zoom behavior
                                return;
                            }
                            selectDevice(device.device_id);
                            map.setView([lastKnownLat, lastKnownLng], 18);
                        });
                    }
                }

                // Cache the location data (valid or invalid)
                deviceLocationCache[device.device_id] = locationData;
            }

            // Preload geofence for this device
            await loadGeofenceFromDatabase(device.device_id);
        });

        // Wait for all preloading to complete
        await Promise.all(preloadPromises);

        appendAddDeviceButton(deviceTabs);

        // Determine which device to select initially
        let deviceToSelect = loggedInDeviceId;
        if (!deviceToSelect || !data.devices.find(d => d.device_id === loggedInDeviceId)) {
            deviceToSelect = data.devices[0].device_id;
        }

        // Select the device (this sets the UI text) - data is already cached so instant
        await selectDevice(deviceToSelect, true);

        // Initialize MQTT only on first load, then subscribe to any new devices
        if (!mqttClient) {
            // First time initialization
            initMQTT();
        } else {
            // Already connected - subscribe to any new devices
            data.devices.forEach(device => {
                subscribeToDevice(device.device_id);
            });
        }

        // Force the map to fit markers immediately
        setTimeout(() => {
            fitMapToAllDevices();
        }, 300);

        const hasDefaultPassDevices = data.devices.filter(d => d.has_default_password);
        if (hasDefaultPassDevices.length > 0) {
            const names = hasDefaultPassDevices.map(d => d.device_name || d.device_id).join(', ');
            showAlert(getTranslationText('alerts.changeDefaultPassword', `${names} — Change the device password immediately!`).replace('{names}', names), 'warning', true);
        }

    } else {
        deviceTabs.innerHTML = '';
        appendAddDeviceButton(deviceTabs);

        // Update UI to show no device added
        document.getElementById('deviceName').textContent = 'No device added';
        document.getElementById('locationName').textContent = 'No device added';
        document.getElementById('lastUpdate').textContent = 'No device added';
        document.getElementById('batteryLevel').textContent = 'No device added';
    }
}

// Adds the plus button to the device list
function appendAddDeviceButton(container) {
    const addBtn = document.createElement('button');
    addBtn.className = 'device-tab add-device-btn';
    addBtn.title = 'Add Device';
    addBtn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>`;
    addBtn.addEventListener('click', openAddDeviceModal);
    container.appendChild(addBtn);
}

// Generates the DOM element for a single device tab
function createDeviceTab(device) {
    // Container div acting as the tab
    const container = document.createElement('div');
    container.className = 'device-tab';
    container.dataset.deviceid = device.device_id;
    container.title = `Switch to ${device.device_name || device.device_id}`;

    // Name Span
    const nameSpan = document.createElement('span');
    nameSpan.textContent = device.device_name || device.device_id;
    nameSpan.style.pointerEvents = 'none';
    container.appendChild(nameSpan);

    // Status Dot
    const statusDot = document.createElement('span');
    statusDot.className = 'device-status-dot';
    statusDot.dataset.deviceid = device.device_id;
    container.appendChild(statusDot);

    // Remove Button (Trash/X)
    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-device-btn';
    removeBtn.innerHTML = '&times;'; // Multiplication sign (×) as icon
    removeBtn.title = 'Remove Device from Account';

    // Remove Click Handler
    removeBtn.addEventListener('click', async (e) => {
        e.stopPropagation(); // Prevent switching to the device when clicking remove

        const deviceName = device.device_name || device.device_id;

        showConfirm(getTranslationText('alerts.confirmRemoveDevice', `Are you sure you want to remove "${deviceName}" from your account?\n\nThis action cannot be undone.`).replace('{name}', deviceName), async () => {
            const data = await apiCall(`removeDevice&device_id=${encodeURIComponent(device.device_id)}`);

            if (data.success) {
                // If we removed the currently selected device, clear selection
                if (loggedInDeviceId === device.device_id) {
                    loggedInDeviceId = null;
                    localStorage.removeItem('loggedInDeviceId');
                }

                showAlert(getTranslationText('alerts.deviceRemoved', 'Device removed successfully'), 'success');

                // Refresh the tab after showing the alert
                setTimeout(() => {
                    window.location.reload();
                }, 1000);
            } else {
                showAlert(getTranslationText('alerts.failedRemoveDevice', 'Failed to remove device') + ': ' + (data.error || 'Unknown error'), 'error');
            }
        });
    });

    container.appendChild(removeBtn);

    // Main Click Handler (Select Device)
    container.addEventListener('click', () => selectDevice(device.device_id));

    return container;
}

// Handles switching between different user devices
async function selectDevice(deviceId, isFirstLoad = false) {
    // Cancel any pending requests from previous device switch
    if (currentAbortController) {
        currentAbortController.abort();
    }
    currentAbortController = new AbortController();

    loggedInDeviceId = deviceId;
    localStorage.setItem('loggedInDeviceId', deviceId);

    // Reset UI text states
    lastUpdateTime = null;
    lastValidLocation = { lat: null, lng: null, locationName: null, battery: null };
    lastGeofenceStatus = false;

    let deviceName = 'Device';
    document.querySelectorAll('.device-tab').forEach(tab => {
        if (tab.classList.contains('add-device-btn')) return;
        const isMatch = tab.dataset.deviceid === deviceId;
        tab.classList.toggle('active', isMatch);
        if (isMatch) {
            deviceName = tab.firstChild.textContent || tab.textContent;
        }
    });

    document.getElementById('deviceName').textContent = deviceName;

    // Check if we have cached data for this device - show instantly
    const cachedLocation = deviceLocationCache[deviceId];
    if (cachedLocation) {
        // Immediately display cached data while fresh data loads
        document.getElementById('locationName').textContent = cachedLocation.locationName || "Loading...";
        document.getElementById('batteryLevel').textContent = `${cachedLocation.battery || 0}%`;
        lastValidLocation = { ...cachedLocation };
        lastUpdateTime = cachedLocation.timestamp ? new Date(cachedLocation.timestamp).getTime() : null;
        updateTimeSinceLastUpdate();
        // Immediately calculate and display device status based on cached timestamp
        if (cachedLocation.timestamp) {
            updateDeviceStatus(cachedLocation.timestamp);
        }
    } else {
        document.getElementById('locationName').textContent = "Loading...";
        document.getElementById('batteryLevel').textContent = "--%";
        document.getElementById('deviceStatus').textContent = "Loading...";
    }

    const timeEl = document.getElementById('lastUpdate');
    if (timeEl && !cachedLocation) timeEl.textContent = "Never";

    // Clear old intervals
    if (updateInterval) clearInterval(updateInterval);
    if (timeUpdateInterval) clearInterval(timeUpdateInterval);
    if (activityHistoryUpdateInterval) clearInterval(activityHistoryUpdateInterval);

    // Only fetch location from API if no cache AND MQTT not connected
    // Otherwise, MQTT will push updates and we use cached data
    if (!cachedLocation && !mqttConnected) {
        await updateLocation();
    }

    // Redraw geofences for ALL devices to update colors (Active=Orange, Others=Blue)
    // This ensures the previously selected device turns blue
    if (allDeviceIds && allDeviceIds.length > 0) {
        allDeviceIds.forEach(id => {
            loadGeofenceFromDatabase(id);
        });
    } else {
        await loadGeofenceFromDatabase(); // Fallback if list empty
    }

    // MQTT handles real-time updates - no background polling needed
    updateTimeSinceLastUpdate();
    timeUpdateInterval = setInterval(updateTimeSinceLastUpdate, 1000);
    updateActivityHistory(); // Uses cache on device switch

    // Update vibrate button cooldown state for this device
    checkVibrateCooldown();
}

// Displays the modal for adding a new device
function openAddDeviceModal() {
    const modal = document.getElementById('addDeviceModal');
    if (modal) {
        modal.classList.add('active');
        const input = document.getElementById('newDeviceId');
        if (input) input.focus();
    }
}

// ===== Push notifications =====
// Registers service worker only (subscription is handled by the toggle button)
async function requestNotificationPermission() {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
        return;
    }

    try {
        // Register service worker (needed for push toggle to work)
        await navigator.serviceWorker.register('/sw.js');
    } catch (error) {
        console.error('[Notif] Service worker registration error:', error);
    }
}

// Subscribe to push notifications
async function subscribeToPush(registration) {
    try {
        // Get VAPID public key from server
        const keyResponse = await fetch('../api.php?action=getVapidPublicKey');
        const keyData = await keyResponse.json();

        if (!keyData.publicKey) {
            return;
        }

        // Convert VAPID key to Uint8Array
        const vapidKey = urlBase64ToUint8Array(keyData.publicKey);

        // Subscribe to push
        const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: vapidKey
        });

        // Send subscription to server
        const subJson = subscription.toJSON();
        await apiCall('savePushSubscription', 'POST', {
            endpoint: subJson.endpoint,
            keys: subJson.keys
        });

    } catch (error) {
        console.error('[Notif] Subscribe error:', error);
    }
}

// Helper: Convert base64url to Uint8Array for VAPID key
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

// --- Notification Toggle Button ---
async function initNotifToggleBtn() {
    const btn = document.getElementById('notifToggleBtn');
    if (!btn || !('serviceWorker' in navigator) || !('PushManager' in window)) return;

    try {
        await navigator.serviceWorker.register('/sw.js');
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        const isSubscribed = !!sub;
        btn.classList.toggle('subscribed', isSubscribed);
        notificationsEnabled = isSubscribed;
    } catch (e) {
        // Silent fail — button stays in default state
    }

    btn.addEventListener('click', togglePushSubscription);
}

let notifToggleBusy = false;
async function togglePushSubscription() {
    const btn = document.getElementById('notifToggleBtn');
    if (!btn || notifToggleBusy) return;

    notifToggleBusy = true;
    btn.style.pointerEvents = 'none';
    btn.style.opacity = '0.5';

    try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();

        if (sub) {
            // Unsubscribe from browser
            const endpoint = sub.endpoint;
            await sub.unsubscribe();
            // Also delete from server
            try {
                await apiCall('deletePushSubscription', 'POST', { endpoint: endpoint });
            } catch (e) {
                console.error('[Notif] Failed to delete subscription from server:', e);
            }
            btn.classList.remove('subscribed');
            notificationsEnabled = false;
            showAlert(getTranslationText('alerts.notificationsDisabled', 'Notifications disabled'), 'success');
        } else {
            // Subscribe
            if (Notification.permission === 'denied') {
                showAlert(getTranslationText('alerts.notificationsBlocked', 'Notifications blocked. Enable in browser settings.'), 'error');
                return;
            }
            if (Notification.permission === 'default') {
                const perm = await Notification.requestPermission();
                if (perm !== 'granted') return;
            }
            await subscribeToPush(reg);
            // Verify subscription was created
            const newSub = await reg.pushManager.getSubscription();
            if (newSub) {
                btn.classList.add('subscribed');
                notificationsEnabled = true;
                showAlert(getTranslationText('alerts.notificationsEnabled', 'Notifications enabled'), 'success');
            } else {
                showAlert(getTranslationText('alerts.failedEnableNotifications', 'Failed to enable notifications'), 'error');
            }
        }
    } catch (e) {
        console.error('[Notif] Toggle error:', e);
        showAlert(getTranslationText('alerts.failedToggleNotifications', 'Failed to toggle notifications'), 'error');
    } finally {
        notifToggleBusy = false;
        btn.style.pointerEvents = '';
        btn.style.opacity = '';
    }
}


// ===== Map & markers =====
// Initializes the Leaflet map and default marker (Hidden by default)
function initMap() {
    const defaultCoords = [14.6565, 121.0315];

    map = L.map('map', {
        zoomControl: true,
        attributionControl: false
    }).setView(defaultCoords, 18);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19
    }).addTo(map);

    // Note: We do NOT define "marker" here anymore. 
    // Markers are now created dynamically in processLocationUpdate.
}


// Creates the HTML structure for the map marker
function createCustomMarkerIcon(deviceName = 'Device') {
    return L.divIcon({
        className: 'custom-marker',
        html: `
            <div class="marker-label">${deviceName}</div>
            <div class="pulse"></div>
        `,
        iconSize: [30, 42],
        iconAnchor: [15, 42],
        popupAnchor: [0, -42]
    });
}

// Creates the HTML structure for a yellow history map marker with an X button
function createHistoryMarkerIcon(deviceName, locationName, formattedDate, markerId) {
    // Provide defaults so the label doesn't look broken
    const dName = deviceName || 'Device';
    const lName = locationName || 'Unknown Location';
    const fDate = formattedDate || '';

    return L.divIcon({
        className: 'custom-marker', // re-uses base marker wrapper
        html: `
            <div class="history-marker-label">
                <div class="history-marker-header">
                    <span>${dName}</span>
                    <button class="history-close-btn" onclick="removeHistoryMarker('${markerId}')" title="Remove Marker">✖</button>
                </div>
                <div>${lName}</div>
                <div style="color: #bbb;">${fDate}</div>
            </div>
            <div class="history-pulse"></div>
        `,
        iconSize: [30, 42],
        iconAnchor: [15, 42],
        popupAnchor: [0, -42]
    });
}

// Pans the map view to the last known device location
function centerMapToDevice() {
    if (map && lastValidLocation.lat && lastValidLocation.lng) {
        map.setView([lastValidLocation.lat, lastValidLocation.lng], 18);
    }
}

// Shows the activity history modal and triggers an update
function openActivityModal() {
    if (activityModal) {
        activityModal.classList.add('active');
        activityModal.classList.remove('side-panel');
        isFirstActivityClick = true;
        // Clear search on open
        const searchInput = document.getElementById('activitySearchInput');
        if (searchInput) searchInput.value = '';
        activitySearchQuery = '';
        updateActivityHistory();
    }
}

// Hides the activity history modal
function closeActivityModal() {
    if (activityModal) {
        activityModal.classList.remove('active');
        activityModal.classList.remove('side-panel');
    }

    // Remove all yellow history markers from the map
    Object.keys(historyMarkers).forEach(id => {
        if (historyMarkers[id]) {
            map.removeLayer(historyMarkers[id]);
        }
    });
    historyMarkers = {};
}


// ===== Activity history & pagination =====
const ITEMS_PER_PAGE = 10;
let currentPage = 1;
let totalPages = 1;
let isLoadingHistory = false;
let activityMode = 'simple'; // 'simple' or 'all'
let activitySearchQuery = '';

// Returns filtered history based on current mode and search query
function getFilteredHistory() {
    let filtered = activityHistory;

    // Simple mode: deduplicate consecutive same-street entries, keep the first (most recent)
    if (activityMode === 'simple') {
        const deduped = [];
        for (let i = 0; i < filtered.length; i++) {
            const name = (filtered[i].locationName || '').trim().toLowerCase();
            const prevName = deduped.length > 0 ? (deduped[deduped.length - 1].locationName || '').trim().toLowerCase() : null;
            if (name !== prevName) {
                deduped.push(filtered[i]);
            }
        }
        filtered = deduped;
    }

    // Search filter
    if (activitySearchQuery) {
        const q = activitySearchQuery.toLowerCase();
        filtered = filtered.filter(entry => {
            const loc = (entry.locationName || '').toLowerCase();
            // Format date for search matching
            const date = new Date(entry.timestamp);
            const dateStr = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).toLowerCase();
            const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
            return loc.includes(q) || dateStr.includes(q) || timeStr.includes(q);
        });
    }

    return filtered;
}

// Wire up toolbar event listeners (called once)
function initActivityToolbar() {
    const modeSelect = document.getElementById('activityModeSelect');
    const searchInput = document.getElementById('activitySearchInput');
    const searchBtn = document.getElementById('activitySearchBtn');

    if (modeSelect) {
        modeSelect.addEventListener('change', () => {
            activityMode = modeSelect.value;
            currentPage = 1;
            const filtered = getFilteredHistory();
            totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE) || 1;
            displayActivityHistory();
        });
    }

    // Search via button click or Enter key
    async function performSearch() {
        const query = searchInput ? searchInput.value.trim() : '';
        activitySearchQuery = query;
        currentPage = 1;

        if (!query) {
            // Empty search: revert to cached data
            if (activityHistoryCache[loggedInDeviceId]) {
                activityHistory = activityHistoryCache[loggedInDeviceId];
            }
            const filtered = getFilteredHistory();
            totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE) || 1;
            displayActivityHistory();
            return;
        }

        // Show loading
        if (activityList) {
            // Show loading safely
            if (activityList) {
                activityList.innerHTML = '';

                const loadingDiv = document.createElement('div');
                loadingDiv.className = 'activity-loading';

                const spinnerDiv = document.createElement('div');
                spinnerDiv.className = 'activity-spinner';

                const textP = document.createElement('p');
                textP.className = 'activity-loading-text';
                textP.textContent = getTranslationText('activity.searching', 'Searching...');

                loadingDiv.appendChild(spinnerDiv);
                loadingDiv.appendChild(textP);
                activityList.appendChild(loadingDiv);
            }
        }
        if (searchBtn) searchBtn.disabled = true;

        // Server-side search
        const data = await apiCall(`searchHistory&device_id=${encodeURIComponent(loggedInDeviceId)}&search=${encodeURIComponent(query)}`);

        if (searchBtn) searchBtn.disabled = false;

        if (data.success && data.history) {
            activityHistory = data.history;
            const filtered = getFilteredHistory();
            totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE) || 1;
            await displayActivityHistory();
        } else {
            if (activityList) {
                activityList.innerHTML = '';
                const emptyDiv = document.createElement('div');
                emptyDiv.className = 'activity-empty';
                emptyDiv.textContent = getTranslationText('activity.noResults', 'No results found');
                activityList.appendChild(emptyDiv);
            }
            updatePaginationControls();
        }
    }

    if (searchBtn) {
        searchBtn.addEventListener('click', performSearch);
    }

    if (searchInput) {
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                performSearch();
            }
        });
    }
}

// Fetches recent device history from the server
async function updateActivityHistory(forceRefresh = false) {
    if (!loggedInDeviceId) return;

    // Check cache first (unless forcing refresh)
    if (!forceRefresh && activityHistoryCache[loggedInDeviceId]) {
        activityHistory = activityHistoryCache[loggedInDeviceId];
        currentPage = 1;
        const filtered = getFilteredHistory();
        totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE) || 1;
        await displayActivityHistory();
        return;
    }

    // Not cached - fetch from API
    const data = await apiCall(`getHistory&device_id=${encodeURIComponent(loggedInDeviceId)}&results=${FETCH_RESULTS_LIMIT}`);

    if (data.success && data.history) {
        // Use server-side geocoded addresses if available
        const historyWithAddresses = data.history.map(entry => {
            if (entry.locationName) {
                return entry; // Already has server-side geocoded address
            }
            return entry; // Fallback to client-side geocoding if needed
        });

        activityHistoryCache[loggedInDeviceId] = historyWithAddresses;
        activityHistory = historyWithAddresses;
        currentPage = 1;
        const filtered = getFilteredHistory();
        totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE) || 1;
        await displayActivityHistory();
    }
}

// Renders the list of historical activity entries with pagination
async function displayActivityHistory() {
    if (!activityList) return;

    // Prevent multiple simultaneous loads
    if (isLoadingHistory) return;
    isLoadingHistory = true;

    // Show loading state safely
    activityList.innerHTML = '';
    const loadDiv = document.createElement('div');
    loadDiv.className = 'activity-loading';

    const spinDiv = document.createElement('div');
    spinDiv.className = 'activity-spinner';

    const txtP = document.createElement('p');
    txtP.className = 'activity-loading-text';
    txtP.textContent = getTranslationText('activity.loadingLocations', 'Loading locations...');

    loadDiv.appendChild(spinDiv);
    loadDiv.appendChild(txtP);
    activityList.appendChild(loadDiv);

    if (activityHistory.length === 0) {
        activityList.innerHTML = '';
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'activity-empty';
        emptyDiv.textContent = getTranslationText('activity.noHistory', 'No activity history available');
        activityList.appendChild(emptyDiv);
        updatePaginationControls();
        isLoadingHistory = false;
        return;
    }

    // Get filtered history and current page items
    const filtered = getFilteredHistory();
    totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE) || 1;
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, filtered.length);
    const pageItems = filtered.slice(startIndex, endIndex);

    // Load all geocoded addresses for this page (with cache support)
    const itemsWithAddresses = await Promise.all(
        pageItems.map(async (entry) => {
            // Check for valid GPS coordinates first
            const hasValidGPS = entry.lat && entry.lng &&
                Math.abs(entry.lat) > 0.01 && Math.abs(entry.lng) > 0.01;

            if (!hasValidGPS) {
                // GPS coordinates are invalid (0,0) - ALWAYS use last known address if available
                // This overrides any "0, 0" locationName that might be in the API response
                entry.locationName = "No GPS Signal";
                return entry;
            }

            // Valid GPS coordinates - use server-provided address
            if (!entry.locationName) {
                entry.locationName = `${entry.lat.toFixed(6)}, ${entry.lng.toFixed(6)}`;
            }
            return entry;
        })
    );

    // Clear and render
    activityList.innerHTML = '';

    itemsWithAddresses.forEach(entry => {
        const div = document.createElement('div');
        div.className = 'activity-item';

        // Format date nicely: "January 1 at 10:30 AM"
        const date = new Date(entry.timestamp);
        const dateOptions = { month: 'long', day: 'numeric' };
        const timeOptions = { hour: 'numeric', minute: '2-digit', hour12: true };
        const formattedDate = `${date.toLocaleDateString('en-US', dateOptions)} at ${date.toLocaleTimeString('en-US', timeOptions)}`;

        // Only allow click navigation if valid GPS
        const hasValidGPS = entry.lat && entry.lng &&
            Math.abs(entry.lat) > 0.01 && Math.abs(entry.lng) > 0.01;

        // Create a unique ID for this history marker early so it can be used for the element ID
        const markerId = 'history_' + entry.timestamp;

        if (hasValidGPS) {
            div.id = `list-item-${markerId}`; // Set ID so it can be restored on close
        }

        const timeDiv = document.createElement('div');
        timeDiv.className = 'activity-time';
        timeDiv.textContent = '🕐 ' + formattedDate;

        const locDiv = document.createElement('div');
        locDiv.className = 'activity-location';
        locDiv.textContent = '📍 ' + (entry.locationName || 'Unknown Location');

        const battDiv = document.createElement('div');
        battDiv.className = 'activity-battery';
        battDiv.textContent = '🔋 ' + (entry.battery || 0) + '%';

        div.appendChild(timeDiv);
        div.appendChild(locDiv);
        div.appendChild(battDiv);

        if (hasValidGPS) {
            div.style.cursor = 'pointer';

            // Visually distinguish if it's already active
            if (historyMarkers[markerId]) {
                div.style.opacity = '0.5';
            }

            div.addEventListener('click', () => {
                if (historyMarkers[markerId]) {
                    // Already clicked, just pan to location and return
                    map.setView([entry.lat, entry.lng], 18);
                    return;
                }

                div.style.opacity = '0.5'; // Dim it to show it's clicked
                map.setView([entry.lat, entry.lng], 18);

                // Fetch the proper device name from the DOM (always up to date)
                const deviceName = document.getElementById('deviceName')?.textContent || loggedInDeviceId || 'Device';

                // Build the custom HTML icon
                const markerHtml = createHistoryMarkerIcon(deviceName, entry.locationName, formattedDate, markerId);

                // Add marker to map and track it
                const marker = L.marker([entry.lat, entry.lng], { icon: markerHtml }).addTo(map);
                historyMarkers[markerId] = marker;

                if (isFirstActivityClick) {
                    isFirstActivityClick = false;
                    const activityModalEl = document.getElementById('activityModal');
                    if (activityModalEl) {
                        activityModalEl.classList.add('side-panel');
                    }
                }
            });
        }

        activityList.appendChild(div);
    });

    updatePaginationControls();
    isLoadingHistory = false;
}

// Updates pagination button states and page info
function updatePaginationControls() {
    const prevBtn = document.getElementById('prevPageBtn');
    const nextBtn = document.getElementById('nextPageBtn');
    const pageInfo = document.getElementById('pageInfo');

    if (prevBtn) prevBtn.disabled = currentPage <= 1;
    if (nextBtn) nextBtn.disabled = currentPage >= totalPages;
    if (pageInfo) pageInfo.textContent = `${currentPage} / ${totalPages || 1}`;
}

// Go to previous page
async function prevPage() {
    if (currentPage > 1) {
        currentPage--;
        await displayActivityHistory();
    }
}

// Go to next page
async function nextPage() {
    if (currentPage < totalPages) {
        currentPage++;
        await displayActivityHistory();
    }
}

// ===== Naming & account password =====
// Opens the modal to rename the current device
function openNameModal() {
    if (nameModal) {
        nameModal.classList.add('active');
        const input = document.getElementById('deviceNameInput');
        if (input) {
            input.value = document.getElementById('deviceName')?.textContent || '';
            input.focus();
        }
    }
}

// Hides the device renaming modal
function closeNameModal() {
    if (nameModal) nameModal.classList.remove('active');
}

// Submits the new device name to the server
async function saveDeviceName() {
    const input = document.getElementById('deviceNameInput');
    if (!input || !loggedInDeviceId) return;

    const newName = input.value.trim();
    if (newName.length === 0) {
        showAlert(getTranslationText('alerts.nameEmpty', 'Device name cannot be empty'));
        return;
    }
    if (newName.length > 20) {
        showAlert(getTranslationText('alerts.nameTooLong', 'Device name must be 15 characters or less'));
        return;
    }

    const saveBtn = document.getElementById('saveNameBtn');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.dataset.originalText = saveBtn.textContent;
        saveBtn.innerHTML = `<span class="btn-spinner"></span>${getTranslationText('alerts.updating', 'Updating...')}`;
    }

    const result = await apiCall('updateDeviceName', 'POST', {
        deviceId: loggedInDeviceId,
        name: newName
    });

    if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = saveBtn.dataset.originalText || getTranslationText('modal.save', 'Save');
    }

    if (result.success) {
        const deviceNameElement = document.getElementById('deviceName');
        if (deviceNameElement) deviceNameElement.textContent = newName;

        const activeTab = document.querySelector(`.device-tab[data-deviceid="${loggedInDeviceId}"]`);
        if (activeTab) {
            const nameSpan = activeTab.querySelector('span:not(.device-status-dot)');
            if (nameSpan) nameSpan.textContent = newName;
        }

        // Update marker on map immediately
        if (markers[loggedInDeviceId]) {
            markers[loggedInDeviceId].setIcon(createCustomMarkerIcon(newName));
        }

        closeNameModal();
        showAlert(getTranslationText('alerts.nameUpdated', 'Device name updated'), 'success');
        setTimeout(() => location.reload(), 800);
    } else {
        showAlert(getTranslationText('alerts.failedUpdateName', 'Failed to update device name'));
    }
}

// Opens the change password modal and clears inputs
function openPasswordModal() {
    const modal = document.getElementById('passwordModal');
    if (modal) {
        modal.classList.add('active');
        ['currentPassword', 'newPassword', 'confirmPassword'].forEach(id => {
            document.getElementById(id).value = '';
        });
    }
}

// Hides the password change modal
function closePasswordModal() {
    const modal = document.getElementById('passwordModal');

    if (modal) modal.classList.remove('active');
}

// Validates and submits the new user password
async function saveNewPassword() {
    const currentPassword = document.getElementById('currentPassword')?.value;
    const newPassword = document.getElementById('newPassword')?.value;
    const userid = localStorage.getItem('user_id');
    const saveBtn = document.getElementById('savePasswordBtn');

    if (!currentPassword || !newPassword) return showAlert(getTranslationText('alerts.fillAllFields', 'Please fill all fields'));
    if (newPassword.length < 6) return showAlert(getTranslationText('alerts.passwordMinLength', 'Password must be at least 6 characters'));
    if (currentPassword === newPassword) return showAlert(getTranslationText('alerts.samePassword', 'New password cannot be the same as the current password'));

    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.dataset.originalText = saveBtn.textContent;
        saveBtn.innerHTML = `<span class="btn-spinner"></span>${getTranslationText('alerts.updating', 'Updating...')}`;
    }

    const result = await apiCall('updatePassword', 'POST', {
        userId: userid,
        oldPassword: currentPassword,
        newPassword: newPassword
    });

    if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = saveBtn.dataset.originalText || getTranslationText('modal.update', 'Save');
    }

    if (result.success) {
        closePasswordModal();
        showAlert(getTranslationText('alerts.passwordUpdated', 'Password updated successfully'), 'success');
    } else {
        showAlert(result.error || getTranslationText('alerts.failedUpdatePassword', 'Failed to update password'));
    }
}

// ===== Location refresh & processing =====
// Fetches the current location of the device from the server
async function updateLocation() {
    // 1. Update the currently selected device first (priority)
    if (loggedInDeviceId) {
        const data = await apiCall(`getLocation&device_id=${encodeURIComponent(loggedInDeviceId)}`);
        if (data.success && data.location) {
            await processLocationUpdate(data.location, loggedInDeviceId, true);
        }
    }

    // 2. Update all other devices in parallel
    const otherIds = allDeviceIds.filter(id => id !== loggedInDeviceId);
    if (otherIds.length > 0) {
        await Promise.all(otherIds.map(async (id) => {
            const data = await apiCall(`getLocation&device_id=${encodeURIComponent(id)}`);
            if (data.success && data.location) {
                await processLocationUpdate(data.location, id, false);
            }
        }));
    }
}


// Returns true if the string looks like raw zero coordinates (e.g. "0, 0", "0.000000, 0.000000")
function isRawZeroCoords(name) {
    if (!name || typeof name !== 'string') return false;
    return /^\s*0[\.0]*\s*,\s*0[\.0]*\s*$/.test(name.trim());
}

// Returns true if the string is a GPS-unavailable placeholder that should not be re-wrapped
function isNoGPSPlaceholder(name) {
    if (!name || typeof name !== 'string') return false;
    return /no gps/i.test(name) || /unknown location/i.test(name);
}

async function processLocationUpdate(location, overrideId, isSelectedDevice) {
    const { lat, lng, battery, timestamp, device_name, device_id, locationName: serverLocationName } = location;
    const id = overrideId || device_id || (isSelectedDevice ? loggedInDeviceId : null);

    if (!id) return;

    const displayName = device_name || 'Device';

    // Check if GPS coordinates are invalid (0 or very close to 0)
    const hasValidGPS = lat && lng && Math.abs(lat) > 0.01 && Math.abs(lng) > 0.01;

    // ALWAYS UPDATE CACHE FOR ALL DEVICES (not just selected ones)
    // This ensures data is available when switching devices
    if (hasValidGPS) {
        // Valid GPS - cache it
        const locationName = serverLocationName || `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
        deviceLocationCache[id] = {
            lat,
            lng,
            battery,
            timestamp,
            locationName: locationName,
            device_name: displayName
        };
    } else {
        // Invalid GPS - cache with last known coordinates if available
        // Try to get last known coords from existing cache
        const existingCache = deviceLocationCache[id];
        const lastKnownLat = existingCache?.lat;
        const lastKnownLng = existingCache?.lng;
        // For invalid GPS, use simple "No GPS Signal" in cache (not last known address)
        deviceLocationCache[id] = {
            lat: lastKnownLat,
            lng: lastKnownLng,
            battery,
            timestamp,
            locationName: "No GPS Signal",
            device_name: displayName
        };
    }

    // Handle invalid GPS case for selected device - show No GPS Signal immediately
    if (!hasValidGPS && isSelectedDevice) {
        // Keep last known coordinates but display No GPS Signal
        lastValidLocation.battery = battery;
        document.getElementById('locationName').textContent = "No GPS Signal";
        document.getElementById('batteryLevel').textContent = `${battery || 0}%`;
        // Update device status and timestamps
        updateDeviceStatus(timestamp);
        lastUpdateTime = new Date(timestamp).getTime();
        updateTimeSinceLastUpdate();
    }

    // Don't skip marker update - we want to keep showing the last known location
    // when GPS signal is lost. The marker should stay visible at its last valid position.

    // 1. Create or Update Marker
    // Check if we have valid coordinates to use for the marker
    // For non-selected devices, use the cache. For selected device, use lastValidLocation
    const cachedLat = deviceLocationCache[id]?.lat;
    const cachedLng = deviceLocationCache[id]?.lng;
    const fallbackLat = isSelectedDevice ? lastValidLocation.lat : cachedLat;
    const fallbackLng = isSelectedDevice ? lastValidLocation.lng : cachedLng;

    const markerLat = hasValidGPS ? lat : (fallbackLat || lat);
    const markerLng = hasValidGPS ? lng : (fallbackLng || lng);

    if (!markers[id]) {
        // Only create marker if we have valid coordinates
        if (markerLat && markerLng && Math.abs(markerLat) > 0.01 && Math.abs(markerLng) > 0.01) {
            markers[id] = L.marker([markerLat, markerLng], {
                icon: createCustomMarkerIcon(displayName)
            }).addTo(map);

            // Auto-focus on the selected device's marker when first placed
            if (isSelectedDevice) {
                map.panTo([markerLat, markerLng], { animate: true });
            }

            // Zoom logic: Only zooms when you CLICK the marker
            markers[id].on('click', () => {
                selectDevice(id);
                map.setView([markerLat, markerLng], 18);
            });
        }
    } else {
        // Marker already exists - update or recreate if needed
        if (markerLat && markerLng && Math.abs(markerLat) > 0.01 && Math.abs(markerLng) > 0.01) {
            // Valid coordinates - update existing marker
            markers[id].setLatLng([markerLat, markerLng]);
            markers[id].setIcon(createCustomMarkerIcon(displayName));

            // Auto-focus: pan map to follow the selected device on every GPS update
            if (isSelectedDevice && hasValidGPS) {
                map.panTo([markerLat, markerLng], { animate: true });
            }

            // Re-bind click listener in case it was lost or changed
            markers[id].off('click');
            markers[id].on('click', () => {
                selectDevice(id);
                map.setView([markerLat, markerLng], 18);
            });
        } else if (!markerLat || !markerLng || Math.abs(markerLat) <= 0.01 || Math.abs(markerLng) <= 0.01) {
            // Invalid coordinates - remove marker to prevent stale data
            if (markers[id]) {
                map.removeLayer(markers[id]);
                delete markers[id];
            }
        }
    }

    // 2. Update Sidebar UI (Only if this is the ACTIVE tab)
    if (isSelectedDevice) {
        // Check if we have valid GPS data (not 0,0)
        const hasValidGPS = lat && lng && Math.abs(lat) > 0.01 && Math.abs(lng) > 0.01;

        if (hasValidGPS) {
            // Valid GPS data - update everything normally
            lastValidLocation.lat = lat;
            lastValidLocation.lng = lng;
            lastValidLocation.battery = battery;

            // Use server-side geocoded address (provided via MQTT or API)
            let locationName = serverLocationName || deviceLocationCache[id]?.locationName || `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

            lastValidLocation.locationName = locationName;

            updateUI(lat, lng, locationName, battery, timestamp, device_name);
            checkGeofenceStatus(lat, lng, locationName);
        } else {
            // Invalid GPS (0,0) - show No GPS Signal immediately
            document.getElementById('locationName').textContent = "No GPS Signal";
            document.getElementById('batteryLevel').textContent = `${battery || 0}%`;
            // Update device status and timestamps
            updateDeviceStatus(timestamp);
            lastUpdateTime = new Date(timestamp).getTime();
            updateTimeSinceLastUpdate();
            // Preserve last known coordinates in lastValidLocation (do not overwrite with invalid ones)
        }
    }
}


// ===== UI status helpers =====
// Updates DOM elements with the latest device data
function updateUI(lat, lng, locationName, battery, timestamp, deviceName) {
    const elements = {
        locationName: locationName || `${lat.toFixed(6)}, ${lng.toFixed(6)}`,
        batteryLevel: `${battery || 0}%`,
        deviceName: deviceName,
    };

    for (const [id, value] of Object.entries(elements)) {
        const el = document.getElementById(id);
        if (el && value) el.textContent = value;
    }

    updateDeviceStatus(timestamp);

    lastUpdateTime = new Date(timestamp).getTime();
    updateTimeSinceLastUpdate();
}

// Visualizes whether the device is currently online based on timestamp
function updateDeviceStatus(timestamp) {
    const statusElement = document.getElementById('deviceStatus');
    if (!statusElement) return;

    const timeDiff = (Date.now() - new Date(timestamp).getTime()) / 1000 / 60;
    const isActive = timeDiff < DEVICE_TIMEOUT_MINUTES;

    statusElement.textContent = isActive ? 'Online' : 'Offline';
    statusElement.className = isActive ? 'status-active' : 'status-inactive';
}

// Refreshes the "last seen" timer text
function updateTimeSinceLastUpdate() {
    const element = document.getElementById('lastUpdate');
    if (!element) return;

    if (!lastUpdateTime) {
        element.textContent = "Never";
        return;
    }

    const elapsed = Date.now() - lastUpdateTime;

    // If older than 24 hours, show full date
    if (elapsed > 86400000) { // 24 * 60 * 60 * 1000
        const date = new Date(lastUpdateTime);
        element.textContent = date.toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
    } else {
        element.textContent = formatTimeElapsed(elapsed);
    }


}

// Helper to convert milliseconds into human readable time string
function formatTimeElapsed(milliseconds) {
    const totalSeconds = Math.floor(milliseconds / 1000);

    if (totalSeconds < 60) {
        return `${Math.max(0, totalSeconds)} seconds ago`;
    }

    const totalMinutes = Math.floor(totalSeconds / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (hours === 0) {
        const minStr = totalMinutes === 1 ? 'minute' : 'minutes';
        return `${totalMinutes} ${minStr} ago`;
    }

    const hourStr = hours === 1 ? 'hour' : 'hours';
    const minStr = minutes === 1 ? 'minute' : 'minutes';

    if (minutes === 0) {
        return `${hours} ${hourStr} ago`;
    }

    return `${hours} ${hourStr} and ${minutes} ${minStr} ago`;
}

// ===== Geofence management =====
// Loads geofence for a SPECIFIC device (or defaults to current if ID is missing)
async function loadGeofenceFromDatabase(targetDeviceId = null) {
    const deviceId = targetDeviceId || loggedInDeviceId;
    if (!deviceId) return;

    // Check cache first
    if (geofenceCache[deviceId] !== undefined) {
        const cached = geofenceCache[deviceId];
        if (cached) {
            applyGeofence(cached, deviceId);
        } else {
            clearGeofenceUI(deviceId);
        }
        return;
    }

    // Not cached - fetch from API
    const data = await apiCall(`getGeofence&deviceid=${encodeURIComponent(deviceId)}`);

    if (data.success && data.geofence) {
        geofenceCache[deviceId] = data.geofence;
        applyGeofence(data.geofence, deviceId);
    } else {
        geofenceCache[deviceId] = null;
        clearGeofenceUI(deviceId);
    }
}

// Helper: Apply geofence data to map/UI
function applyGeofence(geofence, deviceId) {
    if (deviceId === loggedInDeviceId) {
        geofenceCenterLat = geofence.lat;
        geofenceCenterLng = geofence.lng;
        geofenceEnabled = true;
        updateGeofenceButton(true);
    }
    const radius = geofence.radius || DEFAULT_GEOFENCE_RADIUS_METERS;
    createGeofenceCircle(geofence.lat, geofence.lng, radius, deviceId);
}

// Helper: Clear geofence UI for a device
function clearGeofenceUI(deviceId) {
    if (deviceId === loggedInDeviceId) {
        if (geofenceLayers[loggedInDeviceId]) {
            map.removeLayer(geofenceLayers[loggedInDeviceId]);
            delete geofenceLayers[loggedInDeviceId];
        }
        updateGeofenceButton(false);
        geofenceEnabled = false;
    }
}



async function saveGeofenceToDatabase() {
    if (!geofenceCircle || !loggedInDeviceId) return;

    const { lat, lng } = geofenceCircle.getLatLng();
    const radius = geofenceCircle.getRadius();

    // Update local cache immediately so it persists on device switch
    geofenceCache[loggedInDeviceId] = {
        lat: lat,
        lng: lng,
        radius: radius
    };

    await apiCall('saveGeofence', 'POST', {
        deviceid: loggedInDeviceId,
        lat: lat,
        lng: lng,
        radius: radius
    });
}

// Handles the logic for the geofence toggle button
function toggleGeofenceDrawing() {
    const btn = document.getElementById('toggleGeofence');
    if (!btn) return;

    // If a geofence drawing action is pending, ignore additional clicks on the button
    if (pendingMapClick) {
        // Do not cancel the drawing mode; simply return to allow map click to place the geofence
        return;
    }

    if (geofenceCircle) {
        removeGeofence();
        updateGeofenceButton(false);
        return;
    }

    enableGeofenceDrawingMode(btn);
}

function removeGeofence() {
    // 1. Remove the layer for the current device explicitly
    if (loggedInDeviceId && geofenceLayers[loggedInDeviceId]) {
        map.removeLayer(geofenceLayers[loggedInDeviceId]);
        delete geofenceLayers[loggedInDeviceId];
    }

    // 2. Clear global tracking variables
    geofenceCircle = null;
    geofenceCenterLat = null;
    geofenceCenterLng = null;

    geofenceEnabled = false;
    lastGeofenceStatus = false;

    // 3. Clear from local cache explicitly so it doesn't reappear
    if (loggedInDeviceId && geofenceCache[loggedInDeviceId]) {
        delete geofenceCache[loggedInDeviceId];
    }

    // 4. Update the server
    deleteGeofenceFromDatabase();
}

// Removes the geofence record from the database
async function deleteGeofenceFromDatabase() {
    if (!loggedInDeviceId) return;
    await apiCall(`deleteGeofence&deviceid=${encodeURIComponent(loggedInDeviceId)}`);
}


function createGeofenceCircle(lat, lng, radiusInMeters, deviceId) {
    const id = deviceId || loggedInDeviceId;
    if (!id) return;

    // Remove any existing circle for THIS specific device ID only
    if (geofenceLayers[id]) {
        map.removeLayer(geofenceLayers[id]);
        delete geofenceLayers[id];
    }

    // VISUALS: Active device = Orange/Yellow, Others = Blue
    const isCurrentDevice = (id === loggedInDeviceId);
    const color = isCurrentDevice ? 'orange' : '#3388ff';
    const fillColor = isCurrentDevice ? 'yellow' : '#3388ff';
    const fillOpacity = isCurrentDevice ? 0.3 : 0.1;

    const circle = L.circle([lat, lng], {
        color: color,
        fillColor: fillColor,
        fillOpacity: fillOpacity,
        radius: radiusInMeters,
        weight: 3
    }).addTo(map);

    // Store in our object
    geofenceLayers[id] = circle;

    // If this is the active device, keep the global reference for drawing/editing logic
    if (isCurrentDevice) {
        geofenceCircle = circle;
        geofenceCenterLat = lat;
        geofenceCenterLng = lng;
        geofenceEnabled = true;
    }
}

// Activates the interactive map mode for placing a geofence
function enableGeofenceDrawingMode(btn) {
    btn.style.background = '#ff9800';

    if (isMobileDevice()) {
        enableMobileGeofenceMode(btn);
    } else {
        enableDesktopGeofenceMode(btn);
    }
}

// Desktop: circle follows mouse, click to place
function enableDesktopGeofenceMode(btn) {
    const label = getGeofenceBtnLabel(btn);
    if (label) label.textContent = getTranslationText('map.clickToPlace', 'Click map to place geofence');

    createCursorCircle();
    map.getContainer().style.cursor = 'crosshair';

    pendingMapClick = function (e) {

        const centerPoint = map.latLngToLayerPoint(e.latlng);
        const edgePoint = L.point(centerPoint.x + 100, centerPoint.y);
        const edgeLatLng = map.layerPointToLatLng(edgePoint);
        const radiusInMeters = map.distance(e.latlng, edgeLatLng);

        // Pass the current loggedInDeviceId explicitly
        createGeofenceCircle(e.latlng.lat, e.latlng.lng, radiusInMeters, loggedInDeviceId);

        saveGeofenceToDatabase();

        updateGeofenceButton(true);
        removeCursorCircle();
        map.getContainer().style.cursor = '';
        pendingMapClick = null;
    };

    map.once('click', pendingMapClick);
}

// Mobile: fixed circle at screen center, move map to position, tap circle to place
function enableMobileGeofenceMode(btn) {
    const label = getGeofenceBtnLabel(btn);
    if (label) label.textContent = getTranslationText('map.tapToPlace', 'Tap circle to place');

    // Create HTML overlay circle fixed at center of map container
    const container = map.getContainer();
    mobileGeofenceOverlay = document.createElement('div');
    mobileGeofenceOverlay.className = 'mobile-geofence-crosshair';
    mobileGeofenceOverlay.innerHTML = `
        <div class="mobile-geofence-ring">
            <div class="mobile-geofence-center-dot"></div>
        </div>
        <div class="mobile-geofence-label">${getTranslationText('map.moveMapTapHere', 'Move map, then tap here')}</div>
    `;
    container.appendChild(mobileGeofenceOverlay);

    // NOTE: On mobile we keep only the fixed overlay; no Leaflet guide circle to avoid double visuals

    // Mark that we have a pending action so toggleGeofenceDrawing can cancel
    pendingMapClick = 'mobile';

    // When user taps the overlay circle, place the geofence at map center
    mobileGeofenceOverlay.addEventListener('click', function onTap(e) {
        e.stopPropagation();

        const c = map.getCenter();
        const cp = map.latLngToLayerPoint(c);
        const ep = L.point(cp.x + 100, cp.y);
        const el = map.layerPointToLatLng(ep);
        const r = map.distance(c, el);

        createGeofenceCircle(c.lat, c.lng, r, loggedInDeviceId);
        saveGeofenceToDatabase();

        updateGeofenceButton(true);
        removeMobileGeofenceOverlay();
        pendingMapClick = null;
    });
}

// Adds a visual guide following the cursor for placement
function createCursorCircle() {
    const center = map.getCenter();

    cursorCircle = L.circleMarker([center.lat, center.lng], {
        color: '#ff9800',
        fillColor: '#ffeb3b',
        fillOpacity: 0.2,
        radius: 100,
        weight: 2,
        dashArray: '5, 5'
    }).addTo(map);

    map.on('mousemove', updateCursorCirclePosition);
}

// Updates the position of the cursor guide circle
function updateCursorCirclePosition(e) {
    if (cursorCircle) {
        cursorCircle.setLatLng(e.latlng);
    }
}

// Cleans up the cursor guide circle
function removeCursorCircle() {
    if (cursorCircle) {
        map.off('mousemove', updateCursorCirclePosition);
        map.removeLayer(cursorCircle);
        cursorCircle = null;
    }
}

// Cleans up the mobile geofence center overlay and map listener
function removeMobileGeofenceOverlay() {
    if (mobileGeofenceOverlay) {
        mobileGeofenceOverlay.remove();
        mobileGeofenceOverlay = null;
    }
    if (mobileMapMoveHandler) {
        map.off('move', mobileMapMoveHandler);
        mobileMapMoveHandler = null;
    }
    if (cursorCircle) {
        map.removeLayer(cursorCircle);
        cursorCircle = null;
    }
}

function updateGeofenceButton(isActive) {
    const btn = document.getElementById('toggleGeofence');
    if (!btn) return;
    const label = getGeofenceBtnLabel(btn);

    if (isActive) {
        if (label) {
            label.setAttribute('data-i18n', 'map.clearGeofence');
            label.textContent = getTranslationText('map.clearGeofence', 'Clear Geofence');
        }
        btn.setAttribute('data-i18n-title', 'map.clearGeofence');
        btn.title = getTranslationText('map.clearGeofence', 'Clear Geofence');
        btn.style.background = '#d32f2f'; // Changed to Red for clear action
    } else {
        if (label) {
            label.setAttribute('data-i18n', 'map.drawGeofence');
            label.textContent = getTranslationText('map.drawGeofence', 'Draw Geofence');
        }
        btn.setAttribute('data-i18n-title', 'map.drawGeofence');
        btn.title = getTranslationText('map.drawGeofence', 'Draw Geofence');
        btn.style.background = '';
    }
}

// Compares device location against geofence and updates tracking state
// Actual notifications are handled server-side via push notifications in api.php
function checkGeofenceStatus(deviceLat, deviceLng, locationName) {
    if (!geofenceEnabled || !geofenceCircle) return;

    const center = geofenceCircle.getLatLng();
    const distance = map.distance([deviceLat, deviceLng], [center.lat, center.lng]);
    const radius = geofenceCircle.getRadius(); // This is in meters

    const isInside = distance <= radius;
    lastGeofenceStatus = isInside;
}