/**
 * auth.js — Firebase Google Sign-In gate for trip pages.
 *
 * ONE-TIME SETUP (do this before using):
 *  1. Firebase Console → Project Settings → General → Your apps → Web app
 *     Copy the "apiKey" value and paste it into FIREBASE_API_KEY below.
 *  2. Firebase Console → Authentication → Sign-in method → Enable "Google"
 *  3. Firebase Console → Authentication → Settings → Authorized domains
 *     Add any domains/hosts you serve these pages from (localhost is pre-added).
 *  4. Firebase Console → Realtime Database → Rules → paste:
 *       { "rules": { ".read": "auth != null", ".write": "auth != null" } }
 *     and click Publish.
 *  5. Add any extra allowed email addresses to ALLOWED_EMAILS below.
 */
(function () {
    'use strict';

    // ── CONFIG ─────────────────────────────────────────────────────────────────
    const FIREBASE_API_KEY     = 'AIzaSyD2Yrp95L7ZmUnfz-7v2-SD39SpK7p_YdA';   // ← paste your key here
    const FIREBASE_AUTH_DOMAIN = 'my-app-d7de4.firebaseapp.com';
    const FIREBASE_PROJECT_ID  = 'my-app-d7de4';
    const FIREBASE_DB_URL      = 'https://my-app-d7de4-default-rtdb.asia-southeast1.firebasedatabase.app';

    // ───────────────────────────────────────────────────────────────────────────

    // authReady resolves once a valid user is confirmed — apps await this before hitting Firebase.
    let authReadyResolve;
    window.authReady = new Promise(res => { authReadyResolve = res; });

    let currentUser = null;

    // Patch fetch: silently append ?auth=<idToken> to every Firebase DB request.
    const _origFetch = window.fetch.bind(window);
    window.fetch = async function (url, opts) {
        if (typeof url === 'string' && url.includes('firebasedatabase.app') && currentUser) {
            try {
                const token = await currentUser.getIdToken(false);
                const sep = url.includes('?') ? '&' : '?';
                url = url + sep + 'auth=' + token;
            } catch (_) { /* token fetch failed; Firebase rule will reject the request */ }
        }
        return _origFetch(url, opts);
    };

    // ── Styles ─────────────────────────────────────────────────────────────────
    const STYLES = `
    #auth-overlay {
        position: fixed; inset: 0; z-index: 9999;
        background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 55%, #0f172a 100%);
        display: flex; align-items: center; justify-content: center;
        font-family: 'Inter', system-ui, -apple-system, sans-serif;
    }
    #auth-card {
        background: rgba(255,255,255,.07);
        border: 1px solid rgba(255,255,255,.13);
        border-radius: 20px;
        padding: 48px 40px;
        text-align: center;
        max-width: 360px; width: 90%;
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
    }
    #auth-icon { font-size: 48px; margin-bottom: 16px; }
    #auth-title {
        color: #fff; font-size: 22px; font-weight: 700;
        margin: 0 0 8px; letter-spacing: -.3px;
    }
    #auth-subtitle {
        color: rgba(255,255,255,.5); font-size: 14px;
        margin: 0 0 32px; line-height: 1.5;
    }
    #auth-google-btn {
        display: flex; align-items: center; justify-content: center; gap: 10px;
        background: #fff; color: #1f2937;
        border: none; border-radius: 12px;
        padding: 13px 20px; font-size: 15px; font-weight: 600;
        cursor: pointer; width: 100%;
        box-shadow: 0 2px 10px rgba(0,0,0,.35);
        transition: background .15s, box-shadow .15s, transform .1s;
    }
    #auth-google-btn:hover:not(:disabled) {
        background: #f9fafb;
        box-shadow: 0 4px 18px rgba(0,0,0,.45);
        transform: translateY(-1px);
    }
    #auth-google-btn:active:not(:disabled) { transform: translateY(0); }
    #auth-google-btn:disabled { opacity: .6; cursor: not-allowed; }
    #auth-google-btn svg { width: 20px; height: 20px; flex-shrink: 0; }
    #auth-error-msg {
        color: #f87171; font-size: 13px;
        margin-top: 18px; min-height: 18px; line-height: 1.4;
    }
    #auth-loading-txt {
        color: rgba(255,255,255,.5); font-size: 13px;
        margin-top: 14px; display: none;
    }
    #auth-user-badge {
        position: fixed; bottom: 14px; right: 14px; z-index: 8888;
        background: rgba(0,0,0,.55);
        border: 1px solid rgba(255,255,255,.12);
        border-radius: 999px;
        padding: 5px 12px 5px 5px;
        display: flex; align-items: center; gap: 8px;
        font-family: 'Inter', system-ui, sans-serif;
        font-size: 12px; color: rgba(255,255,255,.75);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
    }
    #auth-user-badge img {
        width: 22px; height: 22px; border-radius: 50%; object-fit: cover;
    }
    #auth-user-badge .avatar-fallback {
        width: 22px; height: 22px; border-radius: 50%;
        background: rgba(255,255,255,.2);
        display: flex; align-items: center; justify-content: center;
        font-size: 11px;
    }
    #auth-signout-btn {
        background: none; border: none; cursor: pointer;
        color: rgba(255,255,255,.45); font-size: 11px;
        padding: 0 0 0 2px; text-decoration: underline;
        font-family: inherit;
    }
    #auth-signout-btn:hover { color: #f87171; }
    `;

    // ── DOM helpers ────────────────────────────────────────────────────────────
    function injectStyles() {
        const s = document.createElement('style');
        s.textContent = STYLES;
        document.head.appendChild(s);
    }

    function injectOverlay() {
        document.getElementById('auth-overlay')?.remove();
        const overlay = document.createElement('div');
        overlay.id = 'auth-overlay';
        overlay.innerHTML = `
            <div id="auth-card">
                <div id="auth-icon">🔐</div>
                <h1 id="auth-title">Admin Access Only</h1>
                <p id="auth-subtitle">Sign in with an authorised Google account<br>to access this app.</p>
                <button id="auth-google-btn" onclick="window._authSignIn()">
                    <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
                        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.36-8.16 2.36-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                    </svg>
                    Sign in with Google
                </button>
                <div id="auth-error-msg"></div>
                <div id="auth-loading-txt">Verifying access…</div>
            </div>`;
        document.body.appendChild(overlay);
    }

    function showError(msg) {
        const err = document.getElementById('auth-error-msg');
        if (err) err.textContent = msg;
        const loading = document.getElementById('auth-loading-txt');
        if (loading) loading.style.display = 'none';
        const btn = document.getElementById('auth-google-btn');
        if (btn) btn.disabled = false;
    }

    function showVerifying() {
        const loading = document.getElementById('auth-loading-txt');
        if (loading) loading.style.display = 'block';
        const btn = document.getElementById('auth-google-btn');
        if (btn) btn.disabled = true;
    }

    function removeOverlay(user) {
        const overlay = document.getElementById('auth-overlay');
        if (overlay) {
            overlay.style.transition = 'opacity .3s';
            overlay.style.opacity = '0';
            setTimeout(() => overlay.remove(), 320);
        }
        injectUserBadge(user);
    }

    function injectUserBadge(user) {
        document.getElementById('auth-user-badge')?.remove();
        const badge = document.createElement('div');
        badge.id = 'auth-user-badge';
        const avatar = user.photoURL
            ? `<img src="${user.photoURL}" alt="" referrerpolicy="no-referrer">`
            : `<span class="avatar-fallback">👤</span>`;
        badge.innerHTML = `
            ${avatar}
            <span>${user.displayName || user.email}</span>
            <button id="auth-signout-btn" onclick="window.authSignOut()">sign out</button>`;
        document.body.appendChild(badge);
    }

    // ── Firebase SDK dynamic loader ────────────────────────────────────────────
    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src; s.onload = resolve; s.onerror = reject;
            document.head.appendChild(s);
        });
    }

    // ── Firebase Auth init ─────────────────────────────────────────────────────
    async function initFirebaseAuth() {
        if (FIREBASE_API_KEY === 'YOUR_FIREBASE_WEB_API_KEY') {
            const card = document.getElementById('auth-card');
            if (card) card.innerHTML = `
                <div id="auth-icon">⚙️</div>
                <h1 id="auth-title" style="color:#fbbf24">Setup Required</h1>
                <p id="auth-subtitle">Open <code style="color:#a5f3fc">auth.js</code> and paste your Firebase Web API Key into <code style="color:#a5f3fc">FIREBASE_API_KEY</code>.</p>`;
            return;
        }

        try {
            await loadScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
            await loadScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js');
        } catch (e) {
            showError('Failed to load auth library. Check your connection.');
            return;
        }

        firebase.initializeApp({
            apiKey: FIREBASE_API_KEY,
            authDomain: FIREBASE_AUTH_DOMAIN,
            projectId: FIREBASE_PROJECT_ID,
            databaseURL: FIREBASE_DB_URL,
        });

        const auth = firebase.auth();

        auth.onAuthStateChanged(async (user) => {
            if (!user) {
                // No session — ensure sign-in button is enabled.
                const btn = document.getElementById('auth-google-btn');
                if (btn) btn.disabled = false;
                const loading = document.getElementById('auth-loading-txt');
                if (loading) loading.style.display = 'none';
                return;
            }
            showVerifying();
            currentUser = user;
            removeOverlay(user);
            authReadyResolve();
        });

        window._authSignIn = async () => {
            const btn = document.getElementById('auth-google-btn');
            if (btn) btn.disabled = true;
            const err = document.getElementById('auth-error-msg');
            if (err) err.textContent = '';
            try {
                const provider = new firebase.auth.GoogleAuthProvider();
                await auth.signInWithPopup(provider);
            } catch (e) {
                console.error('[auth] sign-in error:', e.code, e.message);
                showError(e.code ? `${e.code}: ${e.message}` : 'Sign-in failed. Check the browser console for details.');
            }
        };

        window.authSignOut = async () => {
            await auth.signOut();
            currentUser = null;
            document.getElementById('auth-user-badge')?.remove();
            // Reset authReady so apps re-block on re-sign-in.
            window.authReady = new Promise(res => { authReadyResolve = res; });
            injectOverlay();
        };
    }

    // ── Bootstrap ──────────────────────────────────────────────────────────────
    function bootstrap() {
        injectStyles();
        injectOverlay();
        initFirebaseAuth();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootstrap);
    } else {
        bootstrap();
    }
})();
