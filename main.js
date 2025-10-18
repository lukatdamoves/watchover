// Get elements
const loginBtn = document.getElementById('loginBtn');
const guideBtn = document.getElementById('guideBtn');
const togglePassword = document.getElementById('togglePassword');
const passwordInput = document.getElementById('password');
const emailInput = document.getElementById('email');
const qrCode = document.querySelector('.qr-code');
const historyBtn = document.getElementById('historyBtn');
const homeBtn = document.getElementById('homeBtn');
const logoutBtn = document.getElementById('logoutBtn');

// Pages
const loginPage = document.getElementById('login-page');
const mapPage = document.getElementById('map-page');

// Map variables
let map;
let marker;
let circle;

// ThingSpeak configuration
const CHANNEL_ID = '3110416';
const READ_API_KEY = 'LE3GZJADDVJVL49T';
const THINGSPEAK_URL = `https://api.thingspeak.com/channels/${CHANNEL_ID}/feeds/last.json?api_key=${READ_API_KEY}`;

// Auto-update interval
let updateInterval;

// Check if user is already logged in on page load
window.addEventListener('DOMContentLoaded', function() {
    const isLoggedIn = localStorage.getItem('isLoggedIn');
    if (isLoggedIn === 'true') {
        showPage(mapPage);
    }
});

// Toggle password visibility
togglePassword.addEventListener('click', function() {
    const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
    passwordInput.setAttribute('type', type);
    this.style.opacity = type === 'text' ? '0.5' : '1';
});

// Function to switch pages
function showPage(pageToShow) {
    document.querySelectorAll('.page').forEach(page => {
        page.classList.remove('active');
    });
    
    pageToShow.classList.add('active');
    
    // Initialize map when map page is shown
    if (pageToShow === mapPage && !map) {
        initMap();
        startLocationUpdates();
    }
}

// Initialize Leaflet map
function initMap() {
    const defaultLat = 14.6565;
    const defaultLng = 121.0315;
    
    map = L.map('map').setView([defaultLat, defaultLng], 15);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
    }).addTo(map);
    
    marker = L.marker([defaultLat, defaultLng]).addTo(map);
    marker.bindPopup('<b>Device Location</b><br>Loading...').openPopup();
    
    circle = L.circle([defaultLat, defaultLng], {
        color: '#ff6b6b',
        fillColor: '#ff6b6b',
        fillOpacity: 0.2,
        radius: 50
    }).addTo(map);
    
    console.log('Map initialized');
}

// Reverse Geocoding - Convert coordinates to address
async function getAddressFromCoordinates(lat, lng) {
    try {
        // Using Nominatim reverse geocoding (free, no API key needed)
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`);
        const data = await response.json();
        
        if (data && data.address) {
            // Try to get the most relevant location name
            const address = data.address;
            let locationName = '';
            
            // Priority order: specific to general
            if (address.road) {
                locationName = address.road;
            } else if (address.suburb || address.neighbourhood) {
                locationName = address.suburb || address.neighbourhood;
            } else if (address.village || address.town || address.city) {
                locationName = address.village || address.town || address.city;
            } else if (data.display_name) {
                // Fallback to display name (shortened)
                locationName = data.display_name.split(',').slice(0, 2).join(', ');
            } else {
                locationName = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
            }
            
            return locationName;
        } else {
            return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
        }
    } catch (error) {
        console.error('Geocoding error:', error);
        return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    }
}

// Fetch data from ThingSpeak
async function fetchThingSpeakData() {
    try {
        const response = await fetch(THINGSPEAK_URL);
        const data = await response.json();
        
        console.log('ThingSpeak data:', data);
        
        if (data && data.field3 && data.field4) {
            const deviceId = data.field1;
            const latitude = parseFloat(data.field3);
            const longitude = parseFloat(data.field4);
            const battery = data.field5 || '--';
            const timestamp = data.created_at;
            
            const timeAgo = calculateTimeAgo(timestamp);
            
            // Get address from coordinates
            const locationName = await getAddressFromCoordinates(latitude, longitude);
            
            updateLocation(latitude, longitude, locationName, battery, timeAgo);
            
            return data;
        } else {
            console.error('No GPS data available yet');
            document.getElementById('currentLocation').textContent = 'No data';
            document.getElementById('lastUpdate').textContent = 'Waiting for data...';
        }
    } catch (error) {
        console.error('Error fetching ThingSpeak data:', error);
        document.getElementById('currentLocation').textContent = 'Error loading';
        document.getElementById('lastUpdate').textContent = 'Connection error';
    }
}

// Calculate time ago from timestamp
function calculateTimeAgo(timestamp) {
    const now = new Date();
    const past = new Date(timestamp);
    const diffMs = now - past;
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffSecs < 60) {
        return `${diffSecs} seconds ago`;
    } else if (diffMins < 60) {
        return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    } else if (diffHours < 24) {
        return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    } else {
        return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    }
}

// Update device location on map
function updateLocation(lat, lng, locationName, battery, timestamp) {
    if (!map) {
        console.error('Map not initialized');
        return;
    }
    
    marker.setLatLng([lat, lng]);
    marker.bindPopup(`<b>Device Location</b><br>${locationName}`).openPopup();
    
    circle.setLatLng([lat, lng]);
    
    map.setView([lat, lng], 15);
    
    document.getElementById('currentLocation').textContent = locationName;
    document.getElementById('batteryLevel').textContent = battery + '%';
    document.getElementById('lastUpdate').textContent = timestamp;
    
    console.log('Location updated:', lat, lng);
}

// Verify login with ThingSpeak data
async function verifyLogin(inputDeviceId, inputPassword) {
    try {
        const response = await fetch(THINGSPEAK_URL);
        const data = await response.json();
        
        const deviceId = data.field1;
        const password = data.field2;
        
        console.log('Checking login...');
        console.log('Input Device ID:', inputDeviceId);
        console.log('ThingSpeak Device ID:', deviceId);
        
        if (deviceId === inputDeviceId && password === inputPassword) {
            return true;
        } else {
            return false;
        }
    } catch (error) {
        console.error('Error verifying login:', error);
        return false;
    }
}

// Login button click handler
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
        console.log('Login successful!');
        localStorage.setItem('isLoggedIn', 'true');
        showPage(mapPage);
        await fetchThingSpeakData();
    } else {
        alert('Invalid device ID or password');
        console.log('Login failed');
    }
    
    loginBtn.textContent = 'Login';
    loginBtn.disabled = false;
});

// Logout button click handler
logoutBtn.addEventListener('click', function() {
    console.log('Logging out...');
    localStorage.removeItem('isLoggedIn');
    stopLocationUpdates();
    
    // Reset input fields
    emailInput.value = '';
    passwordInput.value = '';
    
    // Go back to login page
    showPage(loginPage);
});

// Start auto-updating location data
function startLocationUpdates() {
    fetchThingSpeakData();
    
    updateInterval = setInterval(() => {
        console.log('Auto-updating location...');
        fetchThingSpeakData();
    }, 30000);
}

// Stop updates
function stopLocationUpdates() {
    if (updateInterval) {
        clearInterval(updateInterval);
        updateInterval = null;
    }
}

// Guide button click handler
guideBtn.addEventListener('click', function() {
    console.log('Guide clicked');
    alert('Guide page coming soon!');
});

// QR code click handler
qrCode.addEventListener('click', function() {
    console.log('QR code clicked');
    alert('QR Scanner coming soon!');
});

// History button click handler
historyBtn.addEventListener('click', function() {
    console.log('Activity History clicked');
    alert('Activity History coming soon!');
});

// Home button click handler
homeBtn.addEventListener('click', function() {
    console.log('Home clicked');
});
