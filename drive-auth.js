/**
 * drive-auth.js — Google Drive (drive.file scope) helper for trip document uploads.
 *
 * ONE-TIME SETUP (do this before using):
 *  1. https://console.cloud.google.com/ → select project "my-app-d7de4"
 *     (same project your Firebase Realtime Database already lives in).
 *  2. APIs & Services → Library → enable "Google Drive API".
 *  3. APIs & Services → OAuth consent screen → User type "External", "Testing" mode
 *     is fine (no Google review needed). Add your email + your wife's email as test
 *     users. Add scope: https://www.googleapis.com/auth/drive.file
 *  4. APIs & Services → Credentials → Create Credentials → OAuth client ID → Web app.
 *     Authorized JavaScript origins: https://adarshshah.github.io and http://localhost:8765
 *  5. Copy the Client ID (ends in .apps.googleusercontent.com) into DRIVE_CLIENT_ID below.
 *
 * Files uploaded through this app use the "drive.file" scope — the app can only ever
 * see files/folders IT created, never the rest of your Drive. Everything lands in a
 * private "Trip Documents" folder in the Google account that connects. If you and your
 * wife use different Google accounts, share that folder with each other's email from
 * Drive's web UI so you can both see uploads.
 *
 * Nothing here is persisted to Firebase or this repo — documents live in Google Drive
 * only. The access token is kept in memory for this tab only (never localStorage).
 */
(function () {
    'use strict';

    const DRIVE_CLIENT_ID = '441931258533-ncgn878j694rspmbdubac0esov0shoge.apps.googleusercontent.com';
    const DRIVE_SCOPE     = 'https://www.googleapis.com/auth/drive.file';
    const FOLDER_NAME     = 'Trip Documents';
    const FOLDER_CACHE_KEY = 'drive_vault_folder_id';
    const FIELDS = 'id,name,mimeType,webViewLink,iconLink,createdTime,size,appProperties';

    let accessToken = null;
    let folderId    = localStorage.getItem(FOLDER_CACHE_KEY) || null;

    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src; s.onload = resolve; s.onerror = reject;
            document.head.appendChild(s);
        });
    }

    async function ensureGis() {
        if (window.google?.accounts?.oauth2) return;
        await loadScript('https://accounts.google.com/gsi/client');
    }

    window.driveIsConnected = () => !!accessToken;

    // { silent:true } attempts a token refresh without a consent popup — only
    // succeeds if the user already granted consent earlier in this browser.
    window.driveConnect = async ({ silent = false } = {}) => {
        if (DRIVE_CLIENT_ID.startsWith('YOUR_')) {
            throw new Error('Google Drive isn\'t configured yet — paste your OAuth Client ID into drive-auth.js (DRIVE_CLIENT_ID).');
        }
        await ensureGis();
        return new Promise((resolve, reject) => {
            const tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: DRIVE_CLIENT_ID,
                scope: DRIVE_SCOPE,
                callback: (resp) => {
                    if (resp.error) { reject(new Error(resp.error)); return; }
                    accessToken = resp.access_token;
                    resolve(accessToken);
                },
                error_callback: (err) => reject(new Error(err?.type || 'Drive connection failed')),
            });
            tokenClient.requestAccessToken({ prompt: silent ? '' : 'consent' });
        });
    };

    async function apiFetch(url, opts = {}, _retried = false) {
        const res = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${accessToken}`, ...(opts.headers || {}) } });
        if (res.status === 401 && !_retried) {
            await window.driveConnect({ silent: true }).catch(() => {});
            return apiFetch(url, opts, true);
        }
        if (!res.ok) throw new Error(`Drive API error ${res.status}`);
        return res;
    }

    async function ensureFolder() {
        if (folderId) return folderId;
        const q = `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
        const listRes  = await apiFetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`);
        const listData = await listRes.json();
        if (listData.files?.length) {
            folderId = listData.files[0].id;
        } else {
            const createRes = await apiFetch('https://www.googleapis.com/drive/v3/files?fields=id', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' })
            });
            folderId = (await createRes.json()).id;
        }
        localStorage.setItem(FOLDER_CACHE_KEY, folderId);
        return folderId;
    }
    window.driveEnsureFolder = ensureFolder;

    window.driveListFiles = async (filter = {}) => {
        const fid = await ensureFolder();
        let q = `'${fid}' in parents and trashed=false`;
        if (filter.trip)          q += ` and appProperties has { key='trip' and value='${filter.trip}' }`;
        if (filter.category)      q += ` and appProperties has { key='category' and value='${filter.category}' }`;
        if (filter.linkedEventId) q += ` and appProperties has { key='linkedEventId' and value='${filter.linkedEventId}' }`;
        const params = new URLSearchParams({ q, fields: `files(${FIELDS})`, orderBy: 'createdTime desc', pageSize: '200' });
        const res = await apiFetch(`https://www.googleapis.com/drive/v3/files?${params}`);
        return (await res.json()).files || [];
    };

    window.driveUploadFile = async (file, meta = {}) => {
        const fid = await ensureFolder();
        const boundary = 'vault' + Math.random().toString(36).slice(2);
        const metadata = {
            name: file.name,
            parents: [fid],
            appProperties: {
                trip:             meta.trip             || 'general',
                category:         meta.category         || 'Other',
                linkedEventId:    meta.linkedEventId    || '',
                linkedEventTitle: meta.linkedEventTitle || ''
            }
        };
        const head = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${file.type || 'application/octet-stream'}\r\n\r\n`]);
        const tail = new Blob([`\r\n--${boundary}--`]);
        const body = new Blob([head, file, tail]);
        const res = await apiFetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=${FIELDS}`, {
            method: 'POST',
            headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
            body
        });
        return res.json();
    };

    window.driveLinkFile = async (fileId, fields = {}) => {
        const appProperties = {};
        if (fields.linkedEventId    !== undefined) appProperties.linkedEventId    = fields.linkedEventId;
        if (fields.linkedEventTitle !== undefined) appProperties.linkedEventTitle = fields.linkedEventTitle;
        if (fields.trip             !== undefined) appProperties.trip            = fields.trip;
        if (fields.category         !== undefined) appProperties.category        = fields.category;
        const res = await apiFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=${FIELDS}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ appProperties })
        });
        return res.json();
    };

    window.driveUnlinkFile = (fileId) => window.driveLinkFile(fileId, { linkedEventId: '', linkedEventTitle: '' });

    window.driveDeleteFile = async (fileId) => {
        await apiFetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, { method: 'DELETE' });
    };

    window.driveFormatSize = (bytes) => {
        bytes = Number(bytes || 0);
        if (!bytes) return '';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / 1048576).toFixed(1)} MB`;
    };
})();
