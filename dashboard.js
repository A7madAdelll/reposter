const FS = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents`;
let currentUser = null;

async function getToken() {
  return new Promise((r) =>
    chrome.storage.local.get(["authToken"], (d) => r(d.authToken)),
  );
}

async function firestoreGet(path) {
  const token = await getToken();
  const r = await fetch(`${FS}/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return r.json();
}

async function firestoreSet(path, data) {
  const token = await getToken();
  const fields = {};
  for (const [k, v] of Object.entries(data))
    fields[k] = { stringValue: String(v) };
  await fetch(`${FS}/${path}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields }),
  });
}

async function firestoreAdd(collection, data) {
  const token = await getToken();
  const fields = {};
  for (const [k, v] of Object.entries(data))
    fields[k] = { stringValue: String(v) };
  const r = await fetch(`${FS}/${collection}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields }),
  });
  return r.json();
}

async function firestoreUpdate(path, field, value) {
  const token = await getToken();
  await fetch(`${FS}/${path}?updateMask.fieldPaths=${field}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields: { [field]: { stringValue: value } } }),
  });
}

async function firestoreQuery(collection, field, value) {
  const token = await getToken();
  const r = await fetch(`${FS.replace("/documents", "")}/documents:runQuery`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: collection }],
        where: {
          fieldFilter: {
            field: { fieldPath: field },
            op: "EQUAL",
            value: { stringValue: value },
          },
        },
        limit: 50,
      },
    }),
  });
  const docs = await r.json();
  return docs
    .filter((d) => d.document)
    .map((d) => ({
      id: d.document.name.split("/").pop(),
      ...Object.fromEntries(
        Object.entries(d.document.fields || {}).map(([k, v]) => [
          k,
          v.stringValue,
        ]),
      ),
    }));
}

async function getAllUsers() {
  const token = await getToken();
  const r = await fetch(`${FS}/users?pageSize=100`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await r.json();
  if (!data.documents) return [];
  return data.documents.map((doc) => ({
    id: doc.name.split("/").pop(),
    ...Object.fromEntries(
      Object.entries(doc.fields || {}).map(([k, v]) => [k, v.stringValue]),
    ),
  }));
}

function stringToColor(str = "") {
  let hash = 0;
  for (let c of str) hash = c.charCodeAt(0) + ((hash << 5) - hash);
  return `hsl(${Math.abs(hash) % 360}, 60%, 45%)`;
}

function timeAgo(ts) {
  if (!ts) return "";
  const diff = Date.now() - new Date(ts);
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  return `${Math.floor(m / 1440)}d ago`;
}

// ─── Follow actions ────────────────────────────────────────────────────
async function sendFollowRequest(targetUserId, targetUsername) {
  const existing = await firestoreQuery(
    "follows",
    "followerId",
    currentUser.localId,
  );
  const already = existing.find((f) => f.followingId === targetUserId);
  if (already) return;

  await firestoreAdd("follows", {
    followerId: currentUser.localId,
    followerName: currentUser.displayName || currentUser.email.split("@")[0],
    followingId: targetUserId,
    followingName: targetUsername,
    status: "pending",
    createdAt: new Date().toISOString(),
  });
  loadAll();
}

async function respondToRequest(docId, status) {
  await firestoreUpdate(`follows/${docId}`, "status", status);
  loadAll();
}

// ─── Load everything ───────────────────────────────────────────────────
async function loadAll() {
  await Promise.all([
    loadFollowing(),
    loadFollowers(),
    loadRequests(),
    loadFeed(),
  ]);
}

async function loadFollowing() {
  const follows = await firestoreQuery(
    "follows",
    "followerId",
    currentUser.localId,
  );
  const accepted = follows.filter((f) => f.status === "accepted");
  const pending = follows.filter((f) => f.status === "pending");
  const panel = document.getElementById("following-panel");

  if (!accepted.length && !pending.length) {
    panel.innerHTML = `<h2>Following</h2><div class="empty">Not following anyone yet</div>`;
    return;
  }

  panel.innerHTML = `<h2>Following</h2>
    ${accepted
      .map(
        (f) => `
      <div class="user-card">
        <div class="avatar" style="background:${stringToColor(f.followingName)}">${f.followingName?.[0]?.toUpperCase()}</div>
        <div class="info"><div class="name">${f.followingName}</div><div class="sub">Following</div></div>
        <span class="action-btn btn-following">✓</span>
      </div>`,
      )
      .join("")}
    ${pending
      .map(
        (f) => `
      <div class="user-card">
        <div class="avatar" style="background:${stringToColor(f.followingName)}">${f.followingName?.[0]?.toUpperCase()}</div>
        <div class="info"><div class="name">${f.followingName}</div><div class="sub">Pending...</div></div>
        <span class="action-btn btn-pending">⏳</span>
      </div>`,
      )
      .join("")}`;
}

async function loadFollowers() {
  const follows = await firestoreQuery(
    "follows",
    "followingId",
    currentUser.localId,
  );
  const accepted = follows.filter((f) => f.status === "accepted");
  const panel = document.getElementById("followers-panel");

  if (!accepted.length) {
    panel.innerHTML = `<h2>Followers</h2><div class="empty">No followers yet</div>`;
    return;
  }

  panel.innerHTML = `<h2>Followers</h2>
    ${accepted
      .map(
        (f) => `
      <div class="user-card">
        <div class="avatar" style="background:${stringToColor(f.followerName)}">${f.followerName?.[0]?.toUpperCase()}</div>
        <div class="info"><div class="name">${f.followerName}</div><div class="sub">Follower</div></div>
      </div>`,
      )
      .join("")}`;
}

async function loadRequests() {
  const pending = await firestoreQuery(
    "follows",
    "followingId",
    currentUser.localId,
  ).then((f) => f.filter((x) => x.status === "pending"));
  const panel = document.getElementById("requests-panel");
  const countEl = document.getElementById("req-count");
  countEl.innerHTML = pending.length
    ? `<span class="notif-dot">${pending.length}</span>`
    : "";

  if (!pending.length) {
    panel.innerHTML = `<h2>Follow Requests</h2><div class="empty">No pending requests 🎉</div>`;
    return;
  }

  panel.innerHTML = `<h2>Follow Requests ${pending.length ? `<span class="notif-dot">${pending.length}</span>` : ""}</h2>
    ${pending
      .map(
        (p) => `
      <div class="user-card">
        <div class="avatar" style="background:${stringToColor(p.followerName)}">${p.followerName?.[0]?.toUpperCase()}</div>
        <div class="info"><div class="name">${p.followerName}</div><div class="sub">Wants to follow you</div></div>
        <div style="display:flex;gap:4px">
          <button class="action-btn btn-accept" onclick="respondToRequest('${p.id}','accepted')">✅</button>
          <button class="action-btn btn-decline" onclick="respondToRequest('${p.id}','declined')">❌</button>
        </div>
      </div>`,
      )
      .join("")}`;
}

async function loadFeed() {
  const follows = await firestoreQuery(
    "follows",
    "followerId",
    currentUser.localId,
  );
  const followedIds = follows
    .filter((f) => f.status === "accepted")
    .map((f) => f.followingId);
  const feedEl = document.getElementById("main-feed");

  if (!followedIds.length) {
    feedEl.innerHTML = `<div class="empty">Follow people to see their reposts here 👀</div>`;
    return;
  }

  const token = await getToken();
  const r = await fetch(`${FS}/reposts?pageSize=50`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await r.json();

  const reposts = (data.documents || [])
    .map((doc) => ({
      id: doc.name.split("/").pop(),
      ...Object.fromEntries(
        Object.entries(doc.fields || {}).map(([k, v]) => [k, v.stringValue]),
      ),
    }))
    .filter((r) => followedIds.includes(r.userId))
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  if (!reposts.length) {
    feedEl.innerHTML = `<div class="empty">No reposts yet from people you follow</div>`;
    return;
  }

  feedEl.innerHTML = reposts
    .map(
      (r) => `
    <div class="feed-card" onclick="chrome.tabs.create({url:'${r.url}'})">
      <div class="fc-header">
        <div class="avatar" style="width:30px;height:30px;font-size:13px;background:${stringToColor(r.username)}">${r.username?.[0]?.toUpperCase()}</div>
        <span class="fc-name">${r.username}</span>
        <span class="fc-time">${timeAgo(r.timestamp)}</span>
      </div>
      <div class="fc-title">${r.title?.slice(0, 70) || "Video"}</div>
      <div class="fc-site">${r.site}</div>
      ${r.comment ? `<div class="fc-comment">"${r.comment}"</div>` : ""}
    </div>`,
    )
    .join("");
}

// ─── Search ────────────────────────────────────────────────────────────
async function searchUsers(query) {
  const allUsers = await getAllUsers();
  const myFollows = await firestoreQuery(
    "follows",
    "followerId",
    currentUser.localId,
  );
  const results = allUsers.filter(
    (u) =>
      u.userId !== currentUser.localId &&
      u.username?.toLowerCase().includes(query.toLowerCase()),
  );

  const panel = document.getElementById("search-results-panel");
  const el = document.getElementById("search-results");

  if (!results.length) {
    el.innerHTML = `<div class="empty">No users found</div>`;
    panel.style.display = "block";
    return;
  }

  el.innerHTML = results
    .map((u) => {
      const follow = myFollows.find((f) => f.followingId === u.userId);
      let btn = `<button class="action-btn btn-follow" onclick="sendFollowRequest('${u.userId}','${u.username}')">Follow</button>`;
      if (follow?.status === "pending")
        btn = `<span class="action-btn btn-pending">Pending</span>`;
      if (follow?.status === "accepted")
        btn = `<span class="action-btn btn-following">Following ✓</span>`;
      return `
      <div class="user-card">
        <div class="avatar" style="background:${stringToColor(u.username)}">${u.username?.[0]?.toUpperCase()}</div>
        <div class="info"><div class="name">${u.username}</div></div>
        ${btn}
      </div>`;
    })
    .join("");
  panel.style.display = "block";
}

// ─── Invite link ───────────────────────────────────────────────────────
function generateInviteLink() {
  const base = "https://repostit.app/invite"; // customize this
  const link = `${base}?ref=${currentUser.localId}`;
  document.getElementById("invite-link").textContent = link;
  document.getElementById("copy-invite").onclick = () => {
    navigator.clipboard.writeText(link);
    document.getElementById("status-msg").textContent = "✅ Link copied!";
    setTimeout(
      () => (document.getElementById("status-msg").textContent = ""),
      2000,
    );
  };
}

// ─── Init ──────────────────────────────────────────────────────────────
chrome.storage.local.get(["authToken", "userData"], async (data) => {
  if (!data.authToken || !data.userData) {
    document.body.innerHTML = `<div style="padding:40px;text-align:center;color:#667eea">Please log in via the extension popup first.</div>`;
    return;
  }
  currentUser = data.userData;
  document.getElementById("topbar-user").textContent =
    `👤 ${currentUser.displayName || currentUser.email.split("@")[0]}`;
  generateInviteLink();
  loadAll();

  document.getElementById("search-btn").onclick = () => {
    const q = document.getElementById("search-input").value.trim();
    if (q) searchUsers(q);
  };
  document.getElementById("search-input").onkeydown = (e) => {
    if (e.key === "Enter") document.getElementById("search-btn").click();
  };
});
