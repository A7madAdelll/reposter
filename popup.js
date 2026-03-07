const FS_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents`;
const AUTH_BASE = `https://identitytoolkit.googleapis.com/v1/accounts`;
let currentUser = null;
let activeTab = "search";

// ════════════════════════════════════════════
//  AUTH HELPERS
// ════════════════════════════════════════════
async function getToken() {
  return new Promise((r) =>
    chrome.storage.local.get(["authToken"], (d) => r(d.authToken)),
  );
}

async function authFetch(endpoint, body) {
  const res = await fetch(
    `${AUTH_BASE}:${endpoint}?key=${FIREBASE_CONFIG.apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, returnSecureToken: true }),
    },
  );
  return res.json();
}

// ════════════════════════════════════════════
//  FIRESTORE HELPERS
// ════════════════════════════════════════════

// GET one document
async function fsGet(path) {
  const t = await getToken();
  const res = await fetch(`${FS_BASE}/${path}`, {
    headers: { Authorization: `Bearer ${t}` },
  });
  return res.json();
}

// SET (create/overwrite) a document at an exact path
async function fsSet(path, data) {
  const t = await getToken();
  const res = await fetch(`${FS_BASE}/${path}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${t}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields: toFields(data) }),
  });
  return res.json();
}

// ADD a document with an auto-generated ID inside a collection
async function fsAdd(collectionPath, data) {
  const t = await getToken();
  const res = await fetch(`${FS_BASE}/${collectionPath}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${t}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields: toFields(data) }),
  });
  return res.json();
}

// DELETE a document
async function fsDelete(path) {
  const t = await getToken();
  await fetch(`${FS_BASE}/${path}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${t}` },
  });
}

// LIST all documents in a collection path
// Works for both top-level ("usersProfiles") and sub-collections ("usersProfiles/uid/reposts")
async function fsAll(collectionPath) {
  const t = await getToken();
  const parts = collectionPath.split("/");
  const colId = parts.pop(); // last segment = collectionId
  const parent = parts.length ? `${FS_BASE}/${parts.join("/")}` : FS_BASE;

  const res = await fetch(`${parent}:runQuery`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${t}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: colId }],
        limit: 200,
      },
    }),
  });
  const docs = await res.json();
  if (!Array.isArray(docs)) return [];
  return docs
    .filter((d) => d.document)
    .map((d) => ({
      id: d.document.name.split("/").pop(),
      ...fromFields(d.document.fields),
    }));
}

function toFields(obj) {
  const f = {};
  for (const [k, v] of Object.entries(obj)) {
    f[k] = { stringValue: String(v ?? "") };
  }
  return f;
}

function fromFields(fields = {}) {
  return Object.fromEntries(
    Object.entries(fields).map(([k, v]) => [
      k,
      v.stringValue ?? v.booleanValue ?? "",
    ]),
  );
}

// ════════════════════════════════════════════
//  USER PROFILE
//
//  usersProfiles/{userId}                ← profile doc
//  usersProfiles/{userId}/followers/     ← sub-collection
//  usersProfiles/{userId}/requests/      ← sub-collection
//  usersProfiles/{userId}/reposts/       ← sub-collection  ← NEW
// ════════════════════════════════════════════

async function createUserProfile(userId, username, email, profilePic) {
  console.log("[RepostIt] Creating profile for", userId, username);

  // Step 1 — write the main profile document
  const profileResult = await fsSet(`usersProfiles/${userId}`, {
    userId,
    username,
    email,
    profilePic: profilePic || "",
    createdAt: new Date().toISOString(),
  });
  console.log("[RepostIt] Profile doc result:", profileResult);

  // Step 2 — seed sub-collections with placeholder docs
  // Firestore sub-collections don't exist until a document is written into them
  await fsSet(`usersProfiles/${userId}/followers/_init`, {
    _placeholder: "true",
  });
  await fsSet(`usersProfiles/${userId}/requests/_init`, {
    _placeholder: "true",
  });
  await fsSet(`usersProfiles/${userId}/reposts/_init`, {
    _placeholder: "true",
  });

  console.log("[RepostIt] Sub-collections seeded");
}

async function getUserProfile(userId) {
  const doc = await fsGet(`usersProfiles/${userId}`);
  if (!doc.fields) return null;
  return { id: userId, ...fromFields(doc.fields) };
}

// ════════════════════════════════════════════
//  REPOST
//  Saved to: usersProfiles/{userId}/reposts/{autoId}
// ════════════════════════════════════════════
async function addRepost(video, comment) {
  const myProfile = await getUserProfile(currentUser.localId);
  const result = await fsAdd(`usersProfiles/${currentUser.localId}/reposts`, {
    url: video.url,
    title: video.title,
    site: video.site,
    userId: currentUser.localId,
    username: myProfile?.username || myUsername(),
    profilePic: myProfile?.profilePic || "",
    comment: comment || "",
    timestamp: new Date().toISOString(),
  });
  console.log("[RepostIt] Repost saved:", result);
  return result;
}

// Get reposts for a specific user
async function getUserReposts(userId) {
  const all = await fsAll(`usersProfiles/${userId}/reposts`);
  return all
    .filter((r) => r._placeholder !== "true")
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

// Get reposts from all users I follow (for feed / floating avatars)
async function getFollowingReposts() {
  const followerIds = await getMyFollowerIds(); // people who mutually follow me
  if (!followerIds.length) return [];

  const allReposts = await Promise.all(
    followerIds.map((uid) => getUserReposts(uid)),
  );
  return allReposts
    .flat()
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

// ════════════════════════════════════════════
//  FOLLOW SYSTEM
// ════════════════════════════════════════════
async function sendFollowRequest(targetId, targetUsername) {
  const myId = currentUser.localId;
  const myProfile = await getUserProfile(myId);
  const myName = myProfile?.username || myUsername();
  const myPic = myProfile?.profilePic || "";

  // Guard: don't send if already requested or already following
  const [alreadyReq, alreadyFollow] = await Promise.all([
    fsGet(`usersProfiles/${targetId}/requests/${myId}`),
    fsGet(`usersProfiles/${targetId}/followers/${myId}`),
  ]);
  if (alreadyReq.fields || alreadyFollow.fields) return;

  await fsSet(`usersProfiles/${targetId}/requests/${myId}`, {
    requesterId: myId,
    requesterName: myName,
    requesterPic: myPic,
    createdAt: new Date().toISOString(),
  });
}

async function acceptFollowRequest(requesterId, requesterName, requesterPic) {
  const myId = currentUser.localId;
  const myProfile = await getUserProfile(myId);
  const myName = myProfile?.username || myUsername();
  const myPic = myProfile?.profilePic || "";

  await Promise.all([
    // Add requester to MY followers
    fsSet(`usersProfiles/${myId}/followers/${requesterId}`, {
      userId: requesterId,
      username: requesterName,
      profilePic: requesterPic || "",
      followedAt: new Date().toISOString(),
    }),
    // Add ME to requester's followers
    fsSet(`usersProfiles/${requesterId}/followers/${myId}`, {
      userId: myId,
      username: myName,
      profilePic: myPic,
      followedAt: new Date().toISOString(),
    }),
    // Delete the request
    fsDelete(`usersProfiles/${myId}/requests/${requesterId}`),
  ]);
}

async function declineFollowRequest(requesterId) {
  await fsDelete(
    `usersProfiles/${currentUser.localId}/requests/${requesterId}`,
  );
}

async function getMyFollowers() {
  const all = await fsAll(`usersProfiles/${currentUser.localId}/followers`);
  return all.filter((f) => f._placeholder !== "true");
}

async function getMyRequests() {
  const all = await fsAll(`usersProfiles/${currentUser.localId}/requests`);
  return all.filter((r) => r._placeholder !== "true");
}

async function getMyFollowerIds() {
  const followers = await getMyFollowers();
  return followers.map((f) => f.userId);
}

async function didISendRequest(targetId) {
  const doc = await fsGet(
    `usersProfiles/${targetId}/requests/${currentUser.localId}`,
  );
  return !!doc.fields;
}

async function doIFollow(targetId) {
  const doc = await fsGet(
    `usersProfiles/${targetId}/followers/${currentUser.localId}`,
  );
  return !!doc.fields;
}

// ════════════════════════════════════════════
//  UTILS
// ════════════════════════════════════════════
function strColor(s = "") {
  let h = 0;
  for (const c of s) h = c.charCodeAt(0) + ((h << 5) - h);
  return `hsl(${Math.abs(h) % 360},55%,42%)`;
}

function timeAgo(ts) {
  if (!ts) return "";
  const m = Math.floor((Date.now() - new Date(ts)) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  return `${Math.floor(m / 1440)}d ago`;
}

function avatarEl(username, pic, size = 36) {
  const initial = username?.[0]?.toUpperCase() || "?";
  if (pic && pic !== "undefined" && pic !== "") {
    return `<img src="${pic}"
      style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;flex-shrink:0;"
      onerror="this.outerHTML='<div class=avatar style=width:${size}px;height:${size}px;font-size:${Math.floor(size * 0.42)}px;background:${strColor(username)}>${initial}</div>'"
    />`;
  }
  return `<div class="avatar" style="width:${size}px;height:${size}px;font-size:${Math.floor(size * 0.42)}px;background:${strColor(username)}">${initial}</div>`;
}

function myUsername() {
  return currentUser.displayName || currentUser.email.split("@")[0];
}

// ════════════════════════════════════════════
//  CURRENT PAGE VIDEO
// ════════════════════════════════════════════
async function getCurrentVideo() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const url = tabs[0]?.url || "";
      const title = tabs[0]?.title || "";
      if (url.includes("youtube.com/watch"))
        return resolve({
          url: url.split("&")[0],
          title: title.replace(" - YouTube", ""),
          site: "YouTube",
        });
      if (
        (url.includes("twitter.com") || url.includes("x.com")) &&
        url.includes("/status/")
      )
        return resolve({ url, title, site: "Twitter/X" });
      if (url.includes("reddit.com/r/") && url.includes("/comments/"))
        return resolve({ url, title, site: "Reddit" });
      resolve(null);
    });
  });
}

// ════════════════════════════════════════════
//  AUTH SCREEN
// ════════════════════════════════════════════
function renderAuth() {
  document.getElementById("user-pill").innerHTML = "";
  let mode = "login";

  document.getElementById("app").innerHTML = `
    <div class="auth-wrap">
      <div class="auth-tabs">
        <button class="auth-tab active" id="at-login">Login</button>
        <button class="auth-tab" id="at-signup">Sign Up</button>
      </div>
      <input type="email"    id="a-email" placeholder="Email" autocomplete="off" />
      <input type="password" id="a-pass"  placeholder="Password" />
      <div id="a-urow" style="display:none">
        <input type="text" id="a-uname" placeholder="Choose a username" />
        <input type="text" id="a-pic"   placeholder="Profile picture URL (optional)" />
      </div>
      <button class="btn-primary" id="a-go">Login</button>
      <div class="auth-status" id="a-status"></div>
    </div>`;

  document.getElementById("at-login").onclick = () => {
    mode = "login";
    document.getElementById("at-login").classList.add("active");
    document.getElementById("at-signup").classList.remove("active");
    document.getElementById("a-go").textContent = "Login";
    document.getElementById("a-urow").style.display = "none";
  };

  document.getElementById("at-signup").onclick = () => {
    mode = "signup";
    document.getElementById("at-signup").classList.add("active");
    document.getElementById("at-login").classList.remove("active");
    document.getElementById("a-go").textContent = "Create Account";
    document.getElementById("a-urow").style.display = "block";
  };

  document.getElementById("a-go").onclick = async () => {
    const email = document.getElementById("a-email").value.trim();
    const pass = document.getElementById("a-pass").value;
    const uname = document.getElementById("a-uname")?.value.trim();
    const pic = document.getElementById("a-pic")?.value.trim() || "";
    const st = document.getElementById("a-status");

    if (!email || !pass) {
      st.textContent = "Please fill all fields.";
      return;
    }
    st.textContent = "Loading...";

    // ── LOGIN ────────────────────────────────────────
    if (mode === "login") {
      const result = await authFetch("signInWithPassword", {
        email,
        password: pass,
      });
      if (result.error) {
        st.textContent = result.error.message;
        return;
      }
      chrome.storage.local.set({ authToken: result.idToken, userData: result });
      currentUser = result;
      renderMain();

      // ── SIGNUP ───────────────────────────────────────
    } else {
      if (!uname) {
        st.textContent = "Choose a username.";
        return;
      }
      st.textContent = "Creating account...";

      // 1. Create Firebase Auth account
      const result = await authFetch("signUp", {
        email,
        password: pass,
        displayName: uname,
      });
      if (result.error) {
        st.textContent = result.error.message;
        return;
      }

      // 2. Save token immediately — needed so Firestore writes are authenticated
      chrome.storage.local.set({ authToken: result.idToken, userData: result });
      currentUser = result;

      st.textContent = "Setting up profile...";

      // 3. Create the usersProfiles document + seed all sub-collections
      await createUserProfile(result.localId, uname, email, pic);

      st.textContent = "Done!";
      renderMain();
    }
  };
}

// ════════════════════════════════════════════
//  MAIN SHELL
// ════════════════════════════════════════════
async function renderMain() {
  const requests = await getMyRequests();
  const pendingCount = requests.length;

  document.getElementById("user-pill").innerHTML = `
    <div class="user-pill">
      <span>👤 ${myUsername()}</span>
      <button class="logout-btn" id="logout-btn">sign out</button>
    </div>`;

  document.getElementById("logout-btn").onclick = () => {
    chrome.storage.local.remove(["authToken", "userData"]);
    currentUser = null;
    renderAuth();
  };

  const video = await getCurrentVideo();

  document.getElementById("app").innerHTML = `
    ${
      video
        ? `
    <div class="repost-bar">
      <div class="video-label">
        <span class="site-badge">${video.site}</span>
        ${video.title?.slice(0, 50)}${video.title?.length > 50 ? "…" : ""}
      </div>
      <textarea id="rp-comment" placeholder="Add a comment (optional)..."></textarea>
      <button class="btn-repost" id="rp-btn">🔁 Repost This</button>
      <div class="repost-status" id="rp-status"></div>
    </div>`
        : `
    <div style="padding:9px 16px;font-size:11px;color:#333;background:#0f0f1a;border-bottom:1px solid #1c1c2e">
      🎬 Go to YouTube, Twitter/X, or Reddit to repost a video
    </div>`
    }

    <div class="tabs">
      <button class="tab ${activeTab === "search" ? "active" : ""}" data-tab="search">🔍 Find People</button>
      <button class="tab ${activeTab === "requests" ? "active" : ""}" data-tab="requests">
        Requests${pendingCount ? ` <span class="badge">${pendingCount}</span>` : ""}
      </button>
      <button class="tab ${activeTab === "myreposts" ? "active" : ""}" data-tab="myreposts">My Reposts</button>
    </div>
    <div class="tab-body" id="tab-body"><div class="empty">Loading...</div></div>`;

  document.querySelectorAll(".tab[data-tab]").forEach((btn) => {
    btn.onclick = () => {
      activeTab = btn.dataset.tab;
      document
        .querySelectorAll(".tab[data-tab]")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      loadTab(activeTab);
    };
  });

  if (video) {
    document.getElementById("rp-btn").onclick = async () => {
      const comment = document.getElementById("rp-comment").value.trim();
      const st = document.getElementById("rp-status");
      st.style.color = "#667eea";
      st.textContent = "Reposting...";
      await addRepost(video, comment);
      st.style.color = "#2ecc71";
      st.textContent = "✅ Reposted!";
      document.getElementById("rp-comment").value = "";
    };
  }

  loadTab(activeTab);
}

// ════════════════════════════════════════════
//  TAB LOADER
// ════════════════════════════════════════════
async function loadTab(tab) {
  const body = document.getElementById("tab-body");
  body.innerHTML = `<div class="empty">Loading...</div>`;
  if (tab === "search") await renderSearch(body);
  if (tab === "requests") await renderRequests(body);
  if (tab === "myreposts") await renderMyReposts(body);
}

// ════════════════════════════════════════════
//  TAB: FIND PEOPLE
// ════════════════════════════════════════════
async function renderSearch(body) {
  body.innerHTML = `
    <div class="search-row">
      <input type="text" id="s-input" placeholder="Search by username..." />
      <button id="s-btn">Search</button>
    </div>
    <div id="s-results"></div>
    <div class="invite-section">
      <label>🔗 Share your ID so friends can find you</label>
      <div class="invite-box">
        <span class="invite-code" style="font-size:10px;word-break:break-all">${currentUser.localId}</span>
        <button class="copy-btn" id="inv-copy">Copy</button>
      </div>
      <div class="status-flash" id="inv-status"></div>
    </div>`;

  document.getElementById("inv-copy").onclick = () => {
    navigator.clipboard.writeText(currentUser.localId);
    const st = document.getElementById("inv-status");
    st.textContent = "✅ Copied!";
    setTimeout(() => (st.textContent = ""), 2000);
  };

  const doSearch = async () => {
    const q = document.getElementById("s-input").value.trim().toLowerCase();
    const resultsEl = document.getElementById("s-results");
    if (!q) {
      resultsEl.innerHTML = "";
      return;
    }

    resultsEl.innerHTML = `<div class="empty">Searching...</div>`;

    // Read all profile docs from usersProfiles
    const allProfiles = await fsAll("usersProfiles");
    console.log("[RepostIt] All profiles:", allProfiles);

    const matches = allProfiles.filter(
      (u) =>
        u.userId &&
        u.userId !== currentUser.localId &&
        u._placeholder !== "true" &&
        u.username?.toLowerCase().includes(q),
    );

    if (!matches.length) {
      resultsEl.innerHTML = `<div class="empty">No users found for "<b>${q}</b>"</div>`;
      return;
    }

    const withStatus = await Promise.all(
      matches.map(async (u) => {
        const [sent, following] = await Promise.all([
          didISendRequest(u.userId),
          doIFollow(u.userId),
        ]);
        return { ...u, sent, following };
      }),
    );

    resultsEl.innerHTML = withStatus
      .map((u) => {
        let btn = `<button class="action-btn btn-follow" data-uid="${u.userId}" data-name="${u.username}" data-pic="${u.profilePic || ""}">Follow</button>`;
        if (u.sent)
          btn = `<span class="action-btn btn-pending">Pending ⏳</span>`;
        if (u.following)
          btn = `<span class="action-btn btn-following">Following ✓</span>`;
        return `
        <div class="user-card">
          ${avatarEl(u.username, u.profilePic)}
          <div class="user-info"><div class="uname">${u.username}</div></div>
          ${btn}
        </div>`;
      })
      .join("");

    body.querySelectorAll("button[data-uid]").forEach((btn) => {
      btn.onclick = async () => {
        btn.textContent = "Sending...";
        btn.disabled = true;
        await sendFollowRequest(btn.dataset.uid, btn.dataset.name);
        btn.textContent = "Pending ⏳";
        btn.className = "action-btn btn-pending";
      };
    });
  };

  document.getElementById("s-btn").onclick = doSearch;
  document.getElementById("s-input").onkeydown = (e) => {
    if (e.key === "Enter") doSearch();
  };
}

// ════════════════════════════════════════════
//  TAB: REQUESTS & FOLLOWERS
// ════════════════════════════════════════════
async function renderRequests(body) {
  const [requests, followers] = await Promise.all([
    getMyRequests(),
    getMyFollowers(),
  ]);

  let html = "";

  if (requests.length) {
    html += `<div class="section-label" style="color:#f5576c">📥 Follow Requests</div>`;
    html += requests
      .map(
        (req) => `
      <div class="user-card">
        ${avatarEl(req.requesterName, req.requesterPic)}
        <div class="user-info">
          <div class="uname">${req.requesterName}</div>
          <div class="usub">wants to follow you</div>
        </div>
        <div style="display:flex;gap:4px">
          <button class="action-btn btn-accept"
            data-id="${req.requesterId}"
            data-name="${req.requesterName}"
            data-pic="${req.requesterPic || ""}">✅ Accept</button>
          <button class="action-btn btn-decline"
            data-id="${req.requesterId}">✕</button>
        </div>
      </div>`,
      )
      .join("");
  }

  if (followers.length) {
    html += `<div class="section-label" style="margin-top:${requests.length ? "14px" : "0"}">👥 Followers</div>`;
    html += followers
      .map(
        (f) => `
      <div class="user-card">
        ${avatarEl(f.username, f.profilePic)}
        <div class="user-info">
          <div class="uname">${f.username}</div>
          <div class="usub">follows you</div>
        </div>
        <span class="action-btn btn-following">Follower</span>
      </div>`,
      )
      .join("");
  }

  if (!html) {
    html = `<div class="empty">No follow activity yet.<br>Search for people to follow!</div>`;
  }

  body.innerHTML = html;

  body.querySelectorAll(".btn-accept[data-id]").forEach((btn) => {
    btn.onclick = async () => {
      btn.textContent = "...";
      btn.disabled = true;
      await acceptFollowRequest(
        btn.dataset.id,
        btn.dataset.name,
        btn.dataset.pic,
      );
      renderMain();
    };
  });

  body.querySelectorAll(".btn-decline[data-id]").forEach((btn) => {
    btn.onclick = async () => {
      btn.disabled = true;
      await declineFollowRequest(btn.dataset.id);
      loadTab("requests");
    };
  });
}

// ════════════════════════════════════════════
//  TAB: MY REPOSTS
//  Reads from usersProfiles/{myId}/reposts
// ════════════════════════════════════════════
async function renderMyReposts(body) {
  const mine = await getUserReposts(currentUser.localId);

  if (!mine.length) {
    body.innerHTML = `<div class="empty">You haven't reposted anything yet.<br>Browse YouTube, Twitter/X, or Reddit!</div>`;
    return;
  }

  body.innerHTML = mine
    .map(
      (r) => `
    <div class="repost-card" data-url="${r.url}">
      <div class="rc-site">${r.site}</div>
      <div class="rc-title">${r.title?.slice(0, 70) || "Video"}${r.title?.length > 70 ? "…" : ""}</div>
      ${r.comment ? `<div class="rc-comment">"${r.comment}"</div>` : ""}
      <div class="rc-time">${timeAgo(r.timestamp)}</div>
    </div>`,
    )
    .join("");

  body.querySelectorAll(".repost-card").forEach((card) => {
    card.onclick = () => chrome.tabs.create({ url: card.dataset.url });
  });
}

// ════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════
chrome.storage.local.get(["authToken", "userData"], (data) => {
  if (data.authToken && data.userData) {
    currentUser = data.userData;
    renderMain();
  } else {
    renderAuth();
  }
});
