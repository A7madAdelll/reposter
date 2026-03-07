// ─── Helpers ───────────────────────────────────────────────────────────
function timeAgo(ts) {
  if (!ts) return "";
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  return `${Math.floor(m / 1440)}d ago`;
}

async function getStoredData() {
  return new Promise((r) =>
    chrome.storage.local.get(["authToken", "userData"], r),
  );
}

async function firestoreQuery(collection, field, value) {
  const data = await getStoredData();
  if (!data.authToken) return [];
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents:runQuery`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${data.authToken}`,
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
  const docs = await res.json();
  return docs
    .filter((d) => d.document)
    .map((d) => ({
      id: d.document.name.split("/").pop(),
      ...Object.fromEntries(
        Object.entries(d.document.fields || {}).map(([k, v]) => [
          k,
          v.stringValue || v.booleanValue,
        ]),
      ),
    }));
}

// ─── Get who current user follows (accepted only) ──────────────────────
async function getFollowedUserIds() {
  const data = await getStoredData();
  if (!data.userData) return [];
  const follows = await firestoreQuery(
    "follows",
    "followerId",
    data.userData.localId,
  );
  return follows
    .filter((f) => f.status === "accepted")
    .map((f) => f.followingId);
}

// ─── Load reposts for this page from followed users ────────────────────
async function loadReposts() {
  const data = await getStoredData();
  if (!data.authToken) return [];

  const followedIds = await getFollowedUserIds();
  if (!followedIds.length) return [];

  const currentUrl = window.location.href.split("&")[0];
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents:runQuery`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${data.authToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "reposts" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "url" },
            op: "EQUAL",
            value: { stringValue: currentUrl },
          },
        },
        limit: 50,
      },
    }),
  });

  const docs = await res.json();
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
    }))
    .filter((r) => followedIds.includes(r.userId));
}

// ─── Inject floating avatars ───────────────────────────────────────────
async function injectAvatars() {
  const reposts = await loadReposts();
  document.querySelectorAll("#repostit-avatars").forEach((el) => el.remove());
  if (!reposts.length) return;

  const container = document.createElement("div");
  container.id = "repostit-avatars";
  container.innerHTML = `<div class="repostit-label">👥 Reposted by people you follow</div>`;

  reposts.slice(0, 6).forEach((r, i) => {
    const el = document.createElement("div");
    el.className = "repostit-avatar";
    el.style.animationDelay = `${i * 0.1}s`;
    el.innerHTML = `
      <div class="repostit-avatar-inner" style="background: ${stringToColor(r.username)}">
        <span>${r.username?.[0]?.toUpperCase() || "?"}</span>
      </div>
      <div class="repostit-tooltip">
        <strong>${r.username}</strong>
        ${r.comment ? `<p>"${r.comment}"</p>` : "<p>Reposted this!</p>"}
        <small>${timeAgo(r.timestamp)}</small>
      </div>`;
    container.appendChild(el);
  });

  if (reposts.length > 6) {
    const more = document.createElement("div");
    more.className = "repostit-avatar";
    more.innerHTML = `<div class="repostit-avatar-inner" style="background:#444"><span>+${reposts.length - 6}</span></div>`;
    container.appendChild(more);
  }

  document.body.appendChild(container);
}

function stringToColor(str = "") {
  let hash = 0;
  for (let c of str) hash = c.charCodeAt(0) + ((hash << 5) - hash);
  return `hsl(${hash % 360}, 60%, 45%)`;
}

setTimeout(injectAvatars, 2500);
