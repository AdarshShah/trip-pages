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
    @keyframes authDriftOrb {
        0%   { transform: translate(0,0) scale(1); }
        33%  { transform: translate(var(--dx1,40px),var(--dy1,-30px)) scale(1.08); }
        66%  { transform: translate(var(--dx2,-20px),var(--dy2,20px)) scale(0.94); }
        100% { transform: translate(var(--dx3,30px),var(--dy3,10px)) scale(1.04); }
    }
    @keyframes authFadeUp {
        from { opacity: 0; transform: translateY(22px); }
        to   { opacity: 1; transform: translateY(0); }
    }
    #auth-overlay {
        position: fixed; inset: 0; z-index: 9999; overflow: hidden;
        background:
            radial-gradient(ellipse 80% 60% at 20% 10%, rgba(16,32,24,0.9) 0%, transparent 70%),
            radial-gradient(ellipse 60% 50% at 80% 80%, rgba(10,18,32,0.8) 0%, transparent 65%),
            linear-gradient(160deg, #090c10 0%, #0c1118 40%, #0a0e0c 100%);
        display: flex; align-items: center; justify-content: center;
        font-family: 'DM Sans', system-ui, -apple-system, sans-serif;
    }
    .auth-orb {
        position: absolute; border-radius: 50%; filter: blur(90px); pointer-events: none;
        animation: authDriftOrb var(--dur,18s) ease-in-out infinite alternate;
        opacity: var(--op,0.18);
    }
    .auth-grain {
        position: absolute; inset: 0; pointer-events: none; z-index: 0;
        opacity: 0.032;
        background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
        background-size: 128px 128px;
    }
    #auth-card {
        position: relative; z-index: 1;
        background: rgba(255,255,255,0.045);
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 28px;
        padding: 48px 40px 44px;
        text-align: center;
        max-width: 380px; width: calc(100% - 48px);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        animation: authFadeUp 0.7s ease 0.1s both;
    }
    #auth-eyebrow {
        font-size: 10px; font-weight: 600;
        letter-spacing: 0.22em; text-transform: uppercase;
        color: rgba(240,237,232,0.25);
        margin-bottom: 10px;
    }
    #auth-title {
        font-family: 'Cormorant Garamond', Georgia, serif;
        font-size: 54px; font-weight: 600;
        color: #f0ede8;
        letter-spacing: -0.02em; line-height: 0.92;
        margin: 0 0 16px;
    }
    #auth-title em { font-style: italic; font-weight: 400; }
    #auth-subtitle {
        color: rgba(240,237,232,0.45);
        font-size: 13px; font-weight: 400;
        margin: 0 0 36px; line-height: 1.65;
        letter-spacing: 0.01em;
    }
    #auth-google-btn {
        display: flex; align-items: center; justify-content: center; gap: 10px;
        background: rgba(255,255,255,0.07);
        color: #f0ede8;
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 14px;
        padding: 14px 22px; font-size: 14px; font-weight: 500;
        cursor: pointer; width: 100%;
        font-family: 'DM Sans', system-ui, sans-serif;
        letter-spacing: 0.01em;
        backdrop-filter: blur(10px);
        transition: background 0.22s ease, border-color 0.22s ease,
                    transform 0.22s cubic-bezier(.34,1.3,.64,1), box-shadow 0.22s ease;
    }
    #auth-google-btn:hover:not(:disabled) {
        background: rgba(255,255,255,0.12);
        border-color: rgba(255,255,255,0.22);
        transform: translateY(-3px);
        box-shadow: 0 16px 36px rgba(0,0,0,0.32);
    }
    #auth-google-btn:active:not(:disabled) { transform: translateY(-1px) scale(0.98); }
    #auth-google-btn:disabled { opacity: .4; cursor: not-allowed; }
    #auth-google-btn svg { width: 18px; height: 18px; flex-shrink: 0; }
    #auth-error-msg {
        color: rgba(248,113,113,0.85); font-size: 12px; font-weight: 400;
        margin-top: 16px; min-height: 16px; line-height: 1.5;
    }
    #auth-loading-txt {
        color: rgba(240,237,232,0.3); font-size: 12px;
        margin-top: 14px; display: none;
        letter-spacing: 0.04em; text-transform: uppercase;
    }
    #auth-user-badge {
        position: fixed; bottom: 14px; right: 14px; z-index: 8888;
        background: rgba(255,255,255,0.045);
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 999px;
        padding: 5px 14px 5px 5px;
        display: flex; align-items: center; gap: 8px;
        font-family: 'DM Sans', system-ui, sans-serif;
        font-size: 12px; color: rgba(240,237,232,0.55);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
    }
    #auth-user-badge img {
        width: 24px; height: 24px; border-radius: 50%; object-fit: cover;
    }
    #auth-user-badge .avatar-fallback {
        width: 24px; height: 24px; border-radius: 50%;
        background: rgba(255,255,255,0.1);
        display: flex; align-items: center; justify-content: center;
        font-size: 12px;
    }
    #auth-signout-btn {
        background: none; border: none; cursor: pointer;
        color: rgba(240,237,232,0.28); font-size: 11px;
        padding: 0 0 0 2px; text-decoration: underline;
        font-family: inherit; letter-spacing: 0.01em;
        transition: color 0.2s ease;
    }
    #auth-signout-btn:hover { color: rgba(248,113,113,0.75); }
    `;

    // ── DOM helpers ────────────────────────────────────────────────────────────
    function injectStyles() {
        if (!document.querySelector('link[data-auth-fonts]')) {
            const f = document.createElement('link');
            f.rel = 'stylesheet';
            f.dataset.authFonts = '1';
            f.href = 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600&family=DM+Sans:wght@400;500;600&display=swap';
            document.head.appendChild(f);
        }
        const s = document.createElement('style');
        s.textContent = STYLES;
        document.head.appendChild(s);
    }

    function injectOverlay() {
        document.getElementById('auth-overlay')?.remove();
        const overlay = document.createElement('div');
        overlay.id = 'auth-overlay';
        overlay.innerHTML = `
            <div class="auth-orb" style="width:520px;height:520px;top:-160px;left:-200px;background:radial-gradient(circle,#1a4731,transparent);--dur:22s;--op:0.2;--dx1:60px;--dy1:-40px;--dx2:-30px;--dy2:50px;--dx3:45px;--dy3:-20px;"></div>
            <div class="auth-orb" style="width:420px;height:420px;bottom:-120px;right:-160px;background:radial-gradient(circle,#0a2540,transparent);--dur:26s;--op:0.16;--dx1:-50px;--dy1:30px;--dx2:40px;--dy2:-60px;--dx3:-25px;--dy3:45px;"></div>
            <div class="auth-grain"></div>
            <div id="auth-card">
                <p id="auth-eyebrow">Personal Hub</p>
                <h1 id="auth-title">Welcome <em>Back</em></h1>
                <p id="auth-subtitle">Sign in with your Google account<br>to continue.</p>
                <button id="auth-google-btn" onclick="window._authSignIn()">
                    <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
                        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.36-8.16 2.36-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                    </svg>
                    Continue with Google
                </button>
                <div id="auth-error-msg"></div>
                <div id="auth-loading-txt">Verifying…</div>
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
                <p id="auth-eyebrow">Configuration</p>
                <h1 id="auth-title">Setup <em>Required</em></h1>
                <p id="auth-subtitle">Open <code style="color:rgba(240,237,232,0.7);font-family:monospace">auth.js</code> and paste your Firebase Web API Key into <code style="color:rgba(240,237,232,0.7);font-family:monospace">FIREBASE_API_KEY</code>.</p>`;
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
