<?php
/**
 * Push Notification VAPID Configuration
 * 
 * VAPID keys for Web Push authentication.
 * Generated using: https://web-push-codelab.glitch.me/
 * 
 * IMPORTANT: Keep the private key secret! Never expose it in client-side code.
 */

// VAPID keys for push notification authentication
define('VAPID_SUBJECT', $_ENV['VAPID_SUBJECT'] ?? 'mailto:admin@watchover.jumpingcrab.com');

// VAPID Key Pair (P-256 curve)
// To generate new keys, visit: https://web-push-codelab.glitch.me/
// Or run on Linux: npx web-push generate-vapid-keys
define('VAPID_PUBLIC_KEY', $_ENV['VAPID_PUBLIC_KEY'] ?? '');
define('VAPID_PRIVATE_KEY', $_ENV['VAPID_PRIVATE_KEY'] ?? '');
