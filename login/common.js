let currentLanguage = localStorage.getItem('preferredLanguage') || 'en';
let translations = {};

async function loadTranslations(lang) {
    const url = `../translations/${lang}.json`;
    const cacheKey = `i18n_${lang}`;
    const versionKey = `i18n_${lang}_ver`;

    try {
        const head = await fetch(url, { method: 'HEAD' });
        const serverVersion = head.headers.get('Last-Modified') || head.headers.get('ETag') || '';

        const cachedVersion = localStorage.getItem(versionKey);
        const cachedData = localStorage.getItem(cacheKey);

        if (serverVersion && cachedVersion === serverVersion && cachedData) {
            translations[lang] = JSON.parse(cachedData);
            return translations[lang];
        }

        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to load ${lang}.json`);
        const data = await response.json();
        translations[lang] = data;

        try {
            localStorage.setItem(cacheKey, JSON.stringify(data));
            localStorage.setItem(versionKey, serverVersion);
        } catch (e) { /* localStorage full */ }

        return data;
    } catch (error) {
        const cachedData = localStorage.getItem(cacheKey);
        if (cachedData) {
            try {
                translations[lang] = JSON.parse(cachedData);
                return translations[lang];
            } catch (e) { /* corrupt */ }
        }
        return null;
    }
}

async function initializeTranslations() {
    await Promise.all([
        loadTranslations('en'),
        loadTranslations('tl')
    ]);
    applyTranslations();
}

window.addEventListener('DOMContentLoaded', initializeTranslations);

function switchLanguage(lang) {
    currentLanguage = lang;
    localStorage.setItem('preferredLanguage', lang);
    applyTranslations();
}

function applyTranslations() {
    if (!translations[currentLanguage]) return;

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
}

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

function showAlert(message, type = 'error') {
    let alertOverlay = document.getElementById('customAlertOverlay');

    if (!alertOverlay) {
        alertOverlay = document.createElement('div');
        alertOverlay.id = 'customAlertOverlay';
        alertOverlay.className = 'custom-alert-overlay';
        document.body.appendChild(alertOverlay);
    }

    const icons = {
        error: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ff4444" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`,
        success: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#00ff26" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`,
        warning: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffa500" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`
    };

    const alertBox = document.createElement('div');
    alertBox.className = `custom-alert-box ${type}`;
    alertBox.innerHTML = `
        <div class="custom-alert-icon">${icons[type] || icons.error}</div>
        <div class="custom-alert-message">${message}</div>
    `;

    alertOverlay.innerHTML = '';
    alertOverlay.appendChild(alertBox);

    setTimeout(() => {
        if (alertBox && alertBox.parentNode) alertBox.remove();
        if (alertOverlay && alertOverlay.children.length === 0) alertOverlay.remove();
    }, 3000);
}

window.switchLanguage = switchLanguage;
window.showAlert = showAlert;