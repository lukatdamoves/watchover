const loginBtn = document.getElementById('loginBtn');
const togglePassword = document.getElementById('togglePassword');
const passwordInput = document.getElementById('password');
const emailInput = document.getElementById('email');
const forgotPasswordLink = document.getElementById('forgotPasswordLink');
const forgotPasswordModal = document.getElementById('forgotPasswordModal');
const forgotPasswordClose = document.getElementById('forgotPasswordClose');
const forgotPasswordEmail = document.getElementById('forgotPasswordEmail');
const sendResetLinkBtn = document.getElementById('sendResetLinkBtn');
const registerModal = document.getElementById('registerModal');
const registerClose = document.getElementById('registerClose');
const createAccountBtn = document.getElementById('createAccountBtn');
const backToLogin = document.getElementById('backToLogin');
const registerBtn = document.getElementById('registerBtn');
const toggleRegisterPassword = document.getElementById('toggleRegisterPassword');
const toggleRegisterConfirmPassword = document.getElementById('toggleRegisterConfirmPassword');
const registerEmailInput = document.getElementById('registerEmail');
const registerPasswordInput = document.getElementById('registerPassword');
const registerConfirmPasswordInput = document.getElementById('registerConfirmPassword');
const verificationModal = document.getElementById('verificationModal');
const verificationOkBtn = document.getElementById('verificationOkBtn');

let csrfToken = '';

window.addEventListener('DOMContentLoaded', async function () {
    try {
        const sessionCheck = await fetch('../api.php?action=checkSession', { credentials: 'include' });
        const sessionData = await sessionCheck.json();
        if (sessionData.authenticated) {
            window.location.href = '../dashboard/dashboard.html';
            return;
        }
    } catch (error) { }

    try {
        const response = await fetch('../api.php?action=getCSRFToken', { credentials: 'include' });
        const data = await response.json();
        csrfToken = data.token;
    } catch (error) { }

    initializeLogin();
    initializeRegistrationModal();
    initializeVerificationModal();
    initializeForgotPasswordModal();
});

if (window.innerWidth <= 480) {
    const langSwitcher = document.getElementById('language-switcher');
    const guideBtn = document.getElementById('guideBtn');
    if (langSwitcher && guideBtn) {
        langSwitcher.style.position = 'static';
        langSwitcher.style.marginTop = '1rem';
        guideBtn.after(langSwitcher);
    }
}

function initializeLogin() {
    if (loginBtn) loginBtn.addEventListener('click', handleLogin);

    if (togglePassword) {
        togglePassword.addEventListener('click', function () {
            const type = passwordInput.type === 'password' ? 'text' : 'password';
            passwordInput.type = type;
            const svg = togglePassword.querySelector('svg');
            if (svg && type === 'text') {
                svg.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>`;
            } else if (svg) {
                svg.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"></path>`;
            }
        });
    }

    if (passwordInput) {
        passwordInput.addEventListener('keypress', function (e) {
            if (e.key === 'Enter') handleLogin();
        });
    }

    if (emailInput) {
        emailInput.addEventListener('keypress', function (e) {
            if (e.key === 'Enter') handleLogin();
        });
    }
}

async function handleLogin() {
    const email = emailInput?.value.trim();
    const password = passwordInput?.value.trim();

    if (!email || !password) {
        showAlert('Please enter both Email and Password');
        return;
    }

    if (loginBtn) {
        loginBtn.disabled = true;
        loginBtn.innerHTML = '<span class="btn-spinner"></span>Logging in...';
        loginBtn.style.opacity = '0.6';
    }

    try {
        const response = await fetch('../api.php?action=authenticate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken
            },
            credentials: 'include',
            body: JSON.stringify({ email, password })
        });

        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const data = await response.json();

        if (data.success) {
            showAlert('Login successful! Redirecting...', 'success');
            setTimeout(() => window.location.href = '../dashboard/dashboard.html', 500);
        } else {
            showAlert(data.error || 'Invalid Email or Password');
            resetLoginButton();
        }
    } catch (error) {
        showAlert('Login failed. Please check your connection and try again.');
        resetLoginButton();
    }
}

function resetLoginButton() {
    if (loginBtn) {
        loginBtn.disabled = false;
        loginBtn.textContent = 'Login';
        loginBtn.style.opacity = '1';
    }
}

function initializeRegistrationModal() {
    if (createAccountBtn) createAccountBtn.addEventListener('click', openRegisterModal);
    if (registerClose) registerClose.addEventListener('click', closeRegisterModal);
    if (backToLogin) backToLogin.addEventListener('click', closeRegisterModal);
    if (registerBtn) registerBtn.addEventListener('click', handleRegister);

    if (toggleRegisterPassword) {
        toggleRegisterPassword.addEventListener('click', function () {
            const type = registerPasswordInput.type === 'password' ? 'text' : 'password';
            registerPasswordInput.type = type;
            const svg = toggleRegisterPassword.querySelector('svg');
            if (svg && type === 'text') {
                svg.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>`;
            } else if (svg) {
                svg.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"></path>`;
            }
        });
    }

    if (toggleRegisterConfirmPassword) {
        toggleRegisterConfirmPassword.addEventListener('click', function () {
            const type = registerConfirmPasswordInput.type === 'password' ? 'text' : 'password';
            registerConfirmPasswordInput.type = type;
            const svg = toggleRegisterConfirmPassword.querySelector('svg');
            if (svg && type === 'text') {
                svg.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>`;
            } else if (svg) {
                svg.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"></path>`;
            }
        });
    }

    if (registerModal) {
        let mouseDownTarget = null;
        registerModal.addEventListener('mousedown', e => mouseDownTarget = e.target);
        registerModal.addEventListener('click', function (e) {
            if (e.target === registerModal && mouseDownTarget === registerModal) closeRegisterModal();
            mouseDownTarget = null;
        });
    }

    if (registerConfirmPasswordInput) {
        registerConfirmPasswordInput.addEventListener('keypress', function (e) {
            if (e.key === 'Enter') handleRegister();
        });
    }
}

function openRegisterModal() {
    if (registerModal) {
        registerModal.classList.add('active');
        document.body.style.overflow = 'hidden';
        if (registerEmailInput) registerEmailInput.value = '';
        if (registerPasswordInput) registerPasswordInput.value = '';
        if (registerConfirmPasswordInput) registerConfirmPasswordInput.value = '';
    }
}

function closeRegisterModal() {
    if (registerModal) {
        registerModal.classList.remove('active');
        document.body.style.overflow = '';
    }
}

async function handleRegister() {
    const email = registerEmailInput?.value.trim();
    const password = registerPasswordInput?.value.trim();
    const confirmPassword = registerConfirmPasswordInput?.value.trim();

    if (!email || !password || !confirmPassword) {
        showAlert('Please fill in all fields');
        return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        showAlert('Please enter a valid email address');
        return;
    }

    if (password.length < 6) {
        showAlert('Password must be at least 6 characters long');
        return;
    }

    if (password !== confirmPassword) {
        showAlert('Passwords do not match');
        return;
    }

    if (registerBtn) {
        registerBtn.disabled = true;
        registerBtn.innerHTML = '<span class="btn-spinner"></span>Creating Account...';
        registerBtn.style.opacity = '0.6';
    }

    try {
        const response = await fetch('../api.php?action=register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken
            },
            body: JSON.stringify({ email, password })
        });

        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const data = await response.json();

        if (data.success) {
            closeRegisterModal();
            resetRegisterButton();
            openVerificationModal();
        } else {
            showAlert(data.error || 'Registration failed. Please try again.');
            resetRegisterButton();
        }
    } catch (error) {
        showAlert('Registration failed. Please check your connection and try again.');
        resetRegisterButton();
    }
}

function resetRegisterButton() {
    if (registerBtn) {
        registerBtn.disabled = false;
        registerBtn.textContent = 'Create Account';
        registerBtn.style.opacity = '1';
    }
}

function initializeVerificationModal() {
    if (verificationOkBtn) verificationOkBtn.addEventListener('click', closeVerificationModal);

    if (verificationModal) {
        let mouseDownTarget = null;
        verificationModal.addEventListener('mousedown', e => mouseDownTarget = e.target);
        verificationModal.addEventListener('click', function (e) {
            if (e.target === verificationModal && mouseDownTarget === verificationModal) closeVerificationModal();
            mouseDownTarget = null;
        });
    }
}

function openVerificationModal() {
    if (verificationModal) {
        verificationModal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
}

function closeVerificationModal() {
    if (verificationModal) {
        verificationModal.classList.remove('active');
        document.body.style.overflow = '';
    }
}

function initializeForgotPasswordModal() {
    if (forgotPasswordLink) {
        forgotPasswordLink.addEventListener('click', function (e) {
            e.preventDefault();
            openForgotPasswordModal();
        });
    }

    if (forgotPasswordClose) forgotPasswordClose.addEventListener('click', closeForgotPasswordModal);
    if (sendResetLinkBtn) sendResetLinkBtn.addEventListener('click', handleForgotPassword);

    if (forgotPasswordEmail) {
        forgotPasswordEmail.addEventListener('keypress', function (e) {
            if (e.key === 'Enter') handleForgotPassword();
        });
    }

    if (forgotPasswordModal) {
        let mouseDownTarget = null;
        forgotPasswordModal.addEventListener('mousedown', e => mouseDownTarget = e.target);
        forgotPasswordModal.addEventListener('click', function (e) {
            if (e.target === forgotPasswordModal && mouseDownTarget === forgotPasswordModal) closeForgotPasswordModal();
            mouseDownTarget = null;
        });
    }
}

function openForgotPasswordModal() {
    if (forgotPasswordModal) {
        forgotPasswordModal.classList.add('active');
        document.body.style.overflow = 'hidden';
        if (forgotPasswordEmail) forgotPasswordEmail.value = '';
    }
}

function closeForgotPasswordModal() {
    if (forgotPasswordModal) {
        forgotPasswordModal.classList.remove('active');
        document.body.style.overflow = '';
    }
}

async function handleForgotPassword() {
    const email = forgotPasswordEmail?.value.trim();

    if (!email) {
        showAlert('Please enter your email address', 'error');
        return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        showAlert('Please enter a valid email address', 'error');
        return;
    }

    if (sendResetLinkBtn) {
        sendResetLinkBtn.disabled = true;
        sendResetLinkBtn.innerHTML = '<span class="btn-spinner"></span>Sending...';
        sendResetLinkBtn.style.opacity = '0.6';
    }

    try {
        const response = await fetch('../api.php?action=forgotPassword', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken
            },
            body: JSON.stringify({ email })
        });

        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const data = await response.json();

        if (data.success) {
            closeForgotPasswordModal();
            showAlert('Password reset link sent! Check your email.', 'success');
            resetForgotPasswordButton();
        } else {
            showAlert(data.error || 'Failed to send reset link. Please try again.', 'error');
            resetForgotPasswordButton();
        }
    } catch (error) {
        showAlert('Failed to send reset link. Please check your connection.', 'error');
        resetForgotPasswordButton();
    }
}

function resetForgotPasswordButton() {
    if (sendResetLinkBtn) {
        sendResetLinkBtn.disabled = false;
        sendResetLinkBtn.textContent = 'Send Reset Link';
        sendResetLinkBtn.style.opacity = '1';
    }
}
