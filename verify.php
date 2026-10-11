<?php
// Get token from URL
$token = $_GET['token'] ?? '';

// Shared styles for all verify pages
function getPageStyles() {
    return '
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            background: #141414;
            color: #e0e0e0;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            min-height: 100dvh;
            padding: 1rem;
        }
        .card {
            text-align: center;
            background: #1e1e1e;
            border: 1px solid #2a2a2a;
            padding: 2.5rem 2rem;
            border-radius: 1.25rem;
            max-width: 24rem;
            width: 100%;
            box-shadow: 0 24px 80px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.03);
        }
        .icon {
            width: 4.5rem;
            height: 4.5rem;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 1.5rem;
            font-size: 2rem;
        }
        .icon.success { background: rgba(0, 255, 38, 0.08); border: 1px solid rgba(0, 255, 38, 0.15); }
        .icon.error { background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.15); }
        .icon.warning { background: rgba(255, 193, 7, 0.08); border: 1px solid rgba(255, 193, 7, 0.15); }
        .icon svg { width: 2rem; height: 2rem; }
        h1 {
            font-size: 1.35rem;
            font-weight: 700;
            margin-bottom: 0.5rem;
            letter-spacing: -0.01em;
        }
        h1.success-text { color: #00ff26; }
        h1.error-text { color: #ef4444; }
        h1.warning-text { color: #ffc107; }
        .desc {
            color: #888;
            font-size: 0.85rem;
            line-height: 1.6;
            margin-bottom: 1.75rem;
        }
        .btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
            color: #111;
            background: #00ff26;
            border: none;
            padding: 0.75rem 1.75rem;
            border-radius: 0.625rem;
            font-size: 0.9rem;
            font-weight: 600;
            cursor: pointer;
            text-decoration: none;
            transition: all 0.2s ease;
            width: 100%;
        }
        .btn:hover { background: #00e622; transform: translateY(-1px); box-shadow: 0 4px 16px rgba(0, 255, 38, 0.2); }
        .btn:active { transform: translateY(0); }
        .btn-outline {
            background: transparent;
            color: #ccc;
            border: 1px solid #3a3a3a;
        }
        .btn-outline:hover { background: rgba(255, 255, 255, 0.04); border-color: #555; box-shadow: none; color: #fff; }
        .input-group { margin-bottom: 1rem; text-align: left; }
        .input-group label {
            display: block;
            margin-bottom: 0.4rem;
            color: #aaa;
            font-size: 0.8rem;
            font-weight: 500;
        }
        .input-group input {
            width: 100%;
            padding: 0.7rem 0.85rem;
            border: 1px solid #333;
            border-radius: 0.5rem;
            background: #262626;
            color: #e0e0e0;
            font-size: 0.95rem;
            outline: none;
            transition: all 0.2s;
        }
        .input-group input:focus { border-color: #00ff26; box-shadow: 0 0 0 3px rgba(0, 255, 38, 0.08); }
        .message {
            padding: 0.7rem 0.85rem;
            border-radius: 0.5rem;
            margin-bottom: 1rem;
            display: none;
            font-size: 0.82rem;
            font-weight: 500;
            text-align: left;
        }
        .msg-success { background: rgba(0, 255, 38, 0.06); border: 1px solid rgba(0, 255, 38, 0.15); color: #00ff26; }
        .msg-error { background: rgba(239, 68, 68, 0.06); border: 1px solid rgba(239, 68, 68, 0.15); color: #ef4444; }
        form { margin-top: 1.5rem; }
        .btn + .btn { margin-top: 0.5rem; }
        .divider { height: 1px; background: #2a2a2a; margin: 1.25rem 0; }
    ';
}

if (!$token) {
    echo '<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Invalid Link - WatchOver</title>
    <link rel="icon" type="image/x-icon" href="/favicon_icons/favicon.ico">
    <style>' . getPageStyles() . '</style>
</head>
<body>
    <div class="card">
        <div class="icon error">
            <svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="15" y1="9" x2="9" y2="15"></line>
                <line x1="9" y1="9" x2="15" y2="15"></line>
            </svg>
        </div>
        <h1 class="error-text">Invalid Link</h1>
        <p class="desc">This link is invalid or missing required parameters. Please check the URL and try again.</p>
        <a href="https://watchover.tech/login/login.html" class="btn">Go to Login</a>
    </div>
</body>
</html>';
    exit;
}

// Check if this is a password reset or email verification
$action = $_GET['action'] ?? 'verify';

if ($action === 'reset') {
    // Password Reset Flow
    ?>
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Reset Password - WatchOver</title>
        <link rel="icon" type="image/x-icon" href="/favicon_icons/favicon.ico">
        <style><?php echo getPageStyles(); ?></style>
    </head>
    <body>
        <div class="card">
            <div class="icon warning">
                <svg viewBox="0 0 24 24" fill="none" stroke="#ffc107" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                </svg>
            </div>
            <h1 class="warning-text">Reset Password</h1>
            <p class="desc">Enter a new password for your WatchOver account.</p>
            
            <div id="message" class="message"></div>
            
            <form id="resetForm">
                <div class="input-group">
                    <label>New Password</label>
                    <input type="password" id="newPassword" placeholder="Min 6 characters" required>
                </div>
                
                <div class="input-group">
                    <label>Confirm Password</label>
                    <input type="password" id="confirmPassword" placeholder="Re-enter password" required>
                </div>
                
                <button type="submit" id="resetBtn" class="btn">Reset Password</button>
            </form>
        </div>

        <script>
            const form = document.getElementById('resetForm');
            const resetBtn = document.getElementById('resetBtn');
            const message = document.getElementById('message');
            const token = '<?php echo htmlspecialchars($token); ?>';

            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                
                const newPassword = document.getElementById('newPassword').value;
                const confirmPassword = document.getElementById('confirmPassword').value;

                if (newPassword.length < 6) {
                    showMessage('Password must be at least 6 characters.', 'error');
                    return;
                }

                if (newPassword !== confirmPassword) {
                    showMessage('Passwords do not match.', 'error');
                    return;
                }

                resetBtn.disabled = true;
                resetBtn.textContent = 'Resetting...';

                try {
                    const response = await fetch('https://watchover.tech/api.php?action=resetPassword', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ token: token, new_password: newPassword })
                    });

                    const data = await response.json();

                    if (data.success) {
                        showMessage('Password reset successful! Redirecting...', 'success');
                        setTimeout(() => {
                            window.location.href = 'https://watchover.tech/login/login.html';
                        }, 2000);
                    } else {
                        showMessage(data.error || 'Failed to reset password. Please try again.', 'error');
                        resetBtn.disabled = false;
                        resetBtn.textContent = 'Reset Password';
                    }
                } catch (error) {
                    showMessage('Connection error. Please try again.', 'error');
                    resetBtn.disabled = false;
                    resetBtn.textContent = 'Reset Password';
                }
            });

            function showMessage(text, type) {
                message.textContent = text;
                message.className = 'message msg-' + type;
                message.style.display = 'block';
            }
        </script>
    </body>
    </html>
    <?php
    exit;
}

// Email Verification Flow (original)
$api_url = 'https://watchover.tech/api.php?action=verify&token=' . urlencode($token);

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $api_url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 10);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);

$response = curl_exec($ch);
$http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

$styles = getPageStyles();

if ($http_code != 200 || !$response) {
    echo '<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Server Error - WatchOver</title>
    <link rel="icon" type="image/x-icon" href="/favicon_icons/favicon.ico">
    <style>' . $styles . '</style>
</head>
<body>
    <div class="card">
        <div class="icon error">
            <svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
        </div>
        <h1 class="error-text">Server Unreachable</h1>
        <p class="desc">We couldn\'t reach the server right now. Please try again in a few moments.</p>
        <a href="https://watchover.tech/login/login.html" class="btn">Go to Login</a>
    </div>
</body>
</html>';
    exit;
}

$data = json_decode($response, true);

if ($data && $data['success']) {
    echo '<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Email Verified - WatchOver</title>
    <link rel="icon" type="image/x-icon" href="/favicon_icons/favicon.ico">
    <style>' . $styles . '</style>
</head>
<body>
    <div class="card">
        <div class="icon success">
            <svg viewBox="0 0 24 24" fill="none" stroke="#00ff26" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                <polyline points="22 4 12 14.01 9 11.01"></polyline>
            </svg>
        </div>
        <h1 class="success-text">Email Verified!</h1>
        <p class="desc">Your account is now active. You can log in and start tracking your devices.</p>
        <a href="https://watchover.tech/login/login.html" class="btn">Go to Login</a>
    </div>
</body>
</html>';
} else {
    echo '<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Verification Failed - WatchOver</title>
    <link rel="icon" type="image/x-icon" href="/favicon_icons/favicon.ico">
    <style>' . $styles . '</style>
</head>
<body>
    <div class="card">
        <div class="icon error">
            <svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="15" y1="9" x2="9" y2="15"></line>
                <line x1="9" y1="9" x2="15" y2="15"></line>
            </svg>
        </div>
        <h1 class="error-text">Verification Failed</h1>
        <p class="desc">' . htmlspecialchars($data['error'] ?? 'This verification link is invalid or has expired.') . '</p>
        <a href="https://watchover.tech/login/login.html" class="btn">Go to Login</a>
    </div>
</body>
</html>';
}
?>
