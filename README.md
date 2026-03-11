# 🔁 Repost — Share Videos Across Every Platform

A Chrome/Edge extension that lets you repost videos from YouTube, TikTok, X/Twitter, and more to your followers. Like Instagram repost, but cross-platform.

---

## What It Does

- **Repost button** injected directly into YouTube, TikTok, and X video pages
- **"From People You Follow"** section injected at the top of YouTube's home feed
- **Follow system** — send/accept/decline follow requests
- **Google sign-in** — works on Chrome and Edge on any machine
- **Persistent session** — stays logged in even after the browser restarts

---

## How to Install (For Users)

1. Download and extract the zip
2. Open **Chrome** → go to `chrome://extensions`
3. Enable **Developer Mode** (toggle in the top right)
4. Click **Load unpacked** → select the extracted `repost-extension` folder
5. Pin the extension to your toolbar by clicking the puzzle icon
6. Click the extension icon → **Continue with Google** → sign in

> **Edge users:** Go to `edge://extensions` instead. Everything else is the same.

---

## How to Use

### Reposting a video
1. Go to any YouTube video page (e.g. `youtube.com/watch?v=...`)
2. Wait for the page to load — a **Repost** button appears next to the Like/Share buttons
3. Click it — the button turns purple and says "Reposted"

### Seeing reposts in your feed
1. Follow someone first (see below)
2. Go to `youtube.com` home page
3. A **"From People You Follow"** section appears at the top of the feed

### Following someone
1. Click the extension icon → go to the **People** tab
2. Search for someone by name → click **Follow**
3. Once they accept, their reposts appear in your feed

### Accepting follow requests
1. Click the extension icon → go to the **Requests** tab
2. Click **Accept** or **Decline**

---

## File Structure

```
repost-extension/
├── manifest.json               # Extension configuration
├── firestore.rules             # Firestore security rules
├── background/
│   └── service_worker.js      # Auth, Firestore, all business logic
├── content/
│   ├── content.js              # DOM injection on YouTube, TikTok, X
│   └── content.css             # Styles for injected elements
├── popup/
│   ├── popup.html              # Extension popup UI
│   ├── popup.css               # Popup styles
│   └── popup.js                # Popup logic
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## Supported Platforms

| Platform | Repost Button | Feed Section | Reposter Badge |
|---|---|---|---|
| YouTube | ✅ | ✅ | ✅ |
| X / Twitter | ✅ | ✅ | ✅ |
| TikTok | ✅ | ✅ | ✅ |
| Reddit | ✅ | — | — |
| Vimeo | ✅ | — | — |
| Twitch | ✅ | — | — |

---

## Firebase Setup (For Developers)

The extension is pre-configured for the `reposter-38038` Firebase project. To run your own instance:

### 1. Create a Firebase Project
1. Go to [console.firebase.google.com](https://console.firebase.google.com) → create project
2. Enable **Google Authentication** → Authentication → Sign-in method → Google
3. Create a **Firestore Database** in production mode

### 2. Set Firestore Rules
Firestore → Rules tab → paste contents of `firestore.rules` → Publish

### 3. Configure Google Cloud OAuth
1. [console.cloud.google.com](https://console.cloud.google.com) → your project
2. **APIs & Services → Credentials → Web client → Edit**
3. Add to **Authorized redirect URIs**:
   ```
   https://YOUR_PROJECT_ID.firebaseapp.com/__/auth/handler
   ```
4. Add to **Authorized JavaScript origins**:
   ```
   https://YOUR_PROJECT_ID.firebaseapp.com
   ```
5. Save

### 4. Publish OAuth App
APIs & Services → OAuth consent screen → Audience → set to **In production**

### 5. Update Extension Config
In `background/service_worker.js`, update `FIREBASE_CONFIG` and `getClientId()` with your values from Firebase Console → Project Settings.

---

## Firestore Data Model

Each user stored as `users/{uid}`:

```json
{
  "uid": "abc123",
  "displayName": "Ahmed",
  "displayNameLower": "ahmed",
  "email": "ahmed@gmail.com",
  "photoURL": "https://...",
  "followers": ["uid1", "uid2"],
  "following": ["uid3", "uid4"],
  "followRequests": [
    { "uid": "uid5", "displayName": "Sara", "photoURL": "...", "timestamp": 1234567890 }
  ],
  "reposts": [
    {
      "videoId": "dQw4w9WgXcQ",
      "url": "https://youtube.com/watch?v=dQw4w9WgXcQ",
      "title": "Video Title",
      "thumbnail": "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      "platform": "YouTube",
      "timestamp": 1234567890
    }
  ]
}
```

---

## Architecture

```
User clicks Repost
  └─► content.js sends message to service_worker.js
      └─► writes to Firestore users/{uid}/reposts

User opens youtube.com
  └─► content.js calls GET_FEED
      └─► service_worker reads following list
          └─► fetches each followed user's reposts
              └─► content.js injects "From People You Follow" into DOM
```

**Why no Firebase SDK?**
MV3 service workers cannot load external scripts. The extension uses Firebase's REST API via `fetch()` directly — no imports needed.

---

## Tech Stack

- Chrome Extension Manifest V3
- Firebase Firestore REST API
- Firebase Authentication via `launchWebAuthFlow`
- `chrome.storage.local` for persistent sessions
- Vanilla JS DOM injection — no frameworks

---

## Known Limitations

- YouTube's repost button requires ~2 seconds after page load due to YouTube's SPA rendering
- If YouTube updates their DOM structure, selectors in `content.js` may need updating
- Tokens auto-refresh every hour silently in the background
