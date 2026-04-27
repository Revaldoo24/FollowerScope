const usernamesInput = document.getElementById("usernames");
const checkBtn = document.getElementById("checkBtn");
const resultEl = document.getElementById("result");
const summaryEl = document.getElementById("summary");
const platformNoteEl = document.getElementById("platformNote");
const subtitleTextEl = document.getElementById("subtitleText");
const menuButtons = Array.from(document.querySelectorAll(".menu-btn"));
const importFileBtn = document.getElementById("importFileBtn");
const settingsToggleBtn = document.getElementById("settingsToggleBtn");
const settingsPanel = document.getElementById("settingsPanel");
const fileInput = document.getElementById("fileInput");
const sessionIdInput = document.getElementById("sessionIdInput");
const batchSizeInput = document.getElementById("batchSizeInput");
const retryCountInput = document.getElementById("retryCountInput");
const progressBox = document.getElementById("progressBox");
const progressText = document.getElementById("progressText");
const progressFill = document.getElementById("progressFill");
const exportJsonBtn = document.getElementById("exportJsonBtn");
const exportCsvBtn = document.getElementById("exportCsvBtn");

let activePlatform = "instagram";
let latestPayload = null;
const SESSION_STORAGE_KEY = "instagram-sessionid";
const BATCH_SIZE_STORAGE_KEY = "batch-size";
const RETRY_COUNT_STORAGE_KEY = "retry-count";

function parseEntries(text) {
  return [
    ...new Set(
      text
        .split(/[\n,]/g)
        .map((x) => x.trim())
        .filter(Boolean)
    ),
  ];
}

function numberFormat(value) {
  if (typeof value === "string") return value;
  return new Intl.NumberFormat("id-ID").format(value);
}

function boolLabel(value) {
  if (value === true) return "Ya";
  if (value === false) return "Tidak";
  return "Unknown";
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function safeBatchSize() {
  const raw = Number(batchSizeInput.value || 50);
  return Math.max(1, Math.min(100, Math.floor(raw || 50)));
}

function safeRetryCount() {
  const raw = Number(retryCountInput.value || 2);
  return Math.max(0, Math.min(5, Math.floor(raw || 0)));
}

function updateProgress(currentBatch, totalBatches, currentAttempt, maxAttempts, label) {
  progressBox.classList.remove("hidden");
  const batchProgress = totalBatches > 0 ? currentBatch / totalBatches : 0;
  progressFill.style.width = `${Math.max(0, Math.min(100, Math.round(batchProgress * 100)))}%`;
  progressText.textContent = `${label} | Batch ${currentBatch}/${totalBatches} | Attempt ${currentAttempt}/${maxAttempts}`;
}

function hideProgress() {
  progressText.textContent = "Menyiapkan batch...";
  progressFill.style.width = "0%";
  progressBox.classList.add("hidden");
}

function endpointByPlatform(platform) {
  if (platform === "tiktok") return "/api/tiktok/followers";
  if (platform === "instagram-content") return "/api/instagram/content-views";
  if (platform === "tiktok-content") return "/api/tiktok/content-views";
  return "/api/followers";
}

function payloadKeyByPlatform(platform) {
  return platform === "instagram-content" || platform === "tiktok-content"
    ? "items"
    : "usernames";
}

function getSessionIdValue() {
  return String(sessionIdInput?.value || "").trim();
}

function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function convertResultsToCsv(payload) {
  const rows = payload?.results || [];
  if (!rows.length) return "status\n";

  const allKeys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const header = allKeys.join(",");
  const body = rows
    .map((row) =>
      allKeys
        .map((key) => {
          const value = row[key] == null ? "" : String(row[key]);
          const escaped = value.replace(/"/g, '""');
          return `"${escaped}"`;
        })
        .join(",")
    )
    .join("\n");

  return `${header}\n${body}\n`;
}

function setExportEnabled(enabled) {
  exportJsonBtn.disabled = !enabled;
  exportCsvBtn.disabled = !enabled;
}

function toggleSettingsPanel(forceOpen) {
  if (!settingsPanel || !settingsToggleBtn) return;
  const shouldOpen = typeof forceOpen === "boolean"
    ? forceOpen
    : settingsPanel.classList.contains("hidden");

  settingsPanel.classList.toggle("hidden", !shouldOpen);
  settingsToggleBtn.textContent = shouldOpen ? "Hide Settings" : "Settings";
}

function hasSessionExpiredSignal(payload) {
  if (payload?.requiresSessionRefresh) return true;
  return (payload?.results || []).some((item) => item?.code === "SESSION_EXPIRED");
}

function renderResult(payload) {
  resultEl.innerHTML = "";

  summaryEl.classList.remove("hidden");
  const sessionWarn = payload?.sessionExpired
    ? ` | Session expired: ${payload.sessionExpired}`
    : "";
  summaryEl.textContent = `Total: ${payload.total} | Berhasil: ${payload.success} | Gagal: ${payload.failed}${sessionWarn}`;

  payload.results.forEach((item) => {
    const card = document.createElement("article");
    card.className = `item ${item.status}`;

    if (item.status === "ok") {
      if (activePlatform === "instagram-content") {
        const ownerLabel = item.ownerUsername ? `@${item.ownerUsername}` : "Unknown";
        const viewsLabel = item.viewsAvailable
          ? numberFormat(item.views)
          : "Tidak tersedia (private/public limit)";
        card.innerHTML = `
          <strong>Shortcode: ${item.shortcode}</strong>
          <div class="meta">Views: <b>${viewsLabel}</b></div>
          <div class="meta">Likes: <b>${item.likes == null ? "Unknown" : numberFormat(item.likes)}</b> | Comments: <b>${item.comments == null ? "Unknown" : numberFormat(item.comments)}</b></div>
          <div class="meta">Owner: ${ownerLabel}</div>
          <div class="meta">URL: <a href="${item.url}" target="_blank" rel="noopener noreferrer">${item.url}</a></div>
        `;
      } else if (activePlatform === "tiktok-content") {
        const ownerLabel = item.username ? `@${item.username}` : "Unknown";
        card.innerHTML = `
          <strong>Video ID: ${item.videoId || "Unknown"}</strong>
          <div class="meta">Views: <b>${numberFormat(item.views)}</b></div>
          <div class="meta">Likes: <b>${numberFormat(item.likes)}</b> | Comments: <b>${numberFormat(item.comments)}</b> | Shares: <b>${numberFormat(item.shares)}</b></div>
          <div class="meta">Owner: ${ownerLabel} (${item.fullName || "-"})</div>
          <div class="meta">Title: ${item.title || "-"}</div>
          <div class="meta">URL: <a href="${item.url}" target="_blank" rel="noopener noreferrer">${item.url}</a></div>
        `;
      } else {
        const biographyText = item.biography || item.bio || "-";
        const profileOrBioUrl = item.url || "-";
        card.innerHTML = `
          <strong>@${item.username}</strong>
          <div class="meta">Nama: ${item.fullName}</div>
          <div class="meta">Biography: ${biographyText}</div>
          <div class="meta">URL: ${profileOrBioUrl === "-" ? "-" : `<a href="${profileOrBioUrl}" target="_blank" rel="noopener noreferrer">${profileOrBioUrl}</a>`}</div>
          <div class="meta">Followers: <b>${numberFormat(item.followers)}</b></div>
          <div class="meta">Private: ${boolLabel(item.isPrivate)} | Verified: ${boolLabel(item.isVerified)}</div>
        `;
      }
    } else if (activePlatform === "instagram-content" || activePlatform === "tiktok-content") {
      card.innerHTML = `
        <strong>Input: ${item.input}</strong>
        <div class="meta">Error: ${item.message}</div>
      `;
    } else {
      card.innerHTML = `
        <strong>@${item.username}</strong>
        <div class="meta">Error: ${item.message}</div>
      `;
    }

    resultEl.appendChild(card);
  });
}

function updatePlatformUI(platform) {
  activePlatform = platform;
  menuButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.platform === platform);
  });

  if (platform === "tiktok") {
    subtitleTextEl.textContent = "Masukkan list username atau URL profil TikTok (pisah baris atau koma).";
    usernamesInput.placeholder = "contoh:\nkhaby.lame\nhttps://www.tiktok.com/@tiktok";
    checkBtn.textContent = "Cek Followers";
    platformNoteEl.textContent = "Gunakan hanya untuk akun publik dan patuhi Terms TikTok.";
    return;
  }

  if (platform === "instagram-content") {
    subtitleTextEl.textContent = "Masukkan list URL/shortcode konten Instagram video/reel (pisah baris atau koma).";
    usernamesInput.placeholder = "contoh:\nhttps://www.instagram.com/reel/SHORTCODE/\nSHORTCODE";
    checkBtn.textContent = "Cek Views";
    platformNoteEl.textContent = "Gunakan hanya untuk konten publik. Views untuk konten non-video bisa tidak tersedia.";
    return;
  }

  if (platform === "tiktok-content") {
    subtitleTextEl.textContent = "Masukkan list URL video TikTok atau video ID (pisah baris atau koma).";
    usernamesInput.placeholder = "contoh:\nhttps://www.tiktok.com/@user/video/1234567890123456789\n1234567890123456789";
    checkBtn.textContent = "Cek Views";
    platformNoteEl.textContent = "Gunakan hanya untuk konten publik TikTok.";
    return;
  }

  subtitleTextEl.textContent = "Masukkan list username atau URL profil Instagram (pisah baris atau koma).";
  usernamesInput.placeholder = "contoh:\ncristiano\nhttps://www.instagram.com/natgeo/";
  checkBtn.textContent = "Cek Followers";
  platformNoteEl.textContent = "Gunakan hanya untuk akun publik dan patuhi Terms Instagram.";
}

async function fetchWithRetry(platform, chunk, batchIndex, totalBatches) {
  const maxAttempts = safeRetryCount() + 1;
  const endpoint = endpointByPlatform(platform);
  const key = payloadKeyByPlatform(platform);

  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    updateProgress(batchIndex, totalBatches, attempt, maxAttempts, "Memproses data");
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          [key]: chunk,
          sessionid: getSessionIdValue(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Gagal memproses request");
      }

      return data;
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
      }
    }
  }

  throw lastError || new Error("Unknown error");
}

async function runBatchedRequest(platform, entries) {
  const size = safeBatchSize();
  const chunks = chunkArray(entries, size);
  const combined = [];

  for (let i = 0; i < chunks.length; i++) {
    try {
      const data = await fetchWithRetry(platform, chunks[i], i + 1, chunks.length);
      combined.push(...(data.results || []));
    } catch (error) {
      const key = payloadKeyByPlatform(platform);
      const fallbackErrors = chunks[i].map((entry) => ({
        status: "error",
        ...(key === "items" ? { input: entry } : { username: entry }),
        message: `Gagal mengambil data (${error.message || "Batch gagal"})`,
      }));
      combined.push(...fallbackErrors);
    }
  }

  return {
    total: combined.length,
    success: combined.filter((r) => r.status === "ok").length,
    failed: combined.filter((r) => r.status === "error").length,
    results: combined,
  };
}

menuButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    updatePlatformUI(btn.dataset.platform);
  });
});

importFileBtn.addEventListener("click", () => {
  fileInput.click();
});

fileInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  const existing = usernamesInput.value.trim();
  usernamesInput.value = existing ? `${existing}\n${text}` : text;
  fileInput.value = "";
});

exportJsonBtn.addEventListener("click", () => {
  if (!latestPayload) return;
  downloadBlob(
    JSON.stringify(latestPayload, null, 2),
    `result-${activePlatform}-${Date.now()}.json`,
    "application/json"
  );
});

exportCsvBtn.addEventListener("click", () => {
  if (!latestPayload) return;
  downloadBlob(
    convertResultsToCsv(latestPayload),
    `result-${activePlatform}-${Date.now()}.csv`,
    "text/csv;charset=utf-8"
  );
});

if (sessionIdInput) {
  const savedSession = localStorage.getItem(SESSION_STORAGE_KEY);
  if (savedSession) {
    sessionIdInput.value = savedSession;
  }
  sessionIdInput.addEventListener("input", () => {
    localStorage.setItem(SESSION_STORAGE_KEY, getSessionIdValue());
  });
}

if (batchSizeInput) {
  const savedBatchSize = localStorage.getItem(BATCH_SIZE_STORAGE_KEY);
  if (savedBatchSize) batchSizeInput.value = savedBatchSize;
  batchSizeInput.addEventListener("input", () => {
    localStorage.setItem(BATCH_SIZE_STORAGE_KEY, String(batchSizeInput.value || ""));
  });
}

if (retryCountInput) {
  const savedRetryCount = localStorage.getItem(RETRY_COUNT_STORAGE_KEY);
  if (savedRetryCount) retryCountInput.value = savedRetryCount;
  retryCountInput.addEventListener("input", () => {
    localStorage.setItem(RETRY_COUNT_STORAGE_KEY, String(retryCountInput.value || ""));
  });
}

if (settingsToggleBtn) {
  settingsToggleBtn.addEventListener("click", () => {
    toggleSettingsPanel();
  });
}

updatePlatformUI(activePlatform);
setExportEnabled(false);
toggleSettingsPanel(false);

checkBtn.addEventListener("click", async () => {
  const entries = parseEntries(usernamesInput.value);

  if (!entries.length) {
    alert("Masukkan minimal 1 input.");
    return;
  }

  checkBtn.disabled = true;
  importFileBtn.disabled = true;
  if (settingsToggleBtn) settingsToggleBtn.disabled = true;
  if (sessionIdInput) sessionIdInput.disabled = true;
  batchSizeInput.disabled = true;
  retryCountInput.disabled = true;
  setExportEnabled(false);

  const prevText = checkBtn.textContent;
  checkBtn.textContent = "Sedang ambil data...";
  resultEl.innerHTML = "";
  summaryEl.classList.add("hidden");

  try {
    const payload = await runBatchedRequest(activePlatform, entries);
    latestPayload = payload;
    renderResult(payload);
    if (hasSessionExpiredSignal(payload)) {
      alert("Session Instagram kamu sudah expired. Silakan update sessionid lalu coba lagi.");
    }
    setExportEnabled(Boolean(payload.results?.length));
  } catch (err) {
    alert(err.message || "Terjadi kesalahan");
  } finally {
    checkBtn.disabled = false;
    importFileBtn.disabled = false;
    if (settingsToggleBtn) settingsToggleBtn.disabled = false;
    if (sessionIdInput) sessionIdInput.disabled = false;
    batchSizeInput.disabled = false;
    retryCountInput.disabled = false;
    checkBtn.textContent = prevText;
    hideProgress();
  }
});
