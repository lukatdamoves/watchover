// Common utilities shared between login and main pages

// Translation system
let currentLanguage = localStorage.getItem('preferredLanguage') || 'en';
let translations = {};

// Load translations from JSON files, with localStorage caching.
// Only refetches when the file's Last-Modified header changes.
async function loadTranslations(lang) {
    const url = `../translations/${lang}.json`;
    const cacheKey = `i18n_${lang}`;
    const versionKey = `i18n_${lang}_ver`;

    try {
        // Check server version via a lightweight HEAD request
        const head = await fetch(url, { method: 'HEAD' });
        const serverVersion = head.headers.get('Last-Modified') || head.headers.get('ETag') || '';

        const cachedVersion = localStorage.getItem(versionKey);
        const cachedData = localStorage.getItem(cacheKey);

        if (serverVersion && cachedVersion === serverVersion && cachedData) {
            // Cache hit — parse and use stored JSON
            translations[lang] = JSON.parse(cachedData);
            return translations[lang];
        }

        // Cache miss or stale — fetch fresh copy
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to load ${lang}.json`);
        const data = await response.json();
        translations[lang] = data;

        // Persist to localStorage
        try {
            localStorage.setItem(cacheKey, JSON.stringify(data));
            localStorage.setItem(versionKey, serverVersion);
        } catch (e) { /* localStorage full — ignore, still works in-memory */ }

        return data;
    } catch (error) {
        console.error(`Error loading translations for ${lang}:`, error);
        // Fallback: try to use any stale cached copy
        const cachedData = localStorage.getItem(cacheKey);
        if (cachedData) {
            try {
                translations[lang] = JSON.parse(cachedData);
                return translations[lang];
            } catch (e) { /* corrupt cache */ }
        }
        return null;
    }
}

// Initialize translations on page load
async function initializeTranslations() {
    // Load both languages at once
    await Promise.all([
        loadTranslations('en'),
        loadTranslations('tl')
    ]);

    // Apply current language
    applyTranslations();
}

// Make sure this runs on page load
window.addEventListener('DOMContentLoaded', initializeTranslations);


// Switch language
function switchLanguage(lang) {
    currentLanguage = lang;
    localStorage.setItem('preferredLanguage', lang);
    applyTranslations();
}

// Apply translations to page elements
function applyTranslations() {
    if (!translations[currentLanguage]) {
        console.warn(`Translations not loaded for ${currentLanguage}`);
        return;
    }

    document.querySelectorAll('[data-i18n]').forEach(element => {
        const key = element.getAttribute('data-i18n');
        const translation = getNestedTranslation(key);

        if (translation) {
            if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
                element.placeholder = translation;
            } else {
                element.textContent = translation;
            }
        }
    });

    document.querySelectorAll('[data-i18n-title]').forEach(element => {
        const key = element.getAttribute('data-i18n-title');
        const translation = getNestedTranslation(key);

        if (translation) {
            element.title = translation;
        }
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
        const key = element.getAttribute('data-i18n-placeholder');
        const translation = getNestedTranslation(key);

        if (translation) {
            element.placeholder = translation;
        }
    });

    // After translations applied, refresh geofence button text based on current active state
    if (typeof updateGeofenceButton === 'function') {
        const isActive = !!window.geofenceCircle;
        updateGeofenceButton(isActive);
    }
}

// Get nested translation value using dot notation (e.g., "login.title")
function getNestedTranslation(key) {
    const keys = key.split('.');
    let value = translations[currentLanguage];

    for (const k of keys) {
        if (value && typeof value === 'object' && k in value) {
            value = value[k];
        } else {
            return null;
        }
    }

    return value;
}

// Custom alert function with types: 'error', 'success', 'warning'
function showAlert(message, type = 'error', persistent = false) {
    let alertOverlay = document.getElementById('customAlertOverlay');

    if (!alertOverlay) {
        alertOverlay = document.createElement('div');
        alertOverlay.id = 'customAlertOverlay';
        alertOverlay.className = 'custom-alert-overlay';
        document.body.appendChild(alertOverlay);
    }

    // Icon SVGs based on type
    const icons = {
        error: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ff4444" stroke-width="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>`,
        success: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#00ff26" stroke-width="2">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                    <polyline points="22 4 12 14.01 9 11.01"></polyline>
                  </svg>`,
        warning: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffa500" stroke-width="2">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                    <line x1="12" y1="9" x2="12" y2="13"></line>
                    <line x1="12" y1="17" x2="12.01" y2="17"></line>
                  </svg>`
    };

    const alertBox = document.createElement('div');
    alertBox.className = `custom-alert-box ${type}`;

    const iconDiv = document.createElement('div');
    iconDiv.className = 'custom-alert-icon';
    iconDiv.innerHTML = icons[type] || icons.error; // Safe, these are static SVGs

    const msgDiv = document.createElement('div');
    msgDiv.className = 'custom-alert-message';
    msgDiv.textContent = message; // FIX: Prevents XSS

    alertBox.appendChild(iconDiv);
    alertBox.appendChild(msgDiv);

    if (persistent) {
        alertBox.classList.add('persistent');
        alertBox.style.cursor = 'pointer';
        alertBox.addEventListener('click', () => {
            alertBox.remove();
            if (alertOverlay && alertOverlay.children.length === 0) {
                alertOverlay.remove();
            }
        });
    }

    // Clear previous alerts and add new one
    alertOverlay.innerHTML = '';
    alertOverlay.appendChild(alertBox);

    if (!persistent) {
        // Auto remove after 3 seconds - only remove the alert box, not the overlay
        setTimeout(() => {
            if (alertBox && alertBox.parentNode) {
                alertBox.remove();
            }
            // Remove overlay only if it's empty
            if (alertOverlay && alertOverlay.children.length === 0) {
                alertOverlay.remove();
            }
        }, 3000);
    }
}

// Custom confirm dialog with callback
function showConfirm(message, onConfirm) {
    let overlay = document.getElementById('customConfirmOverlay');
    if (overlay) overlay.remove();

    overlay = document.createElement('div');
    overlay.id = 'customConfirmOverlay';
    overlay.className = 'custom-confirm-overlay';

    overlay.innerHTML = `
        <div class="custom-confirm-box">
            <div class="confirm-content">
                <div class="confirm-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                        <line x1="12" y1="9" x2="12" y2="13"></line>
                        <line x1="12" y1="17" x2="12.01" y2="17"></line>
                    </svg>
                </div>
                <div class="confirm-message"></div>
            </div>
            <div class="confirm-actions">
                <button class="confirm-btn cancel">${typeof getTranslationText === 'function' ? getTranslationText('alerts.cancel', 'Cancel') : 'Cancel'}</button>
                <button class="confirm-btn danger">${typeof getTranslationText === 'function' ? getTranslationText('alerts.remove', 'Remove') : 'Remove'}</button>
            </div>
        </div>
    `;

    // FIX: Set text content securely, preserving newlines
    const msgEl = overlay.querySelector('.confirm-message');
    msgEl.textContent = message;
    msgEl.innerHTML = msgEl.innerHTML.replace(/\\n/g, '<br>');

    document.body.appendChild(overlay);

    const cancelBtn = overlay.querySelector('.cancel');
    const dangerBtn = overlay.querySelector('.danger');

    const close = () => overlay.remove();

    cancelBtn.onclick = close;
    overlay.onclick = (e) => { if (e.target === overlay) close(); };

    dangerBtn.onclick = () => {
        close();
        if (onConfirm) onConfirm();
    };
}

// Make functions globally available
window.switchLanguage = switchLanguage;
window.showAlert = showAlert;
window.showConfirm = showConfirm;