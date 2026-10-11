<?php
require_once __DIR__ . '/vendor/autoload.php';

// Load .env variables securely
$dotenv = Dotenv\Dotenv::createImmutable(__DIR__);
$dotenv->safeLoad(); // Parses .env if it exists, won't crash if omitted in production

require_once __DIR__ . '/push-config.php';
use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception;
use Minishlink\WebPush\WebPush;
use Minishlink\WebPush\Subscription;

ini_set('session.cookie_httponly', 1);
ini_set('session.cookie_secure', 0); // Should be 1 in production if using HTTPS
ini_set('session.cookie_samesite', 'Lax');
ini_set('session.use_strict_mode', 1);
ini_set('session.cookie_lifetime', 0); // 0 = until browser is closed. For a "remember me" feature, you would set this to a longer duration.
ini_set('session.gc_maxlifetime', 86400); // 24 hours.

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

if (empty($_SESSION['csrf_token'])) {
    $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
}


date_default_timezone_set('Asia/Manila');

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE');
header('Access-Control-Allow-Headers: Content-Type, X-CSRF-Token');

// Database configuration
define('DB_HOST', $_ENV['DB_HOST'] ?? '');
define('DB_USER', $_ENV['DB_USER'] ?? '');
define('DB_PASS', $_ENV['DB_PASS'] ?? '');
define('DB_NAME', $_ENV['DB_NAME'] ?? '');

// Third-party APIs
define('LOCATIONIQ_API_KEY', $_ENV['LOCATIONIQ_API_KEY'] ?? '');

// SMTP configuration for transactional emails
define('SMTP_HOST', $_ENV['SMTP_HOST'] ?? '');
define('SMTP_PORT', isset($_ENV['SMTP_PORT']) ? (int)$_ENV['SMTP_PORT'] : 587); // Default port is fine to fallback
define('SMTP_USER', $_ENV['SMTP_USER'] ?? '');
define('SMTP_PASS', $_ENV['SMTP_PASS'] ?? '');
define('SMTP_FROM_EMAIL', $_ENV['SMTP_FROM_EMAIL'] ?? 'noreply@watchover.tech');
define('SMTP_FROM_NAME', $_ENV['SMTP_FROM_NAME'] ?? 'WatchOver');

// Site URL
define('SITE_URL', 'https://watchover.tech');

// MQTT Configuration
define('MQTT_ENABLED', isset($_ENV['MQTT_ENABLED']) ? filter_var($_ENV['MQTT_ENABLED'], FILTER_VALIDATE_BOOLEAN) : true);
define('MQTT_HOST', $_ENV['MQTT_HOST'] ?? '127.0.0.1');
define('MQTT_PORT', isset($_ENV['MQTT_PORT']) ? (int)$_ENV['MQTT_PORT'] : 1883);
define('MQTT_WS_URL', $_ENV['MQTT_WS_URL'] ?? '');

// Establishes a connection to the MySQL database
function getConnection() {
    $conn = new mysqli(DB_HOST, DB_USER, DB_PASS, DB_NAME);
    if ($conn->connect_error) {
        return null;
    }
    $conn->set_charset("utf8mb4");
    $conn->query("SET time_zone = '+08:00'");
    return $conn;
}

// Sanitizes input strings to prevent SQL injection
function sanitize($conn, $value) {
    return $conn->real_escape_string(trim($value));
}

// Validates the CSRF token against the session
function validateCSRF() {
    $token = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if (empty($_SESSION['csrf_token']) || empty($token)) {
        return false;
    }
    return hash_equals($_SESSION['csrf_token'], $token);
}

// Checks if the user is currently logged in
function isAuthenticated() {
    return isset($_SESSION['user_id']) && !empty($_SESSION['user_id']);
}

// Verifies that a user owns a specific device
function verifyDeviceOwnership($conn, $user_id, $device_id) {
    $stmt = $conn->prepare("SELECT id FROM user_devices WHERE user_id = ? AND device_id = ?");
    $stmt->bind_param("is", $user_id, $device_id);
    $stmt->execute();
    $result = $stmt->get_result();
    $owns = $result->num_rows > 0;
    $stmt->close();
    return $owns;
}

// Sends transactional emails using PHPMailer via SMTP
function sendEmail($to, $subject, $body) {
    $mail = new PHPMailer(true);
    try {
        $mail->isSMTP();
        $mail->Host = SMTP_HOST;
        $mail->SMTPAuth = true;
        $mail->Username = SMTP_USER;
        $mail->Password = SMTP_PASS;
        $mail->SMTPSecure = PHPMailer::ENCRYPTION_STARTTLS;
        $mail->Port = SMTP_PORT;

        $mail->setFrom(SMTP_FROM_EMAIL, SMTP_FROM_NAME);
        $mail->addAddress($to);

        $mail->isHTML(true);
        $mail->Subject = $subject;
        $mail->Body = $body;
        $mail->AltBody = strip_tags($body);

        $mail->send();
        return true;
    } catch (Exception $e) {
        return false;
    }
}

// Publishes a message to MQTT broker (Mosquitto)
// Uses native PHP sockets - no external library needed
// Publishes a message to MQTT broker (Mosquitto)
// Uses native PHP sockets - no external library needed
function publishToMQTT($topic, $message) {
    if (!defined('MQTT_ENABLED') || !MQTT_ENABLED) {
        return "MQTT Disabled";
    }
    
    try {
        $socket = @fsockopen(MQTT_HOST, MQTT_PORT, $errno, $errstr, 2);
        if (!$socket) {
            return "Connection failed: $errstr ($errno)";
        }
        
        // MQTT Connect packet
        $clientId = 'php_' . uniqid();
        $connectPacket = chr(0x10); // CONNECT packet type
        $payload = chr(0x00) . chr(0x04) . 'MQTT' . chr(0x04) . chr(0x02) . chr(0x00) . chr(0x3C);
        $payload .= chr(0x00) . chr(strlen($clientId)) . $clientId;
        $connectPacket .= chr(strlen($payload)) . $payload;
        
        fwrite($socket, $connectPacket);
        stream_set_timeout($socket, 2);
        $response = fread($socket, 4);
        
        if (strlen($response) < 4 || ord($response[0]) != 0x20) {
            fclose($socket);
            return "Connection refused by broker (Invalid response)";
        }
        
        // MQTT Publish packet
        $topicLen = strlen($topic);
        $msgLen = strlen($message);
        $publishPacket = chr(0x30); // PUBLISH packet type (QoS 0)
        
        $remainingLen = 2 + $topicLen + $msgLen;
        
        // Variable Byte Integer encoding for Remaining Length
        do {
            $digit = $remainingLen % 128;
            $remainingLen = $remainingLen >> 7;
            if ($remainingLen > 0) {
                $digit = $digit | 0x80;
            }
            $publishPacket .= chr($digit);
        } while ($remainingLen > 0);
        
        $publishPacket .= chr(($topicLen >> 8) & 0xFF) . chr($topicLen & 0xFF);
        $publishPacket .= $topic . $message;
        
        fwrite($socket, $publishPacket);
        
        // MQTT Disconnect
        fwrite($socket, chr(0xE0) . chr(0x00));
        fclose($socket);
        
        return true;
    } catch (Exception $e) {
        return "Exception: " . $e->getMessage();
    }
}

// ... (skipping unchanged code) ...

// Receives and stores GPS coordinates from hardware devices
function saveGPSData() {
    $conn = getConnection();
    if (!$conn) {
        http_response_code(500);
        echo json_encode(['error' => 'Database connection failed']);
        return;
    }

    $device_id = sanitize($conn, $_POST['device_id'] ?? '');
    $lat = floatval($_POST['latitude'] ?? 0);
    $lon = floatval($_POST['longitude'] ?? 0);
    $battery = intval($_POST['battery'] ?? 0);

    // UPDATED CHECK: Only require device_id. Allow 0,0 coordinates.
    if (empty($device_id)) {
        http_response_code(400);
        echo json_encode(['error' => 'Missing device_id']);
        $conn->close();
        return;
    }

    // IP Rate Limiting: Max 100 requests per hour per IP
    $ip_address = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
    $rate_limit_stmt = $conn->prepare("
        SELECT COUNT(*) as request_count 
        FROM gps_data 
        WHERE device_id = ? 
        AND timestamp >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
    ");
    // Since we don't log IP, we just rate limit per device ID per hour to 100 max to match the requested 1-per-minute logic.
    $rate_limit_stmt->bind_param("s", $device_id);
    $rate_limit_stmt->execute();
    $rate_result = $rate_limit_stmt->get_result();
    $rate_row = $rate_result->fetch_assoc();
    $rate_limit_stmt->close();
    
    if ($rate_row['request_count'] >= 100) {
        http_response_code(429); // Too Many Requests
        echo json_encode(['error' => 'Rate limit exceeded. Maximum 100 updates per hour allowed.']);
        $conn->close();
        return;
    }

    if ($lat < -90 || $lat > 90 || $lon < -180 || $lon > 180) {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid coordinates']);
        $conn->close();
        return;
    }

    // Only check if device exists (no password validation)
    $stmt = $conn->prepare("SELECT device_id, device_name FROM devices WHERE device_id = ?");
    $stmt->bind_param("s", $device_id);
    $stmt->execute();
    $result = $stmt->get_result();
    $device = $result->fetch_assoc();

    if (!$device) {
        http_response_code(401);
        echo json_encode(['error' => 'Invalid device ID or password']);
        $stmt->close();
        $conn->close();
        return;
    }
    $device_name = $device['device_name'];
    $stmt->close();

    $timestamp = date('Y-m-d H:i:s');

    // Perform server-side reverse geocoding
    $address = getAddressFromCoordinates($lat, $lon);
    if (!$address) {
        $address = "$lat, $lon"; // Fallback to coordinates if geocoding fails
    }

    // Check if GPS coordinates are valid (not 0,0)
    $hasValidGPS = (abs($lat) > 0.01 && abs($lon) > 0.01);

    // Get current last known address from database
    $lastKnownAddress = $address; // Default to current address if GPS is valid
    if (!$hasValidGPS) {
        // GPS is invalid (0,0) - get last known address from database
        $lastKnownStmt = $conn->prepare("SELECT last_known_address FROM device_status WHERE device_id = ?");
        $lastKnownStmt->bind_param("s", $device_id);
        $lastKnownStmt->execute();
        $lastKnownResult = $lastKnownStmt->get_result();
        if ($lastKnownRow = $lastKnownResult->fetch_assoc()) {
            $lastKnownAddress = $lastKnownRow['last_known_address'] ?? $address;
        }
        $lastKnownStmt->close();
    }

    // Store GPS data with address in historical table
    $stmt = $conn->prepare("INSERT INTO gps_data (device_id, latitude, longitude, timestamp, battery_level, location_address, last_known_address) VALUES (?, ?, ?, ?, ?, ?, ?)");
    $stmt->bind_param("sddsiss", $device_id, $lat, $lon, $timestamp, $battery, $address, $lastKnownAddress);

    if ($stmt->execute()) {
        // Update current device status with address and last known address
        $update_stmt = $conn->prepare("
            INSERT INTO device_status (device_id, current_latitude, current_longitude, battery_level, location_address, last_known_address, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                current_latitude = VALUES(current_latitude),
                current_longitude = VALUES(current_longitude),
                battery_level = VALUES(battery_level),
                location_address = VALUES(location_address),
                last_known_address = VALUES(last_known_address),
                timestamp = VALUES(timestamp)
        ");
        $update_stmt->bind_param("sddssss", $device_id, $lat, $lon, $battery, $address, $lastKnownAddress, $timestamp);
        $update_stmt->execute();
        $update_stmt->close();
        // Publish to MQTT for real-time dashboard updates (include address)
        $mqttPayload = json_encode([
            'device_id' => $device_id,
            'device_name' => $device_name,
            'lat' => $lat,
            'lng' => $lon,
            'battery' => $battery,
            'timestamp' => $timestamp,
            'locationName' => $address
        ]);

        $mqttResult = publishToMQTT("watchover/device/$device_id/location", $mqttPayload);

        // Send push notifications for background/closed browsers
        sendPushNotifications($device_id, $lat, $lon, $battery);

        http_response_code(200);
        echo json_encode(['success' => true, 'message' => 'Data saved', 'mqtt_status' => $mqttResult]);
    } else {
        http_response_code(500);
        echo json_encode(['error' => 'Failed to save data']);
    }
    $stmt->close();
    $conn->close();
}

$action = $_GET['action'] ?? '';

switch($action) {
    case 'getCSRFToken':
        echo json_encode(['token' => $_SESSION['csrf_token']]);
        break;
    
    case 'register':
        if (!validateCSRF()) {
            http_response_code(403);
            echo json_encode(['error' => 'Invalid CSRF token']);
            exit;
        }
        registerUser();
        break;
    
    case 'verify':
        verifyEmail();
        break;
    
    case 'authenticate':
        if (!validateCSRF()) {
            http_response_code(403);
            echo json_encode(['error' => 'Invalid CSRF token']);
            exit;
        }
        authenticateUser();
        break;
    
    case 'logout':
        if (!validateCSRF()) {
            http_response_code(403);
            echo json_encode(['error' => 'Invalid CSRF token']);
            exit;
        }
        logoutUser();
        break;
    
    case 'checkSession':
        checkSession();
        break;

    case 'getRealtimeConfig':
        if (!isAuthenticated()) {
            http_response_code(401);
            echo json_encode(['error' => 'Not authenticated']);
            exit;
        }
        echo json_encode([
            'success' => true,
            'mqtt_enabled' => MQTT_ENABLED,
            'mqtt_ws_url' => MQTT_WS_URL
        ]);
        break;

    case 'registerDevice':
        // No CSRF check - called by A9G hardware device (no browser session)
        // Device authenticates via device_id + password in POST body
        registerDevice();
        break;

    case 'getUserDevices':
        if (!isAuthenticated()) {
            http_response_code(401);
            echo json_encode(['error' => 'Not authenticated']);
            exit;
        }
        getUserDevices();
        break;

    case 'removeDevice':
        if (!isAuthenticated()) {
            http_response_code(401);
            echo json_encode(['error' => 'Not authenticated']);
            exit;
        }
        removeDevice();
        break;
    
    case 'linkDevice':
        if (!validateCSRF() || !isAuthenticated()) {
            http_response_code(403);
            echo json_encode(['error' => 'Unauthorized']);
            exit;
        }
        linkDevice();
        break;
    
    case 'save_gps':
        saveGPSData();
        break;
    
    case 'getLocation':
        if (!isAuthenticated()) {
            http_response_code(401);
            echo json_encode(['error' => 'Not authenticated']);
            exit;
        }
        getLastLocation();
        break;
    
    case 'getHistory':
        if (!isAuthenticated()) {
            http_response_code(401);
            echo json_encode(['error' => 'Not authenticated']);
            exit;
        }
        getActivityHistory();
        break;
    
    case 'searchHistory':
        if (!isAuthenticated()) {
            http_response_code(401);
            echo json_encode(['error' => 'Not authenticated']);
            exit;
        }
        searchActivityHistory();
        break;
    
    case 'updateDeviceName':
        if (!validateCSRF() || !isAuthenticated()) {
            http_response_code(403);
            echo json_encode(['error' => 'Unauthorized']);
            exit;
        }
        updateDeviceName();
        break;
    
    case 'updatePassword':
        if (!validateCSRF() || !isAuthenticated()) {
            http_response_code(403);
            echo json_encode(['error' => 'Unauthorized']);
            exit;
        }
        updatePassword();
        break;

    case 'updateDevicePassword':
        if (!validateCSRF() || !isAuthenticated()) {
            http_response_code(403);
            echo json_encode(['error' => 'Unauthorized']);
            exit;
        }
        updateDevicePassword();
        break;
    
        // While we are here, let's add the Vibrate case too so it doesn't fail later
    case 'vibrateDevice':
        if (!isAuthenticated()) {
            http_response_code(401);
            echo json_encode(['error' => 'Not authenticated']);
            exit;
        }
        vibrateDevice();
        break;
    
    case 'saveGeofence':
        if (!validateCSRF() || !isAuthenticated()) {
            http_response_code(403);
            echo json_encode(['error' => 'Unauthorized']);
            exit;
        }
        saveGeofence();
        break;
    
    case 'getGeofence':
        if (!isAuthenticated()) {
            http_response_code(401);
            echo json_encode(['error' => 'Not authenticated']);
            exit;
        }
        getGeofence();
        break;
    
    case 'deleteGeofence':
        if (!validateCSRF() || !isAuthenticated()) {
            http_response_code(403);
            echo json_encode(['error' => 'Unauthorized']);
            exit;
        }
        deleteGeofence();
        break;
    
    case 'forgotPassword':
        if (!validateCSRF()) {
            http_response_code(403);
            echo json_encode(['error' => 'Invalid CSRF token']);
            exit;
        }
        forgotPassword();
        break;
    
    case 'resetPassword':
        // No CSRF validation needed - password reset uses URL token for security
        resetPassword();
        break;
    
    case 'getVapidPublicKey':
        if (!isAuthenticated()) {
            http_response_code(401);
            echo json_encode(['error' => 'Not authenticated']);
            exit;
        }
        echo json_encode(['publicKey' => VAPID_PUBLIC_KEY]);
        break;
    
    case 'savePushSubscription':
        if (!validateCSRF() || !isAuthenticated()) {
            http_response_code(403);
            echo json_encode(['error' => 'Unauthorized']);
            exit;
        }
        savePushSubscription();
        break;
    
    case 'deletePushSubscription':
        if (!validateCSRF() || !isAuthenticated()) {
            http_response_code(403);
            echo json_encode(['error' => 'Unauthorized']);
            exit;
        }
        deletePushSubscription();
        break;
    
    default:
        http_response_code(400);
        echo json_encode(['error' => 'Invalid action']);
}

function registerDevice() {
    $conn = getConnection();
    if (!$conn) {
        http_response_code(500);
        echo json_encode(['error' => 'Database connection failed']);
        return;
    }
    $device_id = sanitize($conn, $_POST['device_id'] ?? '');
    $device_password = sanitize($conn, $_POST['password'] ?? '');
    if (empty($device_id) || empty($device_password)) {
        http_response_code(400);
        echo json_encode(['error' => 'Missing required fields']);
        $conn->close();
        return;
    }
    // Check if device already exists
    $stmt = $conn->prepare("SELECT device_id FROM devices WHERE device_id = ?");
    $stmt->bind_param("s", $device_id);
    $stmt->execute();
    $result = $stmt->get_result();
    if ($result->num_rows > 0) {
        echo json_encode(['success' => true, 'message' => 'Device already registered']);
        $stmt->close();
        $conn->close();
        return;
    }
    $stmt->close();
    // Register new device
    $device_name = $device_id;
    $stmt = $conn->prepare("INSERT INTO devices (device_id, device_name, device_password) VALUES (?, ?, ?)");
    $stmt->bind_param("sss", $device_id, $device_name, $device_password);
    if ($stmt->execute()) {
        echo json_encode(['success' => true, 'message' => 'Device registered']);
    } else {
        http_response_code(500);
        echo json_encode(['error' => 'Failed to register device']);
    }
    $stmt->close();
    $conn->close();
}

// Handles new user registration and sends verification email
function registerUser() {
    $conn = getConnection();
    if (!$conn) {
        echo json_encode(['success' => false, 'error' => 'Database connection failed']);
        return;
    }

    $input = json_decode(file_get_contents('php://input'), true);
    $email = sanitize($conn, $input['email'] ?? '');
    $password = $input['password'] ?? '';

    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        echo json_encode(['success' => false, 'error' => 'Invalid email format']);
        $conn->close();
        return;
    }

    if (strlen($password) < 6) {
        echo json_encode(['success' => false, 'error' => 'Password must be at least 6 characters']);
        $conn->close();
        return;
    }

    // Delete unverified users whose verification token has expired (frees the email for re-registration)
    $cleanup = $conn->prepare("DELETE FROM users WHERE is_verified = 0 AND token_expires IS NOT NULL AND token_expires < NOW()");
    $cleanup->execute();
    $cleanup->close();

    $stmt = $conn->prepare("SELECT user_id FROM users WHERE email = ?");
    $stmt->bind_param("s", $email);
    $stmt->execute();
    $result = $stmt->get_result();
    if ($result->num_rows > 0) {
        echo json_encode(['success' => false, 'error' => 'Email already registered']);
        $stmt->close();
        $conn->close();
        return;
    }
    $stmt->close();

    $hashed_password = password_hash($password, PASSWORD_DEFAULT);

    $verification_token = bin2hex(random_bytes(32));
    $token_expires = date('Y-m-d H:i:s', strtotime('+24 hours'));

    $stmt = $conn->prepare("INSERT INTO users (email, password, is_verified, verification_token, token_expires) VALUES (?, ?, 0, ?, ?)");
    $stmt->bind_param("ssss", $email, $hashed_password, $verification_token, $token_expires);

    if ($stmt->execute()) {
        $verify_link = SITE_URL . "/verify.php?token=" . $verification_token;
        $email_body = "
            <html>
            <body style='font-family: Arial, sans-serif;'>
                <div style='max-width: 600px; margin: 0 auto; padding: 20px;'>
                    <h2 style='color: #00ff26;'>Welcome to WatchOver!</h2>
                    <p>Thank you for registering. Please verify your email address to activate your account.</p>
                    <p style='margin: 30px 0;'>
                        <a href='{$verify_link}' style='background: #00ff26; color: #1a1a1a; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;'>
                            Verify Email
                        </a>
                    </p>
                    <p>Or copy this link to your browser:</p>
                    <p style='color: #666; word-break: break-all;'>{$verify_link}</p>
                    <p style='color: #888; font-size: 12px; margin-top: 30px;'>This link will expire in 24 hours.</p>
                </div>
            </body>
            </html>
        ";

        $emailSent = sendEmail($email, 'Verify Your WatchOver Account', $email_body);

        echo json_encode([
            'success' => true,
            'message' => 'Registration successful! Please check your email to verify your account.',
            'emailSent' => $emailSent
        ]);
    } else {
        echo json_encode(['success' => false, 'error' => 'Registration failed']);
    }

    $stmt->close();
    $conn->close();
}

// Processes password reset requests and sends recovery email
function forgotPassword() {
    $conn = getConnection();
    if (!$conn) {
        echo json_encode(['success' => false, 'error' => 'Database connection failed']);
        return;
    }

    $input = json_decode(file_get_contents('php://input'), true);
    $email = sanitize($conn, $input['email'] ?? '');

    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        echo json_encode(['success' => false, 'error' => 'Invalid email format']);
        $conn->close();
        return;
    }

    $stmt = $conn->prepare("SELECT user_id, reset_token, reset_token_expires FROM users WHERE email = ?");
    $stmt->bind_param("s", $email);
    $stmt->execute();
    $result = $stmt->get_result();

    if ($result->num_rows === 0) {
        echo json_encode(['success' => false, 'error' => 'Email not found']);
        $stmt->close();
        $conn->close();
        return;
    }

    $user = $result->fetch_assoc();
    $stmt->close();

    if ($user['reset_token'] && $user['reset_token_expires']) {
        $token_created_time = strtotime($user['reset_token_expires']) - 3600;
        $time_since_request = time() - $token_created_time;

        if ($time_since_request < 1800) {
            $minutes_left = ceil((1800 - $time_since_request) / 60);
            echo json_encode([
                'success' => false,
                'error' => "A password reset link was already sent. Please check your email or try again in $minutes_left minutes"
            ]);
            $conn->close();
            return;
        }
    }

    $reset_token = bin2hex(random_bytes(32));
    $token_expires = date('Y-m-d H:i:s', strtotime('+1 hour'));

    $stmt = $conn->prepare("UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE email = ?");
    $stmt->bind_param("sss", $reset_token, $token_expires, $email);

    if ($stmt->execute()) {
        $reset_link = SITE_URL . "/verify.php?action=reset&token=" . $reset_token;
        $email_body = "
            <h2>Password Reset Request</h2>
            <p>You requested to reset your password. Click the link below to reset it:</p>
            <p><a href='{$reset_link}' style='background: #00ff26; color: #000; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;'>Reset Password</a></p>
            <p>Or copy this link to your browser:</p>
            <p>{$reset_link}</p>
            <p>This link will expire in 1 hour.</p>
            <p>If you didn't request this, please ignore this email.</p>
        ";

        $emailSent = sendEmail($email, 'Password Reset Request', $email_body);

        if ($emailSent) {
            echo json_encode(['success' => true, 'message' => 'Reset link sent to your email']);
        } else {
            echo json_encode(['success' => false, 'error' => 'Failed to send email. Please check your email configuration.']);
        }
    } else {
        echo json_encode(['success' => false, 'error' => 'Failed to generate reset token']);
    }

    $stmt->close();
    $conn->close();
}

// Updates the user password after token verification
function resetPassword() {
    $conn = getConnection();
    if (!$conn) {
        echo json_encode(['success' => false, 'error' => 'Database connection failed']);
        return;
    }

    $input = json_decode(file_get_contents('php://input'), true);
    $token = sanitize($conn, $input['token'] ?? '');
    $new_password = $input['new_password'] ?? '';

    if (strlen($new_password) < 6) {
        echo json_encode(['success' => false, 'error' => 'Password must be at least 6 characters']);
        $conn->close();
        return;
    }

    // Clear expired reset tokens
    $cleanup = $conn->prepare("UPDATE users SET reset_token = NULL, reset_token_expires = NULL WHERE reset_token_expires IS NOT NULL AND reset_token_expires < NOW()");
    $cleanup->execute();
    $cleanup->close();

    $stmt = $conn->prepare("SELECT user_id, email FROM users WHERE reset_token = ? AND reset_token_expires > NOW()");
    $stmt->bind_param("s", $token);
    $stmt->execute();
    $result = $stmt->get_result();

    if ($result->num_rows === 0) {
        echo json_encode(['success' => false, 'error' => 'Invalid or expired reset token']);
        $stmt->close();
        $conn->close();
        return;
    }

    $user = $result->fetch_assoc();
    $stmt->close();

    $hashed_password = password_hash($new_password, PASSWORD_DEFAULT);

    $update_stmt = $conn->prepare("UPDATE users SET password = ?, reset_token = NULL, reset_token_expires = NULL WHERE user_id = ?");
    $update_stmt->bind_param("si", $hashed_password, $user['user_id']);

    if ($update_stmt->execute()) {
        echo json_encode(['success' => true, 'message' => 'Password reset successful']);
    } else {
        echo json_encode(['success' => false, 'error' => 'Failed to reset password']);
    }

    $update_stmt->close();
    $conn->close();
}

// Verifies the user email address using the token
function verifyEmail() {
    $conn = getConnection();
    if (!$conn) {
        echo json_encode(['success' => false, 'error' => 'Database connection failed']);
        return;
    }

    $token = sanitize($conn, $_GET['token'] ?? '');

    if (empty($token)) {
        echo json_encode(['success' => false, 'error' => 'Missing verification token']);
        $conn->close();
        return;
    }

    // Delete unverified users whose verification token has expired
    $cleanup = $conn->prepare("DELETE FROM users WHERE is_verified = 0 AND token_expires IS NOT NULL AND token_expires < NOW()");
    $cleanup->execute();
    $cleanup->close();

    $stmt = $conn->prepare("SELECT user_id, email, is_verified FROM users WHERE verification_token = ? AND token_expires > NOW()");
    $stmt->bind_param("s", $token);
    $stmt->execute();
    $result = $stmt->get_result();

    if ($result->num_rows === 0) {
        echo json_encode(['success' => false, 'error' => 'Invalid or expired verification token']);
        $stmt->close();
        $conn->close();
        return;
    }

    $user = $result->fetch_assoc();
    $stmt->close();

    if ($user['is_verified']) {
        echo json_encode(['success' => false, 'error' => 'Email already verified']);
        $conn->close();
        return;
    }

    $update_stmt = $conn->prepare("UPDATE users SET is_verified = 1, verification_token = NULL, token_expires = NULL WHERE user_id = ?");
    $update_stmt->bind_param("i", $user['user_id']);

    if ($update_stmt->execute()) {
        echo json_encode(['success' => true, 'message' => 'Email verified successfully']);
    } else {
        echo json_encode(['success' => false, 'error' => 'Verification failed']);
    }

    $update_stmt->close();
    $conn->close();
}

// Validates user credentials and initiates a session
function authenticateUser() {
    $conn = getConnection();
    if (!$conn) {
        echo json_encode(['success' => false, 'error' => 'Database connection failed']);
        return;
    }

    $input = json_decode(file_get_contents('php://input'), true);
    $email = sanitize($conn, $input['email'] ?? '');
    $password = $input['password'] ?? '';

    if (empty($email) || empty($password)) {
        echo json_encode(['success' => false, 'error' => 'Missing email or password']);
        $conn->close();
        return;
    }

    $stmt = $conn->prepare("SELECT user_id, email, password, is_verified FROM users WHERE email = ?");
    $stmt->bind_param("s", $email);
    $stmt->execute();
    $result = $stmt->get_result();

    if ($row = $result->fetch_assoc()) {
        if (!$row['is_verified']) {
            echo json_encode(['success' => false, 'error' => 'Please verify your email first']);
            $stmt->close();
            $conn->close();
            return;
        }

        if (password_verify($password, $row['password'])) {
            session_regenerate_id(true);
            $_SESSION['user_id'] = $row['user_id'];
            $_SESSION['email'] = $row['email'];

            echo json_encode([
                'success' => true,
                'message' => 'Login successful',
                'user_id' => $row['user_id'],
                'email' => $row['email']
            ]);
        } else {
            echo json_encode(['success' => false, 'error' => 'Invalid email or password']);
        }
    } else {
        echo json_encode(['success' => false, 'error' => 'Invalid email or password']);
    }

    $stmt->close();
    $conn->close();
}

// Terminates the session and logs the user out
function logoutUser() {
    $_SESSION = array();

    if (ini_get("session.use_cookies")) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000,
            $params["path"], $params["domain"],
            $params["secure"], $params["httponly"]
        );
    }

    session_destroy();

    echo json_encode(['success' => true, 'message' => 'Logged out successfully']);
}

// Returns the current authentication status and user details
function checkSession() {
    if (isAuthenticated()) {
        echo json_encode([
            'authenticated' => true,
            'user_id' => $_SESSION['user_id'],
            'email' => $_SESSION['email']
        ]);
    } else {
        echo json_encode(['authenticated' => false]);
    }
}

// Retrieves all devices linked to the authenticated user
function getUserDevices() {
    $conn = getConnection();
    if (!$conn) {
        echo json_encode(['success' => false, 'error' => 'Database connection failed']);
        return;
    }

    $user_id = $_SESSION['user_id'];

    $stmt = $conn->prepare("
        SELECT d.device_id, d.device_name, d.device_password, ds.current_latitude, ds.current_longitude, ds.battery_level, ds.timestamp, ds.last_known_address, ds.location_address
        FROM user_devices ud
        INNER JOIN devices d ON ud.device_id = d.device_id
        LEFT JOIN device_status ds ON d.device_id = ds.device_id
        WHERE ud.user_id = ?
    ");
    $stmt->bind_param("i", $user_id);
    $stmt->execute();
    $result = $stmt->get_result();

    $devices = [];
    while ($row = $result->fetch_assoc()) {
        // Get last known coordinates from gps_data table
        $lastKnownLat = null;
        $lastKnownLng = null;
        
        $lat = $row['current_latitude'] ? floatval($row['current_latitude']) : 0;
        $lng = $row['current_longitude'] ? floatval($row['current_longitude']) : 0;
        $hasValidGPS = (abs($lat) > 0.01 && abs($lng) > 0.01);
        
        if (!$hasValidGPS) {
            // GPS is invalid - fetch last known coordinates from gps_data
            $lastKnownStmt = $conn->prepare("
                SELECT latitude, longitude
                FROM gps_data
                WHERE device_id = ? AND (latitude != 0 OR longitude != 0)
                ORDER BY timestamp DESC
                LIMIT 1
            ");
            $lastKnownStmt->bind_param("s", $row['device_id']);
            $lastKnownStmt->execute();
            $lastKnownResult = $lastKnownStmt->get_result();
            
            if ($lastKnownRow = $lastKnownResult->fetch_assoc()) {
                $lastKnownLat = floatval($lastKnownRow['latitude']);
                $lastKnownLng = floatval($lastKnownRow['longitude']);
            }
            $lastKnownStmt->close();
        }
        
        $devices[] = [
            'device_id' => $row['device_id'],
            'device_name' => $row['device_name'],
            'has_default_password' => ($row['device_password'] === '12345'),
            'current_latitude' => $row['current_latitude'] ? floatval($row['current_latitude']) : null,
            'current_longitude' => $row['current_longitude'] ? floatval($row['current_longitude']) : null,
            'battery_level' => $row['battery_level'] ? intval($row['battery_level']) : null,
            'timestamp' => $row['timestamp'],
            'last_known_address' => $row['last_known_address'] ?? null,
            'location_address' => $row['location_address'] ?? null,
            'last_known_latitude' => $lastKnownLat,
            'last_known_longitude' => $lastKnownLng
        ];
    }

    echo json_encode(['success' => true, 'devices' => $devices]);

    $stmt->close();
    $conn->close();
}

// Links a new hardware device to the user account
function linkDevice() {
    $conn = getConnection();
    if (!$conn) {
        echo json_encode(['success' => false, 'error' => 'Database connection failed']);
        return;
    }

    $input = json_decode(file_get_contents('php://input'), true);
    $user_id = $_SESSION['user_id'];
    $device_id = sanitize($conn, $input['device_id'] ?? '');
    $device_password = $input['device_password'] ?? '';

    if (empty($device_id) || empty($device_password)) {
        echo json_encode(['success' => false, 'error' => 'Missing parameters']);
        $conn->close();
        return;
    }

    $stmt = $conn->prepare("SELECT device_id, device_name FROM devices WHERE device_id = ? AND device_password = ?");
    $stmt->bind_param("ss", $device_id, $device_password);
    $stmt->execute();
    $result = $stmt->get_result();

    if ($row = $result->fetch_assoc()) {
        $stmt->close();

        $check_stmt = $conn->prepare("SELECT id FROM user_devices WHERE user_id = ? AND device_id = ?");
        $check_stmt->bind_param("is", $user_id, $device_id);
        $check_stmt->execute();
        $check_result = $check_stmt->get_result();

        if ($check_result->num_rows > 0) {
            echo json_encode(['success' => false, 'error' => 'Device already linked to your account']);
            $check_stmt->close();
            $conn->close();
            return;
        }
        $check_stmt->close();

        $link_stmt = $conn->prepare("INSERT INTO user_devices (user_id, device_id) VALUES (?, ?)");
        $link_stmt->bind_param("is", $user_id, $device_id);

        if ($link_stmt->execute()) {
            echo json_encode([
                'success' => true,
                'message' => 'Device linked successfully',
                'device_name' => $row['device_name']
            ]);
        } else {
            echo json_encode(['success' => false, 'error' => 'Failed to link device']);
        }
        $link_stmt->close();
    } else {
        echo json_encode(['success' => false, 'error' => 'Invalid device ID or password']);
        $stmt->close();
    }

    $conn->close();
}

// Receives and stores GPS coordinates from hardware devices


// Fetches the most recent location for a specific device
function getLastLocation() {
    $conn = getConnection();
    if (!$conn) {
        echo json_encode(['success' => false, 'error' => 'Database connection failed']);
        return;
    }

    $device_id = sanitize($conn, $_GET['device_id'] ?? '');

    if (empty($device_id)) {
        echo json_encode(['success' => false, 'error' => 'Missing device_id']);
        $conn->close();
        return;
    }

    if (!verifyDeviceOwnership($conn, $_SESSION['user_id'], $device_id)) {
        http_response_code(403);
        echo json_encode(['success' => false, 'error' => 'Unauthorized: You do not own this device']);
        $conn->close();
        return;
    }

    $stmt = $conn->prepare("
        SELECT ds.*, d.device_name
        FROM device_status ds
        INNER JOIN devices d ON ds.device_id = d.device_id
        WHERE ds.device_id = ?
    ");
    $stmt->bind_param("s", $device_id);
    $stmt->execute();
    $result = $stmt->get_result();

    if ($row = $result->fetch_assoc()) {
        $lat = floatval($row['current_latitude']);
        $lng = floatval($row['current_longitude']);
        $locationName = $row['location_address'] ?? null;
        $lastKnownAddress = $row['last_known_address'] ?? null;

        // Check if GPS coordinates are invalid (0,0) and use last known address
        $hasValidGPS = (abs($lat) > 0.01 && abs($lng) > 0.01);

        if (!$hasValidGPS && $lastKnownAddress) {
            // GPS coordinates are invalid (0,0) - use last known address from database
            $locationName = $lastKnownAddress . " (No GPS Signal)";

            // Also get the last known coordinates from gps_data table
            $lastKnownStmt = $conn->prepare("
                SELECT latitude, longitude
                FROM gps_data
                WHERE device_id = ? AND (latitude != 0 OR longitude != 0)
                ORDER BY timestamp DESC
                LIMIT 1
            ");
            $lastKnownStmt->bind_param("s", $device_id);
            $lastKnownStmt->execute();
            $lastKnownResult = $lastKnownStmt->get_result();

            if ($lastKnownRow = $lastKnownResult->fetch_assoc()) {
                $lat = floatval($lastKnownRow['latitude']);
                $lng = floatval($lastKnownRow['longitude']);
            }
            $lastKnownStmt->close();
        }

        echo json_encode([
            'success' => true,
            'location' => [
                'lat' => $lat,
                'lng' => $lng,
                'battery' => intval($row['battery_level']),
                'device_name' => $row['device_name'],
                'timestamp' => $row['timestamp'],
                'locationName' => $locationName,
                'lastKnownAddress' => $lastKnownAddress
            ]
        ]);
    } else {
        echo json_encode(['success' => false, 'error' => 'No data found']);
    }

    $stmt->close();
    $conn->close();
}

// Retrieves historical location data points
function getActivityHistory() {
    $conn = getConnection();
    if (!$conn) {
        echo json_encode(['success' => false, 'error' => 'Database connection failed']);
        return;
    }

    $device_id = sanitize($conn, $_GET['device_id'] ?? '');
    $limit = intval($_GET['results'] ?? 100);
    if ($limit > 1000) $limit = 1000;

    if (empty($device_id)) {
        echo json_encode(['success' => false, 'error' => 'Missing device_id']);
        $conn->close();
        return;
    }

    if (!verifyDeviceOwnership($conn, $_SESSION['user_id'], $device_id)) {
        http_response_code(403);
        echo json_encode(['success' => false, 'error' => 'Unauthorized: You do not own this device']);
        $conn->close();
        return;
    }

    $stmt = $conn->prepare("SELECT id, device_id, latitude, longitude, timestamp, battery_level, location_address, last_known_address FROM gps_data WHERE device_id = ? ORDER BY timestamp DESC LIMIT ?");
    $stmt->bind_param("si", $device_id, $limit);
    $stmt->execute();
    $result = $stmt->get_result();

    $data = [];
    while ($row = $result->fetch_assoc()) {
        $data[] = [
            'lat' => floatval($row['latitude']),
            'lng' => floatval($row['longitude']),
            'battery' => intval($row['battery_level']),
            'timestamp' => $row['timestamp'],
            'locationName' => $row['location_address'] ?? null,
            'lastKnownAddress' => $row['last_known_address'] ?? null
        ];
    }

    echo json_encode(['success' => true, 'history' => $data]);

    $stmt->close();
    $conn->close();
}

// Searches historical location data by address or date
function searchActivityHistory() {
    $conn = getConnection();
    if (!$conn) {
        echo json_encode(['success' => false, 'error' => 'Database connection failed']);
        return;
    }

    $device_id = sanitize($conn, $_GET['device_id'] ?? '');
    $search = sanitize($conn, $_GET['search'] ?? '');

    if (empty($device_id) || empty($search)) {
        echo json_encode(['success' => false, 'error' => 'Missing device_id or search query']);
        $conn->close();
        return;
    }

    if (!verifyDeviceOwnership($conn, $_SESSION['user_id'], $device_id)) {
        http_response_code(403);
        echo json_encode(['success' => false, 'error' => 'Unauthorized: You do not own this device']);
        $conn->close();
        return;
    }

    $searchPattern = '%' . $search . '%';

    $stmt = $conn->prepare("SELECT id, device_id, latitude, longitude, timestamp, battery_level, location_address, last_known_address FROM gps_data WHERE device_id = ? AND (location_address LIKE ? OR timestamp LIKE ? OR DATE_FORMAT(timestamp, '%M %d, %Y %h:%i %p') LIKE ?) ORDER BY timestamp DESC LIMIT 200");
    $stmt->bind_param("ssss", $device_id, $searchPattern, $searchPattern, $searchPattern);
    $stmt->execute();
    $result = $stmt->get_result();

    $data = [];
    while ($row = $result->fetch_assoc()) {
        $data[] = [
            'lat' => floatval($row['latitude']),
            'lng' => floatval($row['longitude']),
            'battery' => intval($row['battery_level']),
            'timestamp' => $row['timestamp'],
            'locationName' => $row['location_address'] ?? null,
            'lastKnownAddress' => $row['last_known_address'] ?? null
        ];
    }

    echo json_encode(['success' => true, 'history' => $data]);

    $stmt->close();
    $conn->close();
}

// Updates the display name of a device
function updateDeviceName() {
    $conn = getConnection();
    if (!$conn) {
        echo json_encode(['success' => false, 'error' => 'Database connection failed']);
        return;
    }

    $input = json_decode(file_get_contents('php://input'), true);
    $device_id = sanitize($conn, $input['deviceId'] ?? '');
    $new_name = sanitize($conn, $input['name'] ?? '');

    if (empty($device_id) || empty($new_name)) {
        echo json_encode(['success' => false, 'error' => 'Missing parameters']);
        $conn->close();
        return;
    }

    if (!verifyDeviceOwnership($conn, $_SESSION['user_id'], $device_id)) {
        http_response_code(403);
        echo json_encode(['success' => false, 'error' => 'Unauthorized: You do not own this device']);
        $conn->close();
        return;
    }

    $stmt = $conn->prepare("UPDATE devices SET device_name = ? WHERE device_id = ?");
    $stmt->bind_param("ss", $new_name, $device_id);

    if ($stmt->execute()) {
        echo json_encode(['success' => true, 'message' => 'Device name updated']);
    } else {
        echo json_encode(['success' => false, 'error' => 'Update failed']);
    }

    $stmt->close();
    $conn->close();
}

// Updates the user's login password
function updatePassword() {
    $conn = getConnection();
    if (!$conn) {
        echo json_encode(['success' => false, 'error' => 'Database connection failed']);
        return;
    }

    $input = json_decode(file_get_contents('php://input'), true);
    $user_id = $_SESSION['user_id'];
    $old_password = $input['oldPassword'] ?? '';
    $new_password = $input['newPassword'] ?? '';

    if (empty($old_password) || empty($new_password)) {
        echo json_encode(['success' => false, 'error' => 'Missing parameters']);
        $conn->close();
        return;
    }

    if (strlen($new_password) < 6) {
        echo json_encode(['success' => false, 'error' => 'Password must be at least 6 characters']);
        $conn->close();
        return;
    }

    $stmt = $conn->prepare("SELECT password FROM users WHERE user_id = ?");
    $stmt->bind_param("i", $user_id);
    $stmt->execute();
    $result = $stmt->get_result();

    if ($row = $result->fetch_assoc()) {
        if (!password_verify($old_password, $row['password'])) {
            echo json_encode(['success' => false, 'error' => 'Incorrect current password']);
            $stmt->close();
            $conn->close();
            return;
        }
    } else {
        echo json_encode(['success' => false, 'error' => 'User not found']);
        $stmt->close();
        $conn->close();
        return;
    }
    $stmt->close();

    $hashed_password = password_hash($new_password, PASSWORD_DEFAULT);
    $update_stmt = $conn->prepare("UPDATE users SET password = ? WHERE user_id = ?");
    $update_stmt->bind_param("si", $hashed_password, $user_id);

    if ($update_stmt->execute()) {
        echo json_encode(['success' => true, 'message' => 'Password updated']);
    } else {
        echo json_encode(['success' => false, 'error' => 'Update failed']);
    }

    $update_stmt->close();
    $conn->close();
}

// Helper: Fetch address string from LocationIQ
function getAddressFromCoordinates($lat, $lng) {
    $url = "https://us1.locationiq.com/v1/reverse?key=" . LOCATIONIQ_API_KEY . "&lat={$lat}&lon={$lng}&format=json";

    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 3); // Short timeout for push
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);

    $response = curl_exec($ch);
    $http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($http_code === 200) {
        $data = json_decode($response, true);
        
        // Try to construct a shorter address (User wanted "only the street")
        if (isset($data['address'])) {
            $addr = $data['address'];
            $parts = [];
            
            // Prioritize road/street
            if (!empty($addr['road'])) $parts[] = $addr['road'];
            elseif (!empty($addr['pedestrian'])) $parts[] = $addr['pedestrian'];
            elseif (!empty($addr['street'])) $parts[] = $addr['street'];
            
            // Optional: Add suburb or city if road is missing or for context (minimal)
            // if (empty($parts) && !empty($addr['suburb'])) $parts[] = $addr['suburb'];
            
            if (!empty($parts)) {
                return implode(', ', $parts);
            }
        }
        
        // Fallback to full name if structure fails
        return $data['display_name'] ?? "$lat, $lng";
    }
    return null;
}

// Saves or updates geofence parameters for a device
function saveGeofence() {
    $conn = getConnection();
    if (!$conn) {
        echo json_encode(['success' => false, 'error' => 'Database connection failed']);
        return;
    }

    $input = json_decode(file_get_contents('php://input'), true);
    $deviceid = sanitize($conn, $input['deviceid'] ?? '');
    $lat = floatval($input['lat'] ?? 0);
    $lng = floatval($input['lng'] ?? 0);
    $radius = intval($input['radius'] ?? 50);

    if (empty($deviceid) || $lat == 0 || $lng == 0) {
        echo json_encode(['success' => false, 'error' => 'Missing parameters']);
        $conn->close();
        return;
    }

    if ($lat < -90 || $lat > 90 || $lng < -180 || $lng > 180) {
        echo json_encode(['success' => false, 'error' => 'Invalid coordinates']);
        $conn->close();
        return;
    }

    $user_id = $_SESSION['user_id'];

    $checkStmt = $conn->prepare("SELECT geofence_id FROM geofences WHERE device_id = ?");
    $checkStmt->bind_param("s", $deviceid);
    $checkStmt->execute();
    $checkResult = $checkStmt->get_result();

    if ($checkResult->num_rows > 0) {
        $checkStmt->close();
        $stmt = $conn->prepare("UPDATE geofences SET center_latitude = ?, center_longitude = ?, radius = ? WHERE device_id = ?");
        $stmt->bind_param("ddis", $lat, $lng, $radius, $deviceid);
    } else {
        $checkStmt->close();
        $stmt = $conn->prepare("INSERT INTO geofences (user_id, device_id, center_latitude, center_longitude, radius) VALUES (?, ?, ?, ?, ?)");
        $stmt->bind_param("isddi", $user_id, $deviceid, $lat, $lng, $radius);
    }

    if ($stmt->execute()) {
        echo json_encode([
            'success' => true,
            'message' => 'Geofence saved successfully',
            'geofence' => ['lat' => $lat, 'lng' => $lng, 'radius' => $radius]
        ]);
    } else {
        echo json_encode(['success' => false, 'error' => 'Failed to save geofence: ' . $stmt->error]);
    }

    $stmt->close();
    $conn->close();
}

// Retrieves the geofence settings for a device
function getGeofence() {
    $conn = getConnection();
    if (!$conn) {
        echo json_encode(['success' => false, 'error' => 'Database connection failed']);
        return;
    }

    $deviceid = sanitize($conn, $_GET['deviceid'] ?? '');

    if (empty($deviceid)) {
        echo json_encode(['success' => false, 'error' => 'Missing deviceid']);
        $conn->close();
        return;
    }

    $stmt = $conn->prepare("SELECT geofence_id, center_latitude, center_longitude, radius FROM geofences WHERE device_id = ? LIMIT 1");
    $stmt->bind_param("s", $deviceid);
    $stmt->execute();
    $result = $stmt->get_result();

    if ($row = $result->fetch_assoc()) {
        echo json_encode([
            'success' => true,
            'geofence' => [
                'id' => intval($row['geofence_id']),
                'lat' => floatval($row['center_latitude']),
                'lng' => floatval($row['center_longitude']),
                'radius' => intval($row['radius'])
            ]
        ]);
    } else {
        echo json_encode(['success' => false, 'message' => 'No geofence found for this device']);
    }

    $stmt->close();
    $conn->close();
}

// Removes the geofence configuration for a device
function deleteGeofence() {
    $conn = getConnection();
    if (!$conn) {
        echo json_encode(['success' => false, 'error' => 'Database connection failed']);
        return;
    }

    $deviceid = sanitize($conn, $_GET['deviceid'] ?? '');

    if (empty($deviceid)) {
        echo json_encode(['success' => false, 'error' => 'Missing deviceid']);
        $conn->close();
        return;
    }

    $stmt = $conn->prepare("DELETE FROM geofences WHERE device_id = ?");
    $stmt->bind_param("s", $deviceid);

    if ($stmt->execute()) {
        if ($stmt->affected_rows > 0) {
            echo json_encode(['success' => true, 'message' => 'Geofence deleted successfully']);
        } else {
            echo json_encode(['success' => false, 'message' => 'No geofence found to delete']);
        }
    } else {
        echo json_encode(['success' => false, 'error' => 'Failed to delete geofence']);
    }

    $stmt->close();
    $conn->close();
}

function updateDevicePassword() {
    $conn = getConnection();
    if (!$conn) {
        echo json_encode(['success' => false, 'error' => 'Database connection failed']);
        return;
    }

    $input = json_decode(file_get_contents('php://input'), true);
    $device_id = sanitize($conn, $input['device_id'] ?? '');
    $current_password = sanitize($conn, $input['current_password'] ?? '');
    $new_password = $input['new_password'] ?? '';
    $user_id = $_SESSION['user_id'];

    if (empty($device_id) || empty($current_password) || empty($new_password)) {
        echo json_encode(['success' => false, 'error' => 'Missing parameters']);
        $conn->close();
        return;
    }

    // Verify current device password matches
    $verify_stmt = $conn->prepare("SELECT device_password FROM devices WHERE device_id = ?");
    $verify_stmt->bind_param("s", $device_id);
    $verify_stmt->execute();
    $verify_result = $verify_stmt->get_result();

    if ($verify_result->num_rows === 0) {
        echo json_encode(['success' => false, 'error' => 'Device not found']);
        $verify_stmt->close();
        $conn->close();
        return;
    }

    $device_row = $verify_result->fetch_assoc();
    if ($device_row['device_password'] !== $current_password) {
        echo json_encode(['success' => false, 'error' => 'Incorrect current device password']);
        $verify_stmt->close();
        $conn->close();
        return;
    }
    $verify_stmt->close();

    $check_stmt = $conn->prepare("SELECT id FROM user_devices WHERE user_id = ? AND device_id = ?");
    $check_stmt->bind_param("is", $user_id, $device_id);
    $check_stmt->execute();
    $check_result = $check_stmt->get_result();

    if ($check_result->num_rows === 0) {
        echo json_encode(['success' => false, 'error' => 'You are not authorized to manage this device']);
        $check_stmt->close();
        $conn->close();
        return;
    }
    $check_stmt->close();

    $stmt = $conn->prepare("UPDATE devices SET device_password = ? WHERE device_id = ?");
    $stmt->bind_param("ss", $new_password, $device_id);

    if ($stmt->execute()) {
        // Unlink all OTHER users who have this device linked
        $unlink_stmt = $conn->prepare("DELETE FROM user_devices WHERE device_id = ? AND user_id != ?");
        $unlink_stmt->bind_param("si", $device_id, $user_id);
        $unlink_stmt->execute();
        $unlinked_count = $unlink_stmt->affected_rows;
        $unlink_stmt->close();

        echo json_encode([
            'success' => true,
            'message' => 'Device password updated successfully',
            'unlinked_count' => $unlinked_count
        ]);
    } else {
        echo json_encode(['success' => false, 'error' => 'Failed to update password']);
    }

    $stmt->close();
    $conn->close();
}


function vibrateDevice() {
    $conn = getConnection();
    if (!$conn) {
        echo json_encode(['success' => false, 'error' => 'Database connection failed']);
        return;
    }
    
    // FIXED: Changed from 'deviceid' to 'device_id' to match your URL
    $device_id = sanitize($conn, $_GET['device_id'] ?? '');
    $user_id = $_SESSION['user_id'];
    
    if (empty($device_id)) {
        echo json_encode(['success' => false, 'error' => 'Missing device_id']);
        $conn->close();
        return;
    }
    
    // Verify user owns this device (security check)
    $stmt = $conn->prepare("SELECT device_id FROM user_devices WHERE user_id = ? AND device_id = ?");
    $stmt->bind_param("is", $user_id, $device_id);
    $stmt->execute();
    $result = $stmt->get_result();
    
    if ($result->num_rows === 0) {
        echo json_encode(['success' => false, 'error' => 'Device not found or unauthorized']);
        $stmt->close();
        $conn->close();
        return;
    }
    
    $stmt->close();
    $conn->close();
    

    // Publish MQTT command
    $topic = "watchover/$device_id/command";
    $message = "vibrate";  // Simple string instead of JSON

    
    $command = "mosquitto_pub -h 127.0.0.1 -p 1883 -t " . escapeshellarg($topic) . " -m " . escapeshellarg($message);
    exec($command, $output, $returnCode);
    
    if ($returnCode === 0) {
        echo json_encode(['success' => true, 'message' => 'Vibration command sent']);
    } else {
        echo json_encode(['success' => false, 'error' => 'MQTT publish failed']);
    }
}

// Removes a device from the user's account
function removeDevice() {
    $conn = getConnection();
    if (!$conn) {
        echo json_encode(['success' => false, 'error' => 'Database connection failed']);
        return;
    }
    
    $user_id = $_SESSION['user_id'];
    $device_id = isset($_GET['device_id']) ? $_GET['device_id'] : '';
    
    if (empty($device_id)) {
        echo json_encode(['success' => false, 'error' => 'Missing device_id']);
        $conn->close();
        return;
    }
    
    // Delete link from user_devices where user owns the device
    $stmt = $conn->prepare("DELETE FROM user_devices WHERE user_id = ? AND device_id = ?");
    $stmt->bind_param("is", $user_id, $device_id);
    $stmt->execute();
    
    if ($stmt->affected_rows > 0) {
        echo json_encode(['success' => true, 'message' => 'Device removed successfully']);
    } else {
        echo json_encode(['success' => false, 'error' => 'Device not found or not owned by user']);
    }
    
    $stmt->close();
    $conn->close();
}

// Saves a push notification subscription for the user
function savePushSubscription() {
    $conn = getConnection();
    if (!$conn) {
        echo json_encode(['success' => false, 'error' => 'Database connection failed']);
        return;
    }
    
    $input = json_decode(file_get_contents('php://input'), true);
    $user_id = $_SESSION['user_id'];
    $endpoint = $input['endpoint'] ?? '';
    $p256dh = $input['keys']['p256dh'] ?? '';
    $auth = $input['keys']['auth'] ?? '';
    
    if (empty($endpoint) || empty($p256dh) || empty($auth)) {
        echo json_encode(['success' => false, 'error' => 'Missing subscription data']);
        $conn->close();
        return;
    }
    
    // Upsert: Insert or update on duplicate endpoint
    $stmt = $conn->prepare("
        INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) 
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), p256dh = VALUES(p256dh), auth = VALUES(auth)
    ");
    $stmt->bind_param("isss", $user_id, $endpoint, $p256dh, $auth);
    
    if ($stmt->execute()) {
        echo json_encode(['success' => true, 'message' => 'Subscription saved']);
    } else {
        echo json_encode(['success' => false, 'error' => 'Failed to save subscription']);
    }
    
    $stmt->close();
    $conn->close();
}

// Deletes push subscription (on logout or unsubscribe)
function deletePushSubscription() {
    $conn = getConnection();
    if (!$conn) {
        echo json_encode(['success' => false, 'error' => 'Database connection failed']);
        return;
    }
    
    $input = json_decode(file_get_contents('php://input'), true);
    $endpoint = $input['endpoint'] ?? '';
    
    if (empty($endpoint)) {
        echo json_encode(['success' => false, 'error' => 'Missing endpoint']);
        $conn->close();
        return;
    }
    
    $stmt = $conn->prepare("DELETE FROM push_subscriptions WHERE endpoint = ?");
    $stmt->bind_param("s", $endpoint);
    $stmt->execute();
    
    echo json_encode(['success' => true, 'message' => 'Subscription deleted']);
    
    $stmt->close();
    $conn->close();
}


// Sends push notifications to all subscribed users of a device
function sendPushNotifications($device_id, $lat, $lon, $battery = 0) {
    $conn = getConnection();
    if (!$conn) return;

    // 1. Check Geofence Status
    $geofenceAlert = "";
    $titlePrefix = "";
    $statusMsg = ""; // Will be replaced by address or simple location text
    
    $geoStmt = $conn->prepare("SELECT center_latitude, center_longitude, radius FROM geofences WHERE device_id = ?");
    $geoStmt->bind_param("s", $device_id);
    $geoStmt->execute();
    $geoResult = $geoStmt->get_result();
    
    if ($geoRow = $geoResult->fetch_assoc()) {
        $centerLat = floatval($geoRow['center_latitude']);
        $centerLng = floatval($geoRow['center_longitude']);
        $radius = floatval($geoRow['radius']);
        
        // Haversine Formula (Meters)
        $earthRadius = 6371000;
        $dLat = deg2rad($lat - $centerLat);
        $dLon = deg2rad($lon - $centerLng);
        $a = sin($dLat/2) * sin($dLat/2) +
             cos(deg2rad($centerLat)) * cos(deg2rad($lat)) * 
             sin($dLon/2) * sin($dLon/2);
        $c = 2 * atan2(sqrt($a), sqrt(1-$a));
        $distance = $earthRadius * $c;
        
        if ($distance > $radius) {
            $geofenceAlert = "!!!OUT OF SAFE ZONE!!! ";
        }
    }
    $geoStmt->close();

    // 2. Fetch Address (Reverse Geocode)
    $address = getAddressFromCoordinates($lat, $lon);
    if (!$address) {
        $address = "$lat, $lon";
    }

    // Check if GPS coordinates are invalid (0,0) and get last known address
    $hasValidGPS = (abs($lat) > 0.01 && abs($lon) > 0.01);
    $displayAddress = $address;

    if (!$hasValidGPS) {
        // GPS is invalid (0,0) - get last known address from database
        $lastKnownStmt = $conn->prepare("SELECT last_known_address FROM device_status WHERE device_id = ?");
        $lastKnownStmt->bind_param("s", $device_id);
        $lastKnownStmt->execute();
        $lastKnownResult = $lastKnownStmt->get_result();
        if ($lastKnownRow = $lastKnownResult->fetch_assoc()) {
            $lastKnownAddress = $lastKnownRow['last_known_address'] ?? "Unknown Location";
            $displayAddress = $lastKnownAddress . " (No GPS Signal)";
        } else {
            // No last known address found in database - this shouldn't happen if data is being saved correctly
            $displayAddress = "Unknown Location (No GPS Signal)";
        }
        $lastKnownStmt->close();
    }

    // Get all users linked to this device and their push subscriptions
    $stmt = $conn->prepare("
        SELECT ps.endpoint, ps.p256dh, ps.auth, d.device_name
        FROM push_subscriptions ps
        INNER JOIN user_devices ud ON ps.user_id = ud.user_id
        INNER JOIN devices d ON ud.device_id = d.device_id
        WHERE ud.device_id = ?
    ");
    $stmt->bind_param("s", $device_id);
    $stmt->execute();
    $result = $stmt->get_result();

    if ($result->num_rows === 0) {
        $stmt->close();
        $conn->close();
        return;
    }

    // Setup WebPush
    $auth = [
        'VAPID' => [
            'subject' => VAPID_SUBJECT,
            'publicKey' => VAPID_PUBLIC_KEY,
            'privateKey' => VAPID_PRIVATE_KEY
        ]
    ];

    try {
        $webPush = new WebPush($auth);

        while ($row = $result->fetch_assoc()) {
            $subscription = Subscription::create([
                'endpoint' => $row['endpoint'],
                'publicKey' => $row['p256dh'],
                'authToken' => $row['auth']
            ]);

            $deviceName = $row['device_name'] ?? 'Device';
            $notifTitle = $geofenceAlert
                ? "🚨 Out of Safezone!"
                : "🟢 " . $deviceName;
            $notifBody = $geofenceAlert
                ? "$deviceName\n📍 $displayAddress\n🔋 Battery: $battery%\n🕐 " . date('g:i A')
                : "📍 $displayAddress\n🔋 Battery: $battery%\n🕐 " . date('g:i A');
            $payload = json_encode([
                'title' => $notifTitle,
                'body' => $notifBody,
                'device_id' => $device_id,
                'url' => '/dashboard/dashboard.html'
            ]);

            $webPush->queueNotification($subscription, $payload);
        }

        // Send all queued notifications
        foreach ($webPush->flush() as $report) {
            $endpoint = $report->getRequest()->getUri()->__toString();
            if (!$report->isSuccess()) {
                // Remove invalid subscription
                if ($report->isSubscriptionExpired()) {
                     $delStmt = $conn->prepare("DELETE FROM push_subscriptions WHERE endpoint = ?");
                     $delStmt->bind_param("s", $endpoint);
                     $delStmt->execute();
                     $delStmt->close();
                }
            }
        }
    } catch (Exception $e) {
        error_log("Push notification error: " . $e->getMessage());
    }

    $stmt->close();
    $conn->close();
}
