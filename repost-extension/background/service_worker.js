// ─── Background Service Worker — Firebase REST API (no SDK) ──────────────────
// Uses Firestore REST API + chrome.identity for Google auth.
// No importScripts, no ESM imports — works in any MV3 service worker.

// ─── PASTE YOUR FIREBASE CONFIG HERE ─────────────────────────────────────────
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAbRa-bu1ACbZY9v-Zg7PPFy9ahWlFvRWQ",
  authDomain: "reposter-38038.firebaseapp.com",
  projectId: "reposter-38038",
  storageBucket: "reposter-38038.firebasestorage.app",
  messagingSenderId: "561936569640",
  appId: "1:561936569640:web:0c7f3f121ff40b581d2c1d",
};
// ─────────────────────────────────────────────────────────────────────────────

const PROJECT_ID = FIREBASE_CONFIG.projectId;

// Startup check
if (PROJECT_ID === 'YOUR_PROJECT_ID') {
  console.error('[Repost SW] ERROR: Firebase config not set! Open background/service_worker.js and fill in your FIREBASE_CONFIG.');
}
const API_KEY    = FIREBASE_CONFIG.apiKey;
const FS_BASE    = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// ── State — persisted to chrome.storage.local to survive SW restarts ───────────
let currentUser  = null;
let tokenExpiry  = 0;

// Restore session on SW startup
chrome.storage.local.get(['repost_user', 'repost_token', 'repost_expiry', 'repost_refresh'], (data) => {
  if (data.repost_user && data.repost_token) {
    currentUser = data.repost_user;
    currentUser.idToken = data.repost_token;
    currentUser.refreshToken = data.repost_refresh || '';
    tokenExpiry = data.repost_expiry || 0;
  }
});

function persistUser() {
  if (!currentUser) {
    chrome.storage.local.remove(['repost_user', 'repost_token', 'repost_expiry', 'repost_refresh']);
    return;
  }
  chrome.storage.local.set({
    repost_user: { uid: currentUser.uid, displayName: currentUser.displayName, photoURL: currentUser.photoURL, email: currentUser.email },
    repost_token: currentUser.idToken,
    repost_refresh: currentUser.refreshToken,
    repost_expiry: tokenExpiry
  });
}

// ── Message Router ─────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg)
    .then(sendResponse)
    .catch(err => sendResponse({ error: err.message }));
  return true;
});

async function handleMessage(msg) {
  switch (msg.type) {

    case 'SIGN_IN':
      return signInWithGoogle();

    case 'SIGN_OUT':
      currentUser = null;
      tokenExpiry = 0;
      persistUser();
      return { success: true };

    case 'GET_CURRENT_USER': {
      // If memory is empty, try restoring from storage (SW may have been restarted)
      if (!currentUser) {
        const stored = await new Promise(r => chrome.storage.local.get(['repost_user', 'repost_token', 'repost_expiry', 'repost_refresh'], r));
        if (stored.repost_user && stored.repost_token) {
          currentUser = stored.repost_user;
          currentUser.idToken = stored.repost_token;
          currentUser.refreshToken = stored.repost_refresh || '';
          tokenExpiry = stored.repost_expiry || 0;
        }
      }
      if (!currentUser) return { user: null };
      return { user: { uid: currentUser.uid, displayName: currentUser.displayName, photoURL: currentUser.photoURL, email: currentUser.email } };
    }

    case 'GET_USER_PROFILE': {
      const token = await getToken();
      const data = await fsGet(`users/${msg.uid}`, token);
      return { profile: data ? fsToObj(data.fields) : null };
    }

    case 'SEARCH_USERS': {
      const token = await getToken();
      const results = await fsQuery('users', 'displayNameLower', msg.query.toLowerCase(), token);
      return { users: results };
    }

    case 'SEND_FOLLOW_REQUEST': {
      if (!currentUser) throw new Error('Not signed in');
      const token = await getToken();
      const profile = await fsGetObj(`users/${msg.targetUid}`, token);
      const requests = profile?.followRequests || [];
      // Avoid duplicate
      if (!requests.find(r => r.uid === currentUser.uid)) {
        requests.push({ uid: currentUser.uid, displayName: currentUser.displayName, photoURL: currentUser.photoURL, timestamp: Date.now() });
        await fsPatch(`users/${msg.targetUid}`, { followRequests: requests }, token);
      }
      return { success: true };
    }

    case 'ACCEPT_FOLLOW_REQUEST': {
      if (!currentUser) throw new Error('Not signed in');
      const token = await getToken();

      // Step 1: Update MY doc (accepter = currentUser = Account A)
      // Remove requester from followRequests, add to my followers
      const myRaw = await fsGet(`users/${currentUser.uid}`, token);
      if (!myRaw) throw new Error('My profile not found');
      const myDoc = fsToObj(myRaw.fields);
      myDoc.followRequests = (myDoc.followRequests || []).filter(r => r.uid !== msg.requesterUid);
      myDoc.followers = [...new Set([...(myDoc.followers || []), msg.requesterUid])];
      const write1 = await fsWrite(`users/${currentUser.uid}`, myDoc, token);
      if (write1.error) throw new Error('Failed to update my profile: ' + write1.error.message);

      // Step 2: Update THEIR doc (requester = Account B) — add ME to their following
      // Use a fresh token in case it expired between the two writes
      const freshToken = await getToken();
      const theirRaw = await fsGet(`users/${msg.requesterUid}`, freshToken);
      if (!theirRaw) throw new Error('Requester profile not found');
      const theirDoc = fsToObj(theirRaw.fields);
      theirDoc.following = [...new Set([...(theirDoc.following || []), currentUser.uid])];
      const write2 = await fsWrite(`users/${msg.requesterUid}`, theirDoc, freshToken);
      if (write2.error) throw new Error('Failed to update requester profile: ' + write2.error.message);
      return { success: true };
    }

    case 'DECLINE_FOLLOW_REQUEST': {
      if (!currentUser) throw new Error('Not signed in');
      const token = await getToken();
      const myProfile = await fsGetObj(`users/${currentUser.uid}`, token);
      const requests = (myProfile?.followRequests || []).filter(r => r.uid !== msg.requesterUid);
      await fsPatch(`users/${currentUser.uid}`, { followRequests: requests }, token);
      return { success: true };
    }

    case 'UNFOLLOW': {
      if (!currentUser) throw new Error('Not signed in');
      const token = await getToken();
      const myProfile = await fsGetObj(`users/${currentUser.uid}`, token);
      const following = (myProfile?.following || []).filter(u => u !== msg.targetUid);
      await fsPatch(`users/${currentUser.uid}`, { following }, token);
      const theirProfile = await fsGetObj(`users/${msg.targetUid}`, token);
      const theirFollowers = (theirProfile?.followers || []).filter(u => u !== currentUser.uid);
      await fsPatch(`users/${msg.targetUid}`, { followers: theirFollowers }, token);
      return { success: true };
    }

    case 'REPOST_VIDEO': {
      if (!currentUser) throw new Error('Not signed in');
      const token = await getToken();
      const profile = await fsGetObj(`users/${currentUser.uid}`, token);
      const reposts = profile?.reposts || [];
      if (!reposts.find(r => r.videoId === msg.videoId)) {
        reposts.unshift({
          url: msg.url, title: msg.title, thumbnail: msg.thumbnail,
          platform: msg.platform, videoId: msg.videoId,
          timestamp: Date.now(),
          reposterUid: currentUser.uid,
          reposterName: currentUser.displayName,
          reposterPhoto: currentUser.photoURL
        });
        await fsPatch(`users/${currentUser.uid}`, { reposts }, token);
      }
      return { success: true };
    }

    case 'UNDO_REPOST': {
      if (!currentUser) throw new Error('Not signed in');
      const token = await getToken();
      const profile = await fsGetObj(`users/${currentUser.uid}`, token);
      const reposts = (profile?.reposts || []).filter(r => r.videoId !== msg.videoId);
      await fsPatch(`users/${currentUser.uid}`, { reposts }, token);
      return { success: true };
    }

    case 'GET_FEED': {
      if (!currentUser) { console.log('[SW GET_FEED] no user'); return { feed: [] }; }
      const token = await getToken();

      // Fetch raw document to debug conversion
      const myRaw = await fsGet(`users/${currentUser.uid}`, token);

      const myProfile = myRaw ? fsToObj(myRaw.fields) : null;

      const following = myProfile?.following || [];
      if (!following.length) { console.log('[SW GET_FEED] following is empty'); return { feed: [] }; }

      const feed = [];
      for (const uid of following) {
        const pRaw = await fsGet(`users/${uid}`, token);
        const p = pRaw ? fsToObj(pRaw.fields) : null;
        if (p) {
          (p.reposts || []).forEach(r => feed.push({
            ...r, reposterUid: uid, reposterName: p.displayName, reposterPhoto: p.photoURL
          }));
        }
      }
      feed.sort((a, b) => b.timestamp - a.timestamp);
      return { feed };
    }

    case 'GET_VIDEO_REPOSTERS': {
      if (!currentUser) return { reposters: [] };
      const token = await getToken();
      const myProfile = await fsGetObj(`users/${currentUser.uid}`, token);
      const following = myProfile?.following || [];
      const reposters = [];
      for (const uid of following) {
        const p = await fsGetObj(`users/${uid}`, token);
        if (p && (p.reposts || []).some(r => r.videoId === msg.videoId)) {
          reposters.push({ uid, displayName: p.displayName, photoURL: p.photoURL });
        }
      }
      return { reposters };
    }

    case 'CHECK_MY_REPOST': {
      if (!currentUser) return { reposted: false };
      const token = await getToken();
      const profile = await fsGetObj(`users/${currentUser.uid}`, token);
      return { reposted: (profile?.reposts || []).some(r => r.videoId === msg.videoId) };
    }

    default:
      return { error: 'Unknown message type' };
  }
}

// ── Google Sign-In via launchWebAuthFlow (works on Chrome + Edge + Brave) ─────
async function signInWithGoogle() {
  return new Promise((resolve, reject) => {
    const CLIENT_ID = getClientId();
    // Fixed redirect URI hosted on Firebase — same for every machine
    const redirectUri = 'https://reposter-38038.firebaseapp.com/__/auth/handler';
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', CLIENT_ID);
    authUrl.searchParams.set('response_type', 'token');
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('scope', 'email profile');
    authUrl.searchParams.set('prompt', 'select_account');

    chrome.identity.launchWebAuthFlow(
      { url: authUrl.toString(), interactive: true },
      async (responseUrl) => {
        if (chrome.runtime.lastError || !responseUrl) {
          reject(new Error(chrome.runtime.lastError?.message || 'Auth cancelled'));
          return;
        }
        try {
          // Extract access_token from redirect URL hash
          const hash = new URL(responseUrl).hash.slice(1);
          const params = new URLSearchParams(hash);
          const accessToken = params.get('access_token');
          if (!accessToken) throw new Error('No access token in response');

          // Exchange with Firebase
          const res = await fetch(
            `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${API_KEY}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                postBody: `access_token=${accessToken}&providerId=google.com`,
                requestUri: redirectUri,
                returnIdpCredential: true,
                returnSecureToken: true
              })
            }
          );

          const data = await res.json();
          if (data.error) throw new Error(data.error.message);

          currentUser = {
            uid: data.localId,
            displayName: data.displayName || data.fullName || 'User',
            photoURL: data.photoUrl || '',
            email: data.email,
            idToken: data.idToken,
            refreshToken: data.refreshToken
          };
          tokenExpiry = Date.now() + (parseInt(data.expiresIn) * 1000) - 60000;

          const fsToken = data.idToken;
          const existing = await fsGet(`users/${currentUser.uid}`, fsToken);
          if (!existing) {
            await fsSet(`users/${currentUser.uid}`, {
              uid: currentUser.uid,
              displayName: currentUser.displayName,
              displayNameLower: currentUser.displayName.toLowerCase(),
              email: currentUser.email,
              photoURL: currentUser.photoURL,
              followers: [],
              following: [],
              followRequests: [],
              reposts: [],
              createdAt: Date.now()
            }, fsToken);
          } else {
            await fsPatch(`users/${currentUser.uid}`, {
              displayName: currentUser.displayName,
              displayNameLower: currentUser.displayName.toLowerCase(),
              photoURL: currentUser.photoURL
            }, fsToken);
          }

          // Broadcast to all tabs
          chrome.tabs.query({}, (tabs) => {
            tabs.forEach(tab => chrome.tabs.sendMessage(tab.id, {
              type: 'AUTH_STATE_CHANGED',
              user: { uid: currentUser.uid, displayName: currentUser.displayName, photoURL: currentUser.photoURL, email: currentUser.email }
            }).catch(() => {}));
          });

          persistUser();
          resolve({ user: { uid: currentUser.uid, displayName: currentUser.displayName, photoURL: currentUser.photoURL, email: currentUser.email } });
        } catch (err) {
          reject(err);
        }
      }
    );
  });
}

function getClientId() {
  // Your Google OAuth Client ID — from Google Cloud Console -> Credentials -> OAuth 2.0 Client IDs -> Web client -> Client ID
  return '561936569640-85nsl8pi9hbf0q4gr73p0r9e1h78bqse.apps.googleusercontent.com';
}

// ── Token refresh ─────────────────────────────────────────────────────────────
async function getToken() {
  if (!currentUser) throw new Error('Not signed in');
  if (Date.now() < tokenExpiry) return currentUser.idToken;

  // Refresh
  const res = await fetch(
    `https://securetoken.googleapis.com/v1/token?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: currentUser.refreshToken })
    }
  );
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  currentUser.idToken = data.id_token;
  currentUser.refreshToken = data.refresh_token;
  tokenExpiry = Date.now() + (parseInt(data.expires_in) * 1000) - 60000;
  persistUser();
  return currentUser.idToken;
}

// ── Firestore REST helpers ────────────────────────────────────────────────────

async function fsGet(path, token) {
  const res = await fetch(`${FS_BASE}/${path}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return res.json();
}

async function fsGetObj(path, token) {
  const doc = await fsGet(path, token);
  if (!doc) return null;
  return fsToObj(doc.fields);
}

async function fsSet(path, obj, token) {
  return fsWrite(path, obj, token);
}

async function fsPatch(path, obj, token) {
  // Get full doc, merge, write back
  const existing = await fsGet(path, token);
  const existingObj = existing ? fsToObj(existing.fields) : {};
  const merged = { ...existingObj, ...obj };
  return fsWrite(path, merged, token);
}

async function fsWrite(path, obj, token) {
  // Full document write — no field mask, no merge issues
  const res = await fetch(`${FS_BASE}/${path}`, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: objToFs(obj) })
  });
  const result = await res.json();
  if (result.error) {
    console.error('[Repost SW] fsWrite error on', path, result.error);
    throw new Error(result.error.message);
  }
  return result;
}

async function fsQuery(collection, field, value, token) {
  const body = {
    structuredQuery: {
      from: [{ collectionId: collection }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            { fieldFilter: { field: { fieldPath: field }, op: 'GREATER_THAN_OR_EQUAL', value: { stringValue: value } } },
            { fieldFilter: { field: { fieldPath: field }, op: 'LESS_THAN_OR_EQUAL', value: { stringValue: value + '\uf8ff' } } }
          ]
        }
      },
      limit: 20
    }
  };
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`,
    { method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  const results = await res.json();
  return (results || [])
    .filter(r => r.document)
    .map(r => ({ uid: r.document.name.split('/').pop(), ...fsToObj(r.document.fields) }));
}

// ── Firestore value converters ─────────────────────────────────────────────────

function objToFs(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = toFsValue(v);
  }
  return out;
}

function toFsValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFsValue) } };
  if (typeof v === 'object') return { mapValue: { fields: objToFs(v) } };
  return { stringValue: String(v) };
}

function fsToObj(fields) {
  if (!fields) return {};
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = fromFsValue(v);
  }
  return out;
}

function fromFsValue(v) {
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return parseInt(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromFsValue);
  if ('mapValue' in v) return fsToObj(v.mapValue.fields || {});
  return null;
}
