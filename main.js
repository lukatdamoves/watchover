// ========== DOM ELEMENTS ==========
const loginBtn = document.getElementById('loginBtn');
const guideBtn = document.getElementById('guideBtn');
const togglePassword = document.getElementById('togglePassword');
const passwordInput = document.getElementById('password');
const emailInput = document.getElementById('email');
const qrCode = document.querySelector('.qr-code');
const historyBtn = document.getElementById('historyBtn');
const homeBtn = document.getElementById('homeBtn');
const logoutBtn = document.getElementById('logoutBtn');


const loginPage = document.getElementById('login-page');
const mapPage = document.getElementById('map-page');


const guideModal = document.getElementById('guideModal');
const guideClose = document.getElementById('guideClose');
const guidePrev = document.getElementById('guidePrev');
const guideNext = document.getElementById('guideNext');
const guideFinish = document.getElementById('guideFinish');
const guideSlidesWrapper = document.getElementById('guideSlidesWrapper');
const guideDotsContainer = document.getElementById('guideDots');


const activityModal = document.getElementById('activityModal');
const activityClose = document.getElementById('activityClose');
const activityList = document.getElementById('activityList');


// ========== MAP VARIABLES ==========
let map;
let marker;
let circle;


// ========== API CONFIGURATION ==========
const CHANNEL_ID = '3110416';
const READ_API_KEY = 'LE3GZJADDVJVL49T';
const THINGSPEAK_URL = `https://api.thingspeak.com/channels/${CHANNEL_ID}/feeds/last.json?api_key=${READ_API_KEY}`;
const NOMINATIM_REVERSE_GEOCODE_URL = 'https://nominatim.openstreetmap.org/reverse';
const USER_AGENT = 'WatchOver/1.0';


// ========== CACHE CONFIGURATION ==========
const LOCATION_CACHE_KEY = 'watchover_current_location';
const ACTIVITY_HISTORY_CACHE_KEY = 'watchover_activity_history';
const GEOCODING_CACHE_KEY = 'watchover_geocoding_cache';
const CACHE_EXPIRY_TIME = 60 * 60 * 1000; // 1 hour
const GEOCODING_CACHE_EXPIRY = 7 * 24 * 60 * 60 * 1000; // 7 days


// ========== INTERVALS ==========
let updateInterval;
let timeUpdateInterval;
let activityHistoryUpdateInterval;
let lastUpdateTime = null;


// ========== STATE VARIABLES ==========
let lastValidLocation = {
    lat: null,
    lng: null,
    locationName: null,
    battery: null
};


let currentSlide = 0;
let activityHistory = [];
let geocodingInProgress = false;
let isLoggedIn = false;


// ========== GUIDE MODAL ==========
const slides = document.querySelectorAll('.guide-slide');


// ========== INITIALIZE ON DOM READY ==========
window.addEventListener('DOMContentLoaded', function() {
    isLoggedIn = localStorage.getItem('isLoggedIn') === 'true';
    if (isLoggedIn) {
        showPage(mapPage);
    }
    initializeGuideModal();
});


// ========== UTILITY FUNCTIONS ==========


function showPage(pageToShow) {
    document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
    pageToShow.classList.add('active');
    
    if (pageToShow === mapPage && !map) {
        initMap();
        startLocationUpdates();
    }
}


// ========== LOCAL STORAGE HELPERS ==========


function saveLocationToCache(lat, lng, locationName, battery) {
    try {
        const cacheData = {
            lat, lng, locationName, battery,
            timestamp: Date.now(),
            expiry: Date.now() + CACHE_EXPIRY_TIME
        };
        localStorage.setItem(LOCATION_CACHE_KEY, JSON.stringify(cacheData));
        console.log('Location cached:', locationName);
    } catch (error) {
        console.error('Error saving location to cache:', error);
    }
}


function getLocationFromCache() {
    try {
        const cached = localStorage.getItem(LOCATION_CACHE_KEY);
        if (!cached) return null;


        const cacheData = JSON.parse(cached);
        if (Date.now() > cacheData.expiry) {
            localStorage.removeItem(LOCATION_CACHE_KEY);
            return null;
        }
        return cacheData;
    } catch (error) {
        console.error('Error retrieving location from cache:', error);
        return null;
    }
}


function clearLocationCache() {
    try {
        localStorage.removeItem(LOCATION_CACHE_KEY);
        console.log('Location cache cleared');
    } catch (error) {
        console.error('Error clearing location cache:', error);
    }
}


function saveActivityHistoryToCache(history) {
    try {
        const cacheData = {
            history,
            timestamp: Date.now(),
            expiry: Date.now() + CACHE_EXPIRY_TIME
        };
        localStorage.setItem(ACTIVITY_HISTORY_CACHE_KEY, JSON.stringify(cacheData));
        console.log('Activity history cached:', history.length, 'items');
    } catch (error) {
        console.error('Error saving activity history to cache:', error);
    }
}


function getActivityHistoryFromCache() {
    try {
        const cached = localStorage.getItem(ACTIVITY_HISTORY_CACHE_KEY);
        if (!cached) return null;


        const cacheData = JSON.parse(cached);
        if (Date.now() > cacheData.expiry) {
            localStorage.removeItem(ACTIVITY_HISTORY_CACHE_KEY);
            return null;
        }
        return cacheData.history;
    } catch (error) {
        console.error('Error retrieving activity history from cache:', error);
        return null;
    }
}


function clearActivityHistoryCache() {
    try {
        localStorage.removeItem(ACTIVITY_HISTORY_CACHE_KEY);
        console.log('Activity history cache cleared');
    } catch (error) {
        console.error('Error clearing activity history cache:', error);
    }
}


// ========== GEOCODING CACHE HELPERS ==========


function saveGeocodingToCache(lat, lng, locationName) {
    try {
        const cacheKey = `${lat.toFixed(6)},${lng.toFixed(6)}`;
        let geocodingCache = {};
        
        const cached = localStorage.getItem(GEOCODING_CACHE_KEY);
        if (cached) {
            geocodingCache = JSON.parse(cached);
        }
        
        geocodingCache[cacheKey] = {
            locationName,
            timestamp: Date.now(),
            expiry: Date.now() + GEOCODING_CACHE_EXPIRY
        };
        
        localStorage.setItem(GEOCODING_CACHE_KEY, JSON.stringify(geocodingCache));
        console.log('Geocoding cached for:', cacheKey, '-', locationName);
    } catch (error) {
        console.error('Error saving geocoding cache:', error);
    }
}


function getGeocodingFromCache(lat, lng) {
    try {
        const cacheKey = `${lat.toFixed(6)},${lng.toFixed(6)}`;
        const cached = localStorage.getItem(GEOCODING_CACHE_KEY);
        
        if (!cached) return null;
        
        const geocodingCache = JSON.parse(cached);
        const cachedEntry = geocodingCache[cacheKey];
        
        if (!cachedEntry) return null;
        
        // Check if expired
        if (Date.now() > cachedEntry.expiry) {
            delete geocodingCache[cacheKey];
            localStorage.setItem(GEOCODING_CACHE_KEY, JSON.stringify(geocodingCache));
            return null;
        }
        
        return cachedEntry.locationName;
    } catch (error) {
        console.error('Error retrieving geocoding cache:', error);
        return null;
    }
}


function clearGeocodingCache() {
    try {
        localStorage.removeItem(GEOCODING_CACHE_KEY);
        console.log('Geocoding cache cleared');
    } catch (error) {
        console.error('Error clearing geocoding cache:', error);
    }
}


// ========== QR SCANNER SETUP ==========


const qrScannerModal = document.createElement('div');
qrScannerModal.id = 'qrScannerModal';
qrScannerModal.className = 'qr-scanner-modal';
qrScannerModal.innerHTML = `
    <div class="qr-scanner-content">
        <button class="qr-scanner-close" id="qrScannerClose">&times;</button>
        <h2>Scan QR Code</h2>
        <div id="qrScannerContainer">
            <video id="qrVideo" playsinline autoplay muted></video>
            <canvas id="qrCanvas" style="display:none;"></canvas>
        </div>
        <div class="qr-upload-section">
            <p>Or upload an image:</p>
            <input type="file" id="qrFileInput" accept="image/*" capture="environment" style="display:none;">
            <button class="qr-upload-btn" id="qrUploadBtn">Upload Image</button>
        </div>
        <div id="qrScannerStatus">Position the QR code within the frame</div>
    </div>
`;
document.body.appendChild(qrScannerModal);


const qrScannerClose = document.getElementById('qrScannerClose');
const qrVideo = document.getElementById('qrVideo');
const qrCanvas = document.getElementById('qrCanvas');
const qrFileInput = document.getElementById('qrFileInput');
const qrUploadBtn = document.getElementById('qrUploadBtn');
const qrScannerStatus = document.getElementById('qrScannerStatus');


let qrStream = null;
let qrScanning = false;


function loadJsQR() {
    return new Promise((resolve, reject) => {
        if (window.jsQR) {
            resolve();
            return;
        }
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
}


async function openQrScanner() {
    try {
        await loadJsQR();
        qrScannerModal.classList.add('active');


        if (!navigator.mediaDevices?.getUserMedia) {
            qrVideo.style.display = 'none';
            qrScannerStatus.textContent = 'Camera not supported. Please upload an image.';
            qrScannerStatus.style.color = '#ff6b6b';
            return;
        }


        try {
            qrScannerStatus.textContent = 'Requesting camera access...';
            qrScannerStatus.style.color = '#b0b0b0';
            qrVideo.style.display = 'block';


            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
            });


            qrVideo.srcObject = stream;
            qrStream = stream;


            qrVideo.onloadedmetadata = () => {
                qrVideo.play()
                    .then(() => {
                        qrScanning = true;
                        scanQrCode();
                        qrScannerStatus.textContent = 'Position the QR code within the frame';
                        qrScannerStatus.style.color = '#b0b0b0';
                    })
                    .catch(err => {
                        console.error('Video play error:', err);
                        qrScannerStatus.textContent = 'Error starting video. Please try again.';
                        qrScannerStatus.style.color = '#ff6b6b';
                    });
            };


            qrVideo.play().catch(() => console.log('Initial play deferred to metadata load'));
        } catch (err) {
            qrVideo.style.display = 'none';
            let errorMessage = 'Camera not available. ';
            
            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                errorMessage += 'Camera permission denied.';
            } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
                errorMessage += 'No camera found.';
            } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
                errorMessage += 'Camera is in use by another app.';
            } else {
                errorMessage += err.message || 'Unknown error.';
            }
            
            errorMessage += ' Please upload an image instead.';
            qrScannerStatus.textContent = errorMessage;
            qrScannerStatus.style.color = '#ff6b6b';
        }
    } catch (err) {
        console.error('Error loading QR scanner:', err);
        alert('Error loading QR scanner. Please try again.');
    }
}


function closeQrScanner() {
    qrScannerModal.classList.remove('active');
    qrScanning = false;


    if (qrStream) {
        qrStream.getTracks().forEach(track => track.stop());
        qrStream = null;
    }
    qrVideo.srcObject = null;
}


function scanQrCode() {
    if (!qrScanning || qrVideo.readyState !== qrVideo.HAVE_ENOUGH_DATA) {
        if (qrScanning) requestAnimationFrame(scanQrCode);
        return;
    }


    const ctx = qrCanvas.getContext('2d');
    qrCanvas.width = qrVideo.videoWidth;
    qrCanvas.height = qrVideo.videoHeight;


    ctx.drawImage(qrVideo, 0, 0, qrCanvas.width, qrCanvas.height);
    const imageData = ctx.getImageData(0, 0, qrCanvas.width, qrCanvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height);


    if (code) {
        processQrCode(code.data);
        return;
    }


    if (qrScanning) requestAnimationFrame(scanQrCode);
}


function processQrCode(data) {
    emailInput.value = data;
    passwordInput.value = '12345';
    qrScannerStatus.textContent = 'QR Code scanned successfully!';
    qrScannerStatus.style.color = '#00ff26';


    setTimeout(() => {
        closeQrScanner();
        qrScannerStatus.textContent = 'Position the QR code within the frame';
        qrScannerStatus.style.color = '#b0b0b0';
    }, 1000);
}


qrUploadBtn.addEventListener('click', () => qrFileInput.click());


qrFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;


    try {
        await loadJsQR();
        qrScannerStatus.textContent = 'Processing image...';


        const img = new Image();
        img.onload = function() {
            const ctx = qrCanvas.getContext('2d');
            qrCanvas.width = img.width;
            qrCanvas.height = img.height;
            ctx.drawImage(img, 0, 0);


            const imageData = ctx.getImageData(0, 0, qrCanvas.width, qrCanvas.height);
            const code = jsQR(imageData.data, imageData.width, imageData.height);


            if (code) {
                processQrCode(code.data);
            } else {
                qrScannerStatus.textContent = 'No QR code found in image. Please try again.';
                qrScannerStatus.style.color = '#ff6b6b';
                setTimeout(() => {
                    qrScannerStatus.textContent = 'Position the QR code within the frame';
                    qrScannerStatus.style.color = '#b0b0b0';
                }, 3000);
            }
        };
        img.src = URL.createObjectURL(file);
    } catch (err) {
        console.error('Error processing image:', err);
        qrScannerStatus.textContent = 'Error processing image. Please try again.';
        qrScannerStatus.style.color = '#ff6b6b';
    }


    qrFileInput.value = '';
});


qrScannerClose.addEventListener('click', closeQrScanner);
qrScannerModal.addEventListener('click', (e) => {
    if (e.target === qrScannerModal) closeQrScanner();
});


qrCode.addEventListener('click', openQrScanner);


// ========== PASSWORD TOGGLE ==========


togglePassword.addEventListener('click', function() {
    const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
    passwordInput.setAttribute('type', type);
    this.style.opacity = type === 'text' ? '0.5' : '1';
});


// ========== MAP FUNCTIONS ==========


function initMap() {
    const defaultLat = 14.6565;
    const defaultLng = 121.0315;


    map = L.map('map').setView([defaultLat, defaultLng], 18);


    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
    }).addTo(map);


    marker = L.marker([defaultLat, defaultLng]).addTo(map);
    marker.bindPopup('Device Location<br>Loading...').openPopup();


    circle = L.circle([defaultLat, defaultLng], {
        color: '#ff6b6b',
        fillColor: '#ff6b6b',
        fillOpacity: 0.2,
        radius: 25
    }).addTo(map);
}


function updateLocation(lat, lng, locationName, battery) {
    if (!map) return;


    marker.setLatLng([lat, lng]);
    marker.bindPopup(`Device Location<br>${locationName}`).openPopup();
    circle.setLatLng([lat, lng]);
    map.panTo([lat, lng]);


    document.getElementById('currentLocation').textContent = locationName;
    document.getElementById('batteryLevel').textContent = battery + '%';
}


// ========== GEOCODING FUNCTIONS (NOMINATIM) WITH CACHING ==========


// ========== GEOCODING FUNCTIONS (NOMINATIM) WITH CACHING ==========


async function getAddressFromCoordinates(lat, lng) {
    try {
        // Check persistent cache first
        const cachedAddress = getGeocodingFromCache(lat, lng);
        if (cachedAddress) {
            console.log('Using cached address for:', lat, lng);
            return cachedAddress;
        }

        const response = await fetch(
            `${NOMINATIM_REVERSE_GEOCODE_URL}?lat=${lat}&lon=${lng}&format=json&zoom=18&addressdetails=1`,
            {
                headers: {
                    'User-Agent': USER_AGENT
                }
            }
        );

        if (!response.ok) {
            console.error(`Geocoding API error: ${response.status}`);
            return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
        }

        const data = await response.json();

        if (data) {
            // Extract ONLY street name from address details
            const streetName = data.address?.road || 
                              data.address?.street ||
                              data.address?.residential ||
                              data.name ||
                              `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
            
            // Save to persistent cache
            saveGeocodingToCache(lat, lng, streetName);
            return streetName;
        }

        return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    } catch (error) {
        console.error('Geocoding error:', error);
        return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    }
}



async function batchGetAddressFromCoordinates(locations) {
    const results = new Array(locations.length);
    const locationCache = {};
    
    // Process in batches of 3 parallel requests
    const BATCH_SIZE = 3;
    const DELAY_BETWEEN_BATCHES = 1200; // 1.2 seconds between batches


    for (let i = 0; i < locations.length; i += BATCH_SIZE) {
        const batch = locations.slice(i, i + BATCH_SIZE);
        
        try {
            const promises = batch.map(async (location, batchIndex) => {
                const actualIndex = i + batchIndex;
                const cacheKey = `${location.lat.toFixed(6)},${location.lng.toFixed(6)}`;


                // Check in-memory cache first (within batch)
                if (locationCache[cacheKey]) {
                    results[actualIndex] = locationCache[cacheKey];
                    return;
                }

                // Check persistent cache second (7-day cache)
                const persistedLocation = getGeocodingFromCache(location.lat, location.lng);
                if (persistedLocation) {
                    console.log('Using persisted address for:', cacheKey);
                    locationCache[cacheKey] = persistedLocation;
                    results[actualIndex] = persistedLocation;
                    return;
                }


                try {
                    const response = await fetch(
                        `https://nominatim.openstreetmap.org/reverse?lat=${location.lat}&lon=${location.lng}&format=json&zoom=18&addressdetails=1`,
                        {
                            headers: {
                                'User-Agent': 'WatchOver/1.0'
                            }
                        }
                    );


                    if (!response.ok) {
                        results[actualIndex] = `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}`;
                        return;
                    }


                    const data = await response.json();
                    let locationName = `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}`;


                    if (data) {
                        locationName = data.display_name?.split(',').slice(0, 2).join(',').trim() || 
                                      data.name || 
                                      data.address?.road || 
                                      data.address?.neighbourhood ||
                                      data.address?.city || 
                                      data.address?.state || 
                                      locationName;
                    }


                    locationCache[cacheKey] = locationName;
                    
                    // Save to persistent cache
                    saveGeocodingToCache(location.lat, location.lng, locationName);
                    
                    results[actualIndex] = locationName;
                } catch (error) {
                    console.error(`Error geocoding ${cacheKey}:`, error);
                    results[actualIndex] = `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}`;
                }
            });


            await Promise.all(promises);


            // Delay between batches only if there are more batches
            if (i + BATCH_SIZE < locations.length) {
                await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
            }
        } catch (error) {
            console.error('Batch processing error:', error);
        }
    }


    return results;
}


// ========== TIME DISPLAY ==========


function updateTimeAgo() {
    if (!lastUpdateTime) return;


    const now = new Date();
    const past = new Date(lastUpdateTime);
    const diffMs = now - past;
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);


    let timeAgoText;
    if (diffSecs < 60) {
        timeAgoText = `${diffSecs} second${diffSecs !== 1 ? 's' : ''} ago`;
    } else if (diffMins < 60) {
        timeAgoText = `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
    } else if (diffHours < 24) {
        timeAgoText = `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    } else {
        timeAgoText = `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
    }


    document.getElementById('lastUpdate').textContent = timeAgoText;
}


// ========== THINGSPEAK FETCHING ==========


async function fetchThingSpeakData() {
    try {
        const response = await fetch(THINGSPEAK_URL);
        const data = await response.json();


        if (data?.field3 && data?.field4) {
            let latitude = parseFloat(data.field3);
            let longitude = parseFloat(data.field4);
            const battery = data.field5 || '--';
            lastUpdateTime = data.created_at;


            if (latitude === 0.0 && longitude === 0.0) {
                if (lastValidLocation.lat !== null && lastValidLocation.lng !== null) {
                    updateLocation(lastValidLocation.lat, lastValidLocation.lng, 
                                 lastValidLocation.locationName + ' (Last Known)', battery);
                    updateTimeAgo();
                }
                return data;
            }


            let locationName = '';
            const cachedLocation = getLocationFromCache();
            const currentLatRounded = parseFloat(latitude.toFixed(6));
            const currentLngRounded = parseFloat(longitude.toFixed(6));


            if (cachedLocation) {
                const cachedLatRounded = parseFloat(cachedLocation.lat.toFixed(6));
                const cachedLngRounded = parseFloat(cachedLocation.lng.toFixed(6));


                if (cachedLatRounded === currentLatRounded && cachedLngRounded === currentLngRounded) {
                    locationName = cachedLocation.locationName;
                }
            }


            if (!locationName) {
                locationName = await getAddressFromCoordinates(latitude, longitude);
                saveLocationToCache(latitude, longitude, locationName, battery);
            }


            lastValidLocation = { lat: latitude, lng: longitude, locationName, battery };
            updateLocation(latitude, longitude, locationName, battery);
            updateTimeAgo();
            return data;
        } else {
            document.getElementById('currentLocation').textContent = 'No data';
            document.getElementById('lastUpdate').textContent = 'Waiting for data...';
        }
    } catch (error) {
        console.error('Error fetching ThingSpeak data:', error);
        document.getElementById('currentLocation').textContent = 'Error loading';
        document.getElementById('lastUpdate').textContent = 'Connection error';
    }
}


// ========== LOGIN/LOGOUT ==========


async function verifyLogin(inputDeviceId, inputPassword) {
    try {
        const response = await fetch(THINGSPEAK_URL);
        const data = await response.json();
        return data.field1 === inputDeviceId && data.field2 === inputPassword;
    } catch (error) {
        console.error('Error verifying login:', error);
        return false;
    }
}


loginBtn.addEventListener('click', async function() {
    const deviceId = emailInput.value;
    const password = passwordInput.value;


    if (!deviceId || !password) {
        alert('Please enter device ID and password');
        return;
    }


    loginBtn.textContent = 'Logging in...';
    loginBtn.disabled = true;


    const isValid = await verifyLogin(deviceId, password);


    if (isValid) {
        isLoggedIn = true;
        localStorage.setItem('isLoggedIn', 'true');
        showPage(mapPage);
        await fetchThingSpeakData();
    } else {
        alert('Invalid device ID or password');
    }


    loginBtn.textContent = 'Login';
    loginBtn.disabled = false;
});


logoutBtn.addEventListener('click', function() {
    isLoggedIn = false;
    localStorage.removeItem('isLoggedIn');
    clearLocationCache();
    clearActivityHistoryCache();
    clearGeocodingCache();
    stopLocationUpdates();
    geocodingInProgress = false;


    emailInput.value = '';
    passwordInput.value = '';
    showPage(loginPage);
});


// ========== LOCATION UPDATES ==========


function startLocationUpdates() {
    fetchThingSpeakData();


    updateInterval = setInterval(() => {
        fetchThingSpeakData();
    }, 15000);


    timeUpdateInterval = setInterval(() => {
        updateTimeAgo();
    }, 1000);


    startActivityHistoryUpdates();
}


function stopLocationUpdates() {
    if (updateInterval) clearInterval(updateInterval);
    if (timeUpdateInterval) clearInterval(timeUpdateInterval);
    stopActivityHistoryUpdates();
}


// ========== ACTIVITY HISTORY BACKGROUND UPDATE ==========


function startActivityHistoryUpdates() {
    console.log('Starting background activity history updates');
    activityHistoryUpdateInterval = setInterval(() => {
        if (!geocodingInProgress) {
            console.log('Background: Updating activity history...');
            updateActivityHistoryInBackground();
        }
    }, 60000); // 1 minute
}


function stopActivityHistoryUpdates() {
    if (activityHistoryUpdateInterval) {
        clearInterval(activityHistoryUpdateInterval);
        activityHistoryUpdateInterval = null;
    }
}


async function updateActivityHistoryInBackground() {
    try {
        geocodingInProgress = true;
        console.log('Fetching activity history...');
        
        const url = `https://api.thingspeak.com/channels/${CHANNEL_ID}/feeds.json?api_key=${READ_API_KEY}&results=10`;
        const response = await fetch(url);
        const data = await response.json();


        if (data?.feeds?.length > 0) {
            activityHistory = data.feeds
                .reverse()
                .map(feed => ({
                    entryId: feed.entry_id,
                    timestamp: feed.created_at,
                    battery: feed.field5 || '--',
                    lat: parseFloat(feed.field3),
                    lng: parseFloat(feed.field4)
                }))
                .filter(item => !isNaN(item.lat) && !isNaN(item.lng) && (item.lat !== 0 || item.lng !== 0));


            console.log('Fetched', activityHistory.length, 'entries');


            if (activityHistory.length > 0) {
                console.log('Starting geocoding for', activityHistory.length, 'entries');
                
                const locationsForGeocoding = activityHistory.map(activity => ({
                    lat: activity.lat,
                    lng: activity.lng
                }));


                const addressList = await batchGetAddressFromCoordinates(locationsForGeocoding);


                const geocodedHistory = activityHistory.map((activity, index) => {
                    const date = new Date(activity.timestamp);
                    const time = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
                    const dateStr = date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });


                    return {
                        locationName: addressList[index],
                        time,
                        date: dateStr,
                        battery: activity.battery,
                        lat: activity.lat,
                        lng: activity.lng,
                        timestamp: activity.timestamp
                    };
                });


                saveActivityHistoryToCache(geocodedHistory);
                console.log('Activity history saved to cache:', geocodedHistory.length, 'items');
            }
        } else {
            console.log('No feeds available from ThingSpeak');
        }
    } catch (error) {
        console.error('Error updating activity history in background:', error);
    } finally {
        geocodingInProgress = false;
        console.log('Activity history update complete');
    }
}


// ========== ACTIVITY HISTORY MODAL ==========


async function fetchActivityHistory(forceRefresh = false) {
    try {
        const cachedHistory = getActivityHistoryFromCache();

        // ALWAYS show cache immediately if it exists
        if (cachedHistory?.length > 0) {
            console.log('Displaying cached activity history');
            displayActivityHistoryFromCache(cachedHistory);
            
            // If not forcing refresh AND cache exists, we're done
            if (!forceRefresh) {
                return;
            }
        } else {
            // No cache - show loading
            activityList.innerHTML = '<div class="activity-loading"><div class="activity-spinner"></div><div class="activity-loading-text">Loading activity...</div></div>';
        }

        // Now fetch fresh data in background (user sees cached data while this runs)
        console.log('Fetching fresh activity history...');
        await updateActivityHistoryInBackground();
        
        // Update display with fresh data
        const freshCache = getActivityHistoryFromCache();
        if (freshCache?.length > 0) {
            console.log('Displaying freshly loaded activity history');
            displayActivityHistoryFromCache(freshCache);
        }
    } catch (error) {
        console.error('Error fetching activity history:', error);
        if (!getActivityHistoryFromCache()) {
            activityList.innerHTML = '<div class="activity-empty">Error loading activity history</div>';
        }
    }
}


function displayActivityHistoryFromCache(cachedData) {
    if (!cachedData || cachedData.length === 0) {
        activityList.innerHTML = '<div class="activity-empty">No activity history available</div>';
        return;
    }


    activityList.innerHTML = '';


    cachedData.forEach(activity => {
        const activityItem = document.createElement('div');
        activityItem.className = 'activity-item';
        activityItem.innerHTML = `
            <div class="activity-location">${activity.locationName}</div>
            <div class="activity-meta">
                <span class="activity-time">${activity.time}</span>
                <span class="activity-date">${activity.date}</span>
                <span class="activity-battery">${activity.battery}%</span>
            </div>
        `;
        activityList.appendChild(activityItem);
    });


    console.log('Activity history displayed:', cachedData.length, 'items');
}


function openActivityHistory() {
    activityModal.classList.add('active');
    // Always force refresh when clicking the button to get immediate fresh data
    fetchActivityHistory(true);
}


function closeActivityHistory() {
    activityModal.classList.remove('active');
}


historyBtn.addEventListener('click', openActivityHistory);
activityClose.addEventListener('click', closeActivityHistory);
activityModal.addEventListener('click', (e) => {
    if (e.target === activityModal) closeActivityHistory();
});



// ========== GUIDE MODAL ==========


function initializeGuideModal() {
    slides.forEach((_, index) => {
        const dot = document.createElement('div');
        dot.classList.add('guide-dot');
        if (index === 0) dot.classList.add('active');
        guideDotsContainer.appendChild(dot);
    });
    updateGuideSlide();
}


function updateGuideSlide() {
    guideSlidesWrapper.style.transform = `translateX(-${currentSlide * 100}%)`;


    const dots = document.querySelectorAll('.guide-dot');
    dots.forEach((dot, index) => {
        dot.classList.toggle('active', index === currentSlide);
    });


    guidePrev.disabled = currentSlide === 0;


    if (currentSlide === slides.length - 1) {
        guideNext.style.display = 'none';
        guideFinish.style.display = 'block';
    } else {
        guideNext.style.display = 'block';
        guideFinish.style.display = 'none';
    }
}


function openGuide() {
    guideModal.classList.add('active');
    currentSlide = 0;
    updateGuideSlide();
}


function closeGuide() {
    guideModal.classList.remove('active');
}


guideBtn.addEventListener('click', openGuide);
guideClose.addEventListener('click', closeGuide);
guideFinish.addEventListener('click', closeGuide);


guidePrev.addEventListener('click', () => {
    if (currentSlide > 0) {
        currentSlide--;
        updateGuideSlide();
    }
});


guideNext.addEventListener('click', () => {
    if (currentSlide < slides.length - 1) {
        currentSlide++;
        updateGuideSlide();
    }
});


guideModal.addEventListener('click', (e) => {
    if (e.target === guideModal) closeGuide();
});


// ========== HOME BUTTON ==========


homeBtn.addEventListener('click', function() {
    console.log('Home clicked');
});
