# WatchOver System Overview
## Complete Technical Documentation for Team Members

---

## What is WatchOver?

WatchOver is a GPS tracking smartwatch system designed for personal safety monitoring. It has two main components:

- **WatchOver Device**: Hardware that collects GPS location and battery data, then transmits it to the server
- **WatchOver Website**: Cloud dashboard that manages accounts, devices, real-time map tracking, location history, push notifications, geofencing, and remote device control

---

## 1. WatchOver Device (Hardware Component)

### Hardware Components

| Component | Purpose |
|-----------|---------|
| A9G Module | Main processor, GPS receiver, and cellular modem |
| 1000 mAh Lithium Ion Battery | Power source for the device |
| Micro USB Charging Module | Charging port for the battery |
| Vibration Module | Tactile alert feedback for remote notifications |
| On/Off Switch | Device power control |

### Programming and Flashing Equipment

- **USB to Serial Adapter**: Connects device to computer for firmware upload
- **CoolWatcher Software**: Application used to flash the modified A9G SDK firmware
- **SIM Card**: Smart or TNT network provider

---

## 2. Device Firmware Logic (How the Device Works)

### Phase 1: First Time Setup and Device Identity

When powered on for the first time:

1. Device reads the A9G module's IMEI (International Mobile Equipment Identity)
2. Creates a unique device ID in format: `WatchOver_XXXXXX` (last 6 digits of IMEI)
3. Sends registration request to server (`registerDevice` API) with:
   - Device ID
   - Default password: `12345` (hardcoded)

**Important Limitation**: The hardcoded default password is only used during initial setup. If a user changes the password on the website, the A9G device does not automatically sync with the updated password. This is a known limitation in the current design.

### Phase 2: Initialization and GPS Acquisition

After setup:

1. Initialize all A9G modules (cellular, GPS, storage)
2. Acquire GPS location using combined approach:
   - A-GPS (Assisted GPS) for faster initial lock
   - Standard GPS for continuous tracking
3. Collect data packet containing:
   - WatchOver Device ID
   - Latitude
   - Longitude
   - Battery Level (percentage)

### Phase 3: Continuous Data Transmission (Main Loop)

- Device transmits GPS data every **1 minute** via HTTP POST to the `save_gps` API endpoint
- Server performs **server-side reverse geocoding** (LocationIQ) on each GPS update to convert coordinates to a street address
- Server stores data in both `gps_data` (history) and `device_status` (current state) tables
- Server publishes the location update to **MQTT** for real-time dashboard updates
- Server sends **Web Push notifications** to all subscribed users of the device
- This loop continues indefinitely while powered on

---

## 3. Device Communication Protocols

The WatchOver device uses two different communication methods:

| Protocol | Direction | Purpose |
|----------|-----------|---------|
| HTTP POST | Device → Server | Send GPS location, battery level via `save_gps` API |
| MQTT | Server → Device | Send remote commands (vibration trigger) |
| MQTT (WebSocket) | Server → Dashboard | Real-time location updates to browser |
| Web Push | Server → Browser | Background/closed-browser notifications |

### Vibration Feature (Remote Alert System)

How remote vibration works:

1. User clicks "Vibrate Device" button on the dashboard
2. A **30-second cooldown timer** starts (prevents spam)
3. Server publishes MQTT message to topic `watchover/{device_id}/command` with payload `vibrate`
4. A9G module receives the MQTT command
5. Vibration module activates for exactly **5 seconds**
6. User receives tactile feedback on their wrist

---

## 4. WatchOver Website and Dashboard

### Hosting and Domain

- **Server**: AWS (self-hosted)
- **Web Server**: Apache (XAMPP)
- **Database**: MySQL
- **Domain**: `watchover.jumpingcrab.com`
- **Subdomain Type**: Free subdomain (JumpingCrab)
- **SSL**: HTTPS enabled

### User Account System

**Registration**
- Email and password required (minimum 6 characters)
- Automatic email verification via Brevo SMTP
- Verification token valid for **24 hours**
- User must verify email before first login
- Expired unverified accounts are **automatically deleted** to free up the email for re-registration

**Login Features**
- Standard email/password authentication with session management
- Session ID regenerated on login (prevents session fixation)
- "Forgot Password" feature with reset token (valid for **1 hour**, cooldown of 30 minutes between requests)
- Expired reset tokens are automatically cleared from the database
- Help/Guide button at bottom of login page

**Language Support**
- English
- Tagalog (Filipino)
- Language switcher overlay on the map

**Account Management (Dashboard)**
- Change account password
- Logout button (CSRF-protected)

---

## 5. Device Management on Dashboard

### Adding Devices to Your Account

**Device Discovery**
1. Each WatchOver device comes with a printed sticker on the back containing:
   - Device ID
   - Default password (12345)
2. User enters these details on the "Add Device" modal to link the device

**Mandatory Security Step**
- Immediately after adding a device, the website forces the user to change the default password
- This ensures the hardcoded password is overridden

**Device Limits**
- Maximum **3 WatchOver devices** per user account
- Can add, remove, and rename devices
- Device tabs displayed horizontally at the top of the info panel

### Map Display and Location Tracking

**Multi-Device Map View**
- All linked devices are shown as **custom labeled markers** on the map simultaneously
- Each marker displays the device name
- The info panel on the right shows detailed information for the **currently selected device** only
- Click a device tab to switch the selected device and center the map on it

**Map Features**
- Powered by **Leaflet.js** with OpenStreetMap tiles
- Custom marker icons with device name labels
- "Home" button to re-center map on the selected device
- Geofence circles drawn on the map when active

**No GPS Signal Handling**
- When a device sends `0,0` coordinates (no GPS lock), the map keeps showing the **last known valid location**
- The address displays with a "(No GPS Signal)" suffix
- Last known address is preserved in the database (`last_known_address` column)

---

## 6. Dashboard Information Panel

For the selected device, the dashboard displays:

| Information | Details |
|-------------|---------|
| Wearer Name | Editable text field (click to rename) |
| Current Location | Server-geocoded street address or coordinates |
| Time of Last Update | Relative time (e.g., "2 minutes ago") with live countdown |
| Battery Level | Current battery percentage with icon |
| Device Status | Online (updated within 5 min) or Offline (no update for 5+ min) |

### Available Actions

| Action | Function |
|--------|----------|
| Vibrate Device | Send remote vibration via MQTT (30-second cooldown between presses) |
| Change Device Password | Update the device's linking password |
| View Activity History | Scrollable modal with paginated location, time, and battery logs |
| Toggle Notifications | Green bell = subscribed, dark bell with slash = unsubscribed |
| Toggle Geofence | Draw/remove a circular safe zone on the map |

---

## 7. Activity History

**What It Shows**
- Historical GPS locations (every 1 minute interval)
- Server-geocoded address for each entry
- Timestamp for each location entry
- Battery level at each timestamp
- "No GPS Signal" entries when device had no lock

**Pagination**
- Fetches up to 100 entries at a time
- Infinite scroll loads more entries as user scrolls down
- Results cached per device to avoid redundant API calls

**Use Case**
- Track where the wearer has been
- Verify device operation over time
- Detect patterns and frequently visited locations

---

## 8. Notifications System (Web Push)

### How It Works

1. **Service Worker** (`sw.js`) is registered on the browser when the dashboard loads
2. User clicks the **notification toggle button** (bell icon) to subscribe or unsubscribe
3. Browser generates a **PushSubscription** using the server's VAPID public key
4. Subscription (endpoint, p256dh key, auth key) is saved to the `push_subscriptions` database table
5. Every time a device sends GPS data, the server sends a push notification to all subscribers

### Technology Stack

| Component | Role |
|-----------|------|
| Web Push API | Browser-native push notification mechanism |
| VAPID Keys | Server authentication (public + private key pair in `push-config.php`) |
| Service Worker (`sw.js`) | Receives push events in the background, shows notifications |
| Minishlink/WebPush (PHP) | Server-side library to send push payloads via Composer |

### Notification Toggle Button

- **Green bell icon** = Subscribed (push notifications active)
- **Dark bell with red slash** = Unsubscribed (notifications off)
- Toggle is **debounced** — button is disabled during the subscribe/unsubscribe API call to prevent double-clicks
- Subscription state is checked on page load from the browser's PushManager

### Notification Content

- Device name (e.g., "🟢 Mom's Watch")
- Current street address (or "No GPS Signal" with last known address)
- Battery level percentage
- Current time
- Geofence alert prefix ("!!!OUT OF SAFE ZONE!!!") when applicable

### Notification Click Behavior

- Clicking a notification focuses the existing dashboard tab or opens a new one
- Expired/invalid subscriptions are automatically cleaned up from the database

---

## 9. Real-Time Updates (MQTT)

### Dashboard ↔ Server Real-Time Channel

In addition to MQTT for device commands, the dashboard uses **MQTT over WebSocket** for live location updates:

| Detail | Value |
|--------|-------|
| Broker URL | `wss://watchover.jumpingcrab.com:9001` |
| Client Library | `mqtt.js` (browser) |
| Topic Pattern | `watchover/device/{device_id}/location` |

### How It Works

1. Dashboard connects to the MQTT broker over WebSocket on page load
2. Subscribes to topics for all linked devices
3. When the server receives a GPS update from a device, it publishes to MQTT with:
   - `device_id`, `device_name`, `lat`, `lng`, `battery`, `timestamp`, `locationName`
4. Dashboard receives the message and **instantly updates** the map marker, info panel, and caches
5. No polling needed — updates arrive in real time

### Reconnection

- Auto-reconnects every 5 seconds if connection drops
- Listens for browser `online` event (e.g., WiFi → mobile data switch) and forces immediate reconnect

---

## 10. Geofencing (Safe Zone Feature)

### What is a Geofence?

A virtual circular boundary around a specific location. WatchOver uses geofencing to monitor if the wearer stays within a safe zone.

**Geofence Settings**
- 1 geofence per device
- Default radius: **100 meters**
- Defined by:
  - Center latitude and longitude (set by clicking on the map)
  - Radius (in meters, adjustable)

### Geofence Drawing Mode

1. User clicks the "Geofence" toggle button on the dashboard
2. Map enters drawing mode — cursor changes to crosshair
3. A preview circle follows the cursor showing the radius
4. User clicks on the map to set the geofence center
5. Geofence is saved to the database and displayed as a circle on the map

### Geofence Behavior

**When Device is Inside Geofence**
- Normal operation
- Standard notifications only

**When Device Goes Outside Geofence**
- Push notification prefixed with: **"!!!OUT OF SAFE ZONE!!!"**
- Geofence check uses the **Haversine formula** to calculate distance from center (server-side in `sendPushNotifications()`)

**Geofence Management**
- Can delete a geofence by toggling the geofence button when one is already active
- Geofence data is cached per device on the dashboard to avoid redundant API calls

**Use Cases**
- School pickup zones
- Home boundaries
- Work locations
- Hospital zones

---

## 11. Security Features

### CSRF Protection

All state-changing API actions require a **CSRF token** sent via the `X-CSRF-Token` header:

| Action | CSRF Required |
|--------|--------------|
| register | Yes |
| authenticate | Yes |
| logout | Yes |
| linkDevice | Yes |
| updateDeviceName | Yes |
| updatePassword | Yes |
| updateDevicePassword | Yes |
| saveGeofence | Yes |
| deleteGeofence | Yes |
| forgotPassword | Yes |
| savePushSubscription | Yes |
| deletePushSubscription | Yes |

CSRF token is generated per session using `bin2hex(random_bytes(32))` and validated with `hash_equals()`.

### Session Security

- `cookie_httponly`: Enabled (prevents JavaScript access to session cookie)
- `cookie_samesite`: Lax
- `use_strict_mode`: Enabled (rejects uninitialized session IDs)
- `gc_maxlifetime`: 3600 seconds (1 hour)
- Session ID is regenerated on successful login

### Authentication

- User passwords are hashed with `password_hash()` (bcrypt) and verified with `password_verify()`
- All authenticated endpoints check `isAuthenticated()` before proceeding
- Device ownership is verified before vibrate and remove operations

### Token Expiry and Cleanup

- **Verification tokens** expire after 24 hours; expired unverified users are automatically deleted from the database (frees email for re-registration)
- **Reset tokens** expire after 1 hour; expired tokens are automatically nullified
- Cleanup runs automatically during `registerUser()`, `verifyEmail()`, and `resetPassword()` calls

---

## 12. Technology Stack

### Backend and Server

| Component | Technology |
|-----------|------------|
| Cloud Server | AWS (Amazon Web Services) |
| Web Server | Apache (XAMPP) |
| Database | MySQL (utf8mb4, timezone +08:00 Asia/Manila) |
| Backend Language | PHP |
| Package Manager | Composer |
| MQTT Broker | Mosquitto |
| Push Notifications | Minishlink/WebPush (PHP library) |
| Email | PHPMailer via Brevo SMTP |

### Frontend

| Component | Technology |
|-----------|------------|
| Markup | HTML5 |
| Styling | CSS3 (custom, no framework) |
| Interactivity | Vanilla JavaScript |
| Map Library | Leaflet.js 1.9.4 |
| Real-time Client | mqtt.js (WebSocket) |
| Push Notifications | Web Push API + Service Worker |
| IDE | Visual Studio Code (Windsurf) |

### External Services and APIs

| Service | Purpose |
|---------|---------|
| OpenStreetMap | Map tile layer (free) |
| LocationIQ | Reverse geocoding — coordinates to street address |
| Brevo SMTP | Transactional email delivery (verification, password reset) |
| Mosquitto | MQTT broker for device commands and real-time updates |

### Composer Dependencies

| Package | Purpose |
|---------|---------|
| `minishlink/web-push` | Send Web Push notifications with VAPID authentication |
| `phpmailer/phpmailer` | Send HTML emails via SMTP |

---

## 13. Database Structure

### Table: `users`
Stores user account information.

| Column | Type | Purpose |
|--------|------|---------|
| user_id | INT (PK, AUTO_INCREMENT) | Unique identifier |
| email | VARCHAR (UNIQUE) | Login email |
| password | VARCHAR | Bcrypt-hashed password |
| is_verified | BOOLEAN | Email verification status (0 = unverified) |
| verification_token | VARCHAR | Token for email verification (cleared on verify) |
| token_expires | DATETIME | Verification token expiry (24 hours) |
| created_at | DATETIME | Account creation timestamp |
| reset_token | VARCHAR | Password reset token (cleared on reset) |
| reset_token_expires | DATETIME | Reset token expiry (1 hour) |

### Table: `devices`
Stores device configuration and metadata.

| Column | Type | Purpose |
|--------|------|---------|
| device_id | VARCHAR (PK) | Unique device ID (WatchOver_XXXXXX) |
| device_password | VARCHAR | Current device security password (plaintext) |
| device_name | VARCHAR | User-friendly device name |

### Table: `user_devices`
Maps users to their devices (many-to-many ownership relationship).

| Column | Type | Purpose |
|--------|------|---------|
| id | INT (PK, AUTO_INCREMENT) | Unique identifier |
| user_id | INT (FK) | Reference to users table |
| device_id | VARCHAR (FK) | Reference to devices table |

### Table: `device_status`
Stores the latest status of each device (current/real-time data, upserted on each GPS update).

| Column | Type | Purpose |
|--------|------|---------|
| device_id | VARCHAR (PK) | Which device |
| current_latitude | DECIMAL | Latest GPS latitude |
| current_longitude | DECIMAL | Latest GPS longitude |
| battery_level | INT | Current battery percentage |
| timestamp | DATETIME | When this status was recorded |
| location_address | VARCHAR | Server-geocoded address for current coordinates |
| last_known_address | VARCHAR | Last valid address (preserved when GPS is lost) |

### Table: `gps_data`
Stores complete historical GPS logs (1 entry per minute).

| Column | Type | Purpose |
|--------|------|---------|
| id | INT (PK, AUTO_INCREMENT) | Unique log entry ID |
| device_id | VARCHAR (FK) | Which device recorded this |
| latitude | DECIMAL | GPS latitude coordinate |
| longitude | DECIMAL | GPS longitude coordinate |
| timestamp | DATETIME | When location was captured |
| battery_level | INT | Battery level at this timestamp |
| location_address | VARCHAR | Geocoded address at this timestamp |
| last_known_address | VARCHAR | Last valid address at this timestamp |

### Table: `geofences`
Stores geofence definitions per device.

| Column | Type | Purpose |
|--------|------|---------|
| geofence_id | INT (PK, AUTO_INCREMENT) | Unique identifier |
| user_id | INT (FK) | Which user owns this geofence |
| device_id | VARCHAR (FK) | Which device uses this geofence |
| center_latitude | DECIMAL | Geofence center latitude |
| center_longitude | DECIMAL | Geofence center longitude |
| radius | INT | Geofence radius in meters |

### Table: `push_subscriptions`
Stores Web Push notification subscriptions per user.

| Column | Type | Purpose |
|--------|------|---------|
| id | INT (PK, AUTO_INCREMENT) | Unique identifier |
| user_id | INT (FK) | Which user owns this subscription |
| endpoint | VARCHAR (UNIQUE) | Browser push endpoint URL |
| p256dh | VARCHAR | Client public key for encryption |
| auth | VARCHAR | Client auth secret for encryption |

---

## 14. API Endpoints Reference

All endpoints are accessed via `api.php?action={action}`.

### Public (No Authentication)

| Action | Method | Purpose |
|--------|--------|---------|
| `getCSRFToken` | GET | Get a CSRF token for the session |
| `register` | POST | Register a new user account |
| `verify` | GET | Verify email using token |
| `authenticate` | POST | Login with email/password |
| `registerDevice` | POST | Register a new hardware device |
| `save_gps` | POST | Receive GPS data from hardware device |
| `resetPassword` | POST | Reset password using token |

### Authenticated (Requires Login)

| Action | Method | CSRF | Purpose |
|--------|--------|------|---------|
| `logout` | POST | Yes | End user session |
| `checkSession` | GET | No | Check if user is logged in |
| `getUserDevices` | GET | No | Get all linked devices |
| `linkDevice` | POST | Yes | Link a device to user account |
| `removeDevice` | GET | No | Unlink a device from account |
| `getLocation` | GET | No | Get latest device location |
| `getHistory` | GET | No | Get activity history for a device |
| `updateDeviceName` | POST | Yes | Rename a device |
| `updatePassword` | POST | Yes | Change account password |
| `updateDevicePassword` | POST | Yes | Change device password |
| `vibrateDevice` | GET | No | Send vibrate command via MQTT |
| `reverseGeocode` | GET | No | Convert coordinates to address |
| `saveGeofence` | POST | Yes | Create or update geofence |
| `getGeofence` | GET | No | Get geofence for a device |
| `deleteGeofence` | GET | Yes | Remove geofence for a device |
| `forgotPassword` | POST | Yes | Send password reset email |
| `getVapidPublicKey` | GET | No | Get VAPID public key for push |
| `savePushSubscription` | POST | Yes | Save push notification subscription |
| `deletePushSubscription` | POST | Yes | Remove push notification subscription |

---

## 15. System Data Flow Summary

```
[WatchOver Device]
       |
       | Every 1 minute (HTTP POST)
       | GPS coords + Battery level
       v
[API: save_gps] ──> [Server-side Geocoding via LocationIQ]
       |
       |──> [MySQL: gps_data] (historical log)
       |──> [MySQL: device_status] (current state, upsert)
       |──> [MQTT Publish] ──> topic: watchover/device/{id}/location
       |                              |
       |                              v
       |                    [Dashboard Browser]
       |                    Real-time map + panel update
       |
       |──> [Web Push Notifications]
                   |
                   |──> [Geofence Check (Haversine)]
                   |──> [Push to all subscribed browsers]
                   |──> [Service Worker shows notification]

[Dashboard Browser]
       |
       | User clicks "Vibrate Device"
       v
[API: vibrateDevice] ──> [MQTT Publish] ──> topic: watchover/{id}/command
                                                     |
                                                     v
                                           [WatchOver Device Vibrates 5s]
```

---

## 16. Performance Optimizations

### Client-Side Caching (dashboard.js)

| Cache | Purpose | TTL |
|-------|---------|-----|
| `geocodeCache` | Avoids repeated reverse geocoding API calls | 1 hour |
| `deviceLocationCache` | Stores last known location per device | Until next update |
| `geofenceCache` | Stores geofence data per device | Until modified |
| `activityHistoryCache` | Stores history per device | Invalidated on new MQTT data |

### Parallel Fetching

- When updating locations for multiple devices, the selected device is fetched first (priority), then all other devices are fetched **in parallel** using `Promise.all`

### MQTT Real-Time

- Eliminates the need for periodic polling — location updates arrive instantly via WebSocket
- Reduces API load and provides a better user experience

---

## 17. Key Limitations and Known Issues

1. **Password Sync**: Device hardcoded password does not update when website password changes
2. **One Geofence Per Device**: Limited to one safe zone per device
3. **Notifications Online Only**: Push alerts only send when device is actively transmitting data
4. **Device Passwords Stored in Plaintext**: Device passwords in the `devices` table are not hashed
5. **No Rate Limiting on GPS**: A rogue device could flood the database with rapid `save_gps` calls

---

## 18. File Structure

```
watchover/
├── api.php                    # Backend API (all endpoints)
├── push-config.php            # VAPID keys for Web Push
├── verify.php                 # Email verification + password reset page
├── sw.js                      # Service Worker for push notifications
├── composer.json              # PHP dependencies
├── site.webmanifest           # PWA manifest
├── .htaccess                  # Apache rewrite rules
├── WatchOver_System_Guide.md  # This document
├── dashboard/
│   ├── dashboard.html         # Main dashboard page
│   ├── dashboard.js           # Dashboard logic (~2000 lines)
│   └── dashboard.css          # Dashboard styles
├── login/
│   ├── login.html             # Login/register page
│   ├── login.js               # Login logic
│   ├── login.css              # Login styles
│   └── guide.html             # Help/guide page
├── translations/              # Language files (EN, PH)
├── images/                    # Static images
├── favicon_icons/             # Favicon and app icons
└── vendor/                    # Composer dependencies
```

---

## 19. What to Share with Team Members

Print or share this document with your group. Key points they should understand:

- **Device Role**: Collects GPS every minute and sends to server via HTTP
- **Website Role**: Displays real-time location on map, manages devices, sends remote commands
- **Real-Time Updates**: MQTT over WebSocket delivers instant location updates to the dashboard
- **Communication**: HTTP for GPS data upload, MQTT for device commands and live updates, Web Push for background notifications
- **Security**: CSRF protection on all state-changing endpoints, session security, email verification with auto-cleanup, bcrypt password hashing
- **Tracking Features**: Real-time map with multi-device markers, activity history, geofencing with safe zone alerts, push notifications
- **Limitations**: One geofence per device, device password sync issue, no GPS rate limiting

---

**Document Version**: 2.0  
**Last Updated**: February 2026  
**System**: WatchOver GPS Tracking Smartwatch  
**Team**: Capstone/Thesis Project Group
