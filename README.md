# WatchOver 🛰️

**A GPS-tracking smartwatch system for personal safety monitoring.**

WatchOver pairs a custom-built A9G GPS smartwatch with a cloud dashboard so a
wearer's location, battery status, and safe-zone breaches can be monitored in
real time from any browser. Built as a capstone project for the degree of
Bachelor of Science in Information Technology.

<p align="center">
  <img src="images/logo.png" alt="WatchOver" width="220">
</p>

---

## ✨ Features

| Area | What it does |
|---|---|
| 📍 Real-time tracking | Live map (Leaflet + OpenStreetMap) with custom labeled markers for every linked device, updated over MQTT WebSocket with automatic HTTP-polling fallback |
| 🕘 Activity history | Full location log (one entry per minute) with reverse-geocoded addresses, battery level, pagination, and search |
| 🛡️ Geofencing | Draw a circular safe zone per device; server-side Haversine check flags breaches with an **"OUT OF SAFE ZONE"** alert |
| 🔔 Push notifications | Web Push (VAPID) delivers every location update to subscribed browsers — even when the dashboard is closed |
| 📳 Remote vibration | Trigger the watch's vibration motor from the dashboard via MQTT (30-second anti-spam cooldown) |
| 👤 Account system | Email verification, bcrypt passwords, password reset, CSRF-protected API, session hardening |
| 🌐 Bilingual UI | Full English / Tagalog interface with offline translation caching |
| 📱 Multi-device | Up to 3 watches per account, rename/remove devices, per-device passwords |

### Graceful "No GPS Signal" handling

When the watch loses its GPS fix it reports `0,0`. The system then keeps
showing the **last known valid location** on the map, preserves the last known
address in the database, and labels the status *(No GPS Signal)* instead of
dropping the pin in the ocean.

---

## 🏗️ Architecture

```
 ┌────────────────────┐        HTTP POST (every 1 min)        ┌──────────────────────────────┐
 │  WatchOver Device  │ ────────────────────────────────────▶ │         api.php (PHP)        │
 │  A9G + GPS + SIM   │ ◀──────── MQTT: vibrate command ────  │                              │
 └────────────────────┘         watchover/{id}/command         │  ├─ reverse geocode (LocationIQ)
                                                               │  ├─ MySQL: gps_data (history)
 ┌────────────────────┐        MQTT over WebSocket             │  │        + device_status (live)
 │  Dashboard Browser │ ────────────────────────────────────▶ │  ├─ MQTT publish → dashboard
 │  Leaflet + mqtt.js │ ◀──────── live location topic ───────  │  └─ Web Push → subscribers
 └────────────────────┘         watchover/device/{id}/location  └──────────────────────────────┘
        │                                │
        │ Service Worker (sw.js)         │
        ▼                                ▼
   Push notifications            Mosquitto MQTT broker
```

**Data flow per GPS update:** device POSTs `save_gps` → server reverse-geocodes
the coordinates → writes history + upserts live status → publishes to MQTT →
pushes to all subscribed browsers (with geofence evaluation).

---

## 🧰 Tech Stack

| Layer | Technology |
|---|---|
| Device firmware | A9G module (GPRS + GPS), C SDK, MQTT + HTTP |
| Backend | PHP 8.2, MySQL 8 (mysqli, prepared statements) |
| Frontend | Vanilla JavaScript, Leaflet 1.9.4, mqtt.js, Service Worker |
| Real-time | Mosquitto MQTT (WebSocket for browser, TCP for device & PHP publisher) |
| Notifications | Web Push API + VAPID (`minishlink/web-push`) |
| Email | PHPMailer via Brevo SMTP |
| Maps & geocoding | OpenStreetMap tiles, LocationIQ reverse geocoding |
| Server | Apache (XAMPP-style stack), Let's Encrypt TLS |

---

## 🚀 Getting Started

### Prerequisites

- PHP 8.2+ with `curl`, `mbstring`, `openssl` (XAMPP works out of the box)
- MySQL 8
- [Composer](https://getcomposer.org/)
- Mosquitto MQTT broker with WebSocket support (port 9001) — optional for a UI-only tour

### Setup

```bash
# 1. Clone and install PHP dependencies
git clone https://github.com/lukatdamoves/watchover.git
cd watchover
composer install

# 2. Configure environment (never commit the real .env)
cp .env.example .env
#    then edit .env: database credentials, LocationIQ key, SMTP, VAPID keys

# 3. Create the database and import schema + demo data
mysql -u root -e "CREATE DATABASE watchover CHARACTER SET utf8mb4;"
mysql -u root watchover < watchover_database.sql

# 4. Serve it (example with PHP's built-in server)
php -S localhost:8000
#    then open http://localhost:8000/login/login.html
```

For the full Apache virtual-host + Mosquitto + TLS production setup, see
[`docs/deployment-guide.md`](docs/deployment-guide.md).

### Demo account

The database dump ships with synthetic demo data:

| Account | Credentials |
|---|---|
| Dashboard login | `demo@example.com` / `watchover-demo` |
| Demo device password | `12345` (the factory default the app forces users to change) |

> The demo data is fake — GPS points, addresses, and the user row are
> placeholders. Generate your own VAPID keys with
> `npx web-push generate-vapid-keys` and put them in `.env`.

---

## 📁 Repository Structure

```
watchover/
├── api.php                  # Single-file JSON API router (all endpoints)
├── verify.php               # Email verification + password-reset pages
├── push-config.php          # VAPID configuration (reads .env)
├── proxy_agps.php           # A-GPS ephemeris caching proxy for the device
├── sw.js                    # Service worker (Web Push)
├── watchover_database.sql   # Schema + synthetic demo data
├── login/                   # Login / register / forgot-password + user guide
├── dashboard/               # Map dashboard (HTML/CSS/JS)
├── guide/                   # In-app user guide assets
├── translations/            # en.json + tl.json (English / Tagalog)
├── images/, favicon_icons/, watchover_icons/
├── deploy/apache/           # Apache vhost examples (80 + 443)
└── docs/
    ├── system-guide.md      # Complete technical documentation
    └── deployment-guide.md  # Production deployment runbook
```

---

## 📖 Documentation

- **[System Guide](docs/system-guide.md)** — full technical documentation: device
  firmware logic, communication protocols, API reference, database schema,
  security design
- **[Deployment Guide](docs/deployment-guide.md)** — provisioning the Azure VM,
  Apache, Mosquitto, TLS, and go-live checklist

---

## ⚠️ Known Limitations

The following limitations are known:

- **Device password sync** — if the device password is changed on the website,
  the A9G firmware must be re-flashed with the new value (no OTA sync).
- **Plaintext device passwords** — `devices.device_password` is stored as-is;
  the schema reserves `varchar(255)` for a future hashing migration.
- **MQTT is unauthenticated** in the reference deployment — fine for a demo
  network, but should get per-device credentials + ACLs in production.
- Geofence radius is set from a fixed screen offset rather than a numeric input.

---

## 👥 Team

Capstone project — BSIT 3A, Information and Communications Technology Program,
Gardner College Diliman.

- **Ignacio, James Matthew M.**
- **Cervantes, Christine Sharmae E.**
- **Limjoco, Mico Wesley J.**
- **Hambangan, Roland S.**
- **Nodalo, Kenneth Louis C.**

---

## 📄 License

Developed for academic purposes as a capstone requirement. All rights reserved
by the project team.
