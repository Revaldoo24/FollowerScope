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
const saveSessionBtn = document.getElementById("saveSessionBtn");
const batchSizeInput = document.getElementById("batchSizeInput");
const retryCountInput = document.getElementById("retryCountInput");
const delayMsInput = document.getElementById("delayMsInput");
const jitterMsInput = document.getElementById("jitterMsInput");
const progressBox = document.getElementById("progressBox");
const progressText = document.getElementById("progressText");
const progressFill = document.getElementById("progressFill");
const exportJsonBtn = document.getElementById("exportJsonBtn");
const exportCsvBtn = document.getElementById("exportCsvBtn");
const exportExcelBtn = document.getElementById("exportExcelBtn");
const importMapModal = document.getElementById("importMapModal");
const inputColumnSelect = document.getElementById("inputColumnSelect");
const labelColumnSelect = document.getElementById("labelColumnSelect");
const applyImportMapBtn = document.getElementById("applyImportMapBtn");
const cancelImportMapBtn = document.getElementById("cancelImportMapBtn");

let activePlatform = "instagram";
let latestPayload = null;
let importedTableContext = null;
let pendingImportedTable = null;
const SESSION_STORAGE_KEY = "instagram-sessionid";
const BATCH_SIZE_STORAGE_KEY = "batch-size";
const RETRY_COUNT_STORAGE_KEY = "retry-count";
const DELAY_MS_STORAGE_KEY = "delay-ms";
const JITTER_MS_STORAGE_KEY = "jitter-ms";

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

function safeDelayMs() {
  const raw = Number(delayMsInput?.value || 1200);
  return Math.max(0, Math.min(10000, Math.floor(raw || 0)));
}

function safeJitterMs() {
  const raw = Number(jitterMsInput?.value || 800);
  return Math.max(0, Math.min(5000, Math.floor(raw || 0)));
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

// Endpoint single — 1 akun per request, aman untuk Vercel (< 3 detik)
function singleEndpointByPlatform(platform) {
  if (platform === "instagram") return "/api/followers/single";
  return null; // platform lain tidak pakai single
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

function parseFileName(fileName) {
  const parts = String(fileName || "").split(".");
  if (parts.length <= 1) return { base: fileName || "result", ext: "" };
  const ext = parts.pop().toLowerCase();
  return { base: parts.join(".") || "result", ext };
}

function mapMetricValue(item) {
  if (!item || item.status !== "ok") return "";
  if (activePlatform === "instagram-content") return item.viewsAvailable ? item.views : "";
  if (activePlatform === "tiktok-content") return item.views;
  return item.followers;
}

function mapMetricHeader() {
  if (activePlatform === "instagram-content" || activePlatform === "tiktok-content") return "views";
  return "followers";
}

function mapResultInputKey() {
  return activePlatform === "instagram-content" || activePlatform === "tiktok-content"
    ? "input"
    : "username";
}

function normalizedCompareValue(value) {
  return String(value || "").trim().toLowerCase();
}

function extractComparableInputByPlatform(value, platform) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  if (platform === "instagram") {
    const direct = raw.replace(/^@/, "").trim();
    if (/^[a-zA-Z0-9._]{1,30}$/.test(direct)) return direct.toLowerCase();
    const urlMatch = raw.match(/instagram\.com\/([a-zA-Z0-9._]{1,30})\/?/i);
    if (!urlMatch) return normalizedCompareValue(raw);
    const reserved = new Set(["reel", "p", "tv", "explore", "accounts"]);
    const candidate = urlMatch[1].toLowerCase();
    if (reserved.has(candidate)) return normalizedCompareValue(raw);
    return candidate;
  }

  if (platform === "tiktok") {
    const direct = raw.replace(/^@/, "").trim();
    if (/^[a-zA-Z0-9._]{1,30}$/.test(direct)) return direct.toLowerCase();
    const urlMatch = raw.match(/tiktok\.com\/@([a-zA-Z0-9._]{1,30})/i);
    return urlMatch?.[1]?.toLowerCase() || normalizedCompareValue(raw);
  }

  if (platform === "instagram-content") {
    const shortcodeFromUrl = raw.match(/instagram\.com\/(?:reel|p|tv)\/([a-zA-Z0-9_-]{5,})/i)?.[1];
    const shortcode = shortcodeFromUrl || raw;
    return normalizedCompareValue(shortcode);
  }

  if (platform === "tiktok-content") {
    const idFromUrl = raw.match(/tiktok\.com\/@[^/]+\/video\/(\d{10,25})/i)?.[1];
    const videoId = idFromUrl || raw;
    return normalizedCompareValue(videoId);
  }

  return normalizedCompareValue(raw);
}

function convertResultsToExcelRows(payload) {
  if (!importedTableContext?.headers?.length || !importedTableContext?.rows?.length) {
    return payload?.results || [];
  }

  const metricHeader = mapMetricHeader();
  const resultInputKey = mapResultInputKey();
  const inputHeader = importedTableContext.inputHeader;
  const labelHeader = importedTableContext.labelHeader;
  const headers = [...importedTableContext.headers];
  const inputHeaderIndex = Math.max(0, headers.indexOf(inputHeader));
  const insertedHeaders = [metricHeader, "status", "message"];
  headers.splice(inputHeaderIndex + 1, 0, ...insertedHeaders);

  const groupedResults = new Map();
  (payload?.results || []).forEach((item) => {
    const key = extractComparableInputByPlatform(item?.[resultInputKey], activePlatform);
    if (!key) return;
    if (!groupedResults.has(key)) groupedResults.set(key, []);
    groupedResults.get(key).push(item);
  });

  return importedTableContext.rows.map((row) => {
    const rowInputRaw = row[inputHeader];
    const rowKey = extractComparableInputByPlatform(rowInputRaw, activePlatform);
    const group = groupedResults.get(rowKey) || [];
    const matched = group.length ? group.shift() : null;

    const baseRow = {};
    headers.forEach((header) => {
      baseRow[header] = "";
    });

    importedTableContext.headers.forEach((header) => {
      baseRow[header] = row[header] ?? "";
    });

    baseRow[metricHeader] = mapMetricValue(matched);
    baseRow.status = matched?.status || "not_found";
    baseRow.message = matched?.message || "";

    if (labelHeader && !baseRow[labelHeader]) {
      baseRow[labelHeader] = row[labelHeader] ?? "";
    }

    return baseRow;
  });
}

function exportResultToExcel(payload) {
  if (!window.XLSX) {
    alert("Library Excel belum siap. Refresh halaman lalu coba lagi.");
    return;
  }

  const rows = convertResultsToExcelRows(payload);
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Result");
  XLSX.writeFile(wb, `result-${activePlatform}-${Date.now()}.xlsx`);
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
  if (exportExcelBtn) exportExcelBtn.disabled = !enabled;
}

function toggleSettingsPanel(forceOpen) {
  if (!settingsPanel || !settingsToggleBtn) return;
  const shouldOpen = typeof forceOpen === "boolean"
    ? forceOpen
    : settingsPanel.classList.contains("hidden");

  settingsPanel.classList.toggle("hidden", !shouldOpen);
  settingsToggleBtn.textContent = shouldOpen ? "Hide Settings" : "Settings";
}

function closeImportMapModal() {
  if (!importMapModal) return;
  importMapModal.classList.add("hidden");
  importMapModal.setAttribute("aria-hidden", "true");
}

function openImportMapModal(headers) {
  if (!importMapModal || !inputColumnSelect || !labelColumnSelect) return;
  inputColumnSelect.innerHTML = "";
  labelColumnSelect.innerHTML = "";

  headers.forEach((header) => {
    const inputOpt = document.createElement("option");
    inputOpt.value = header;
    inputOpt.textContent = header;
    inputColumnSelect.appendChild(inputOpt);

    const labelOpt = document.createElement("option");
    labelOpt.value = header;
    labelOpt.textContent = header;
    labelColumnSelect.appendChild(labelOpt);
  });

  const noneOpt = document.createElement("option");
  noneOpt.value = "";
  noneOpt.textContent = "(Tanpa kolom label)";
  labelColumnSelect.prepend(noneOpt);
  labelColumnSelect.value = "";

  const suggestedInput = headers.find((h) => /username|user|link|url|ig|tiktok|input/i.test(h));
  if (suggestedInput) inputColumnSelect.value = suggestedInput;
  const suggestedLabel = headers.find((h) => /nama|name|label/i.test(h));
  if (suggestedLabel) labelColumnSelect.value = suggestedLabel;

  importMapModal.classList.remove("hidden");
  importMapModal.setAttribute("aria-hidden", "false");
}

function parseSpreadsheetFile(file, buffer) {
  if (!window.XLSX) throw new Error("Library Excel tidak tersedia");
  const workbook = XLSX.read(buffer, { type: "array" });
  const firstSheet = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheet];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  const headers = rows.length ? Object.keys(rows[0]) : [];
  return { rows, headers };
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

async function fetchSingleInstagram(username, attempt, total) {
  const maxAttempts = safeRetryCount() + 1;
  let lastError = null;

  for (let try_ = 1; try_ <= maxAttempts; try_++) {
    updateProgress(attempt, total, try_, maxAttempts, `@${username}`);
    try {
      const res = await fetch("/api/followers/single", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          sessionid: getSessionIdValue(),
        }),
      });
      const data = await res.json();
      return data;
    } catch (err) {
      lastError = err;
      if (try_ < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 400 * try_));
      }
    }
  }

  return {
    status: "error",
    username,
    message: `Gagal mengambil data (${lastError?.message || "Network error"})`,
  };
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
          throttleMs: safeDelayMs(),
          jitterMs: safeJitterMs(),
          retryCount: safeRetryCount(),
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
  const combined = [];

  // ✅ Instagram: 1 akun per request ke /api/followers/single
  // Delay dilakukan di frontend → tidak ada timeout di Vercel
  if (platform === "instagram") {
    const delayMs = safeDelayMs();
    const jitterMs = safeJitterMs();

    for (let i = 0; i < entries.length; i++) {
      const result = await fetchSingleInstagram(entries[i], i + 1, entries.length);
      combined.push(result);

      // Delay antar request (kecuali yang terakhir)
      if (i < entries.length - 1 && delayMs > 0) {
        const jitter = jitterMs > 0 ? Math.floor(Math.random() * (jitterMs + 1)) : 0;
        await new Promise((resolve) => setTimeout(resolve, delayMs + jitter));
      }
    }

    return {
      total: combined.length,
      success: combined.filter((r) => r.status === "ok").length,
      failed: combined.filter((r) => r.status === "error").length,
      sessionExpired: combined.filter((r) => r.code === "SESSION_EXPIRED").length,
      requiresSessionRefresh: combined.some((r) => r.code === "SESSION_EXPIRED"),
      results: combined,
    };
  }

  // ✅ TikTok followers & content views: 1 item per request, delay 500ms (= 2/detik)
  // tikwm.com membatasi ~2 request/detik, lebih dari itu kena rate limit
  if (platform === "tiktok" || platform === "tiktok-content") {
    const TIKTOK_DELAY_MS = 500; // 2 request per detik
    const endpoint = endpointByPlatform(platform);
    const key = payloadKeyByPlatform(platform);
    const maxAttempts = safeRetryCount() + 1;

    for (let i = 0; i < entries.length; i++) {
      updateProgress(i + 1, entries.length, 1, maxAttempts, entries[i]);
      let result = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        updateProgress(i + 1, entries.length, attempt, maxAttempts, entries[i]);
        try {
          const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              [key]: [entries[i]], // kirim 1 item saja
              retryCount: 0,       // retry ditangani di sini
            }),
          });
          const data = await res.json();
          if (data.results?.[0]) {
            result = data.results[0];
            break;
          }
        } catch (_) {
          if (attempt < maxAttempts) {
            await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
          }
        }
      }

      combined.push(result || {
        status: "error",
        ...(key === "items" ? { input: entries[i] } : { username: entries[i] }),
        message: "Gagal mengambil data",
      });

      // Delay 500ms antar request = 2 per detik (kecuali yang terakhir)
      if (i < entries.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, TIKTOK_DELAY_MS));
      }
    }

    return {
      total: combined.length,
      success: combined.filter((r) => r.status === "ok").length,
      failed: combined.filter((r) => r.status === "error").length,
      results: combined,
    };
  }


  // Platform lain (TikTok, content views): tetap pakai batch ke server
  const size = safeBatchSize();
  const chunks = chunkArray(entries, size);

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
  try {
    const { ext } = parseFileName(file.name);
    const isSheet = ext === "xlsx" || ext === "xls";
    const isCsv = ext === "csv";

    if (isSheet || isCsv) {
      const buffer = await file.arrayBuffer();
      const parsed = parseSpreadsheetFile(file, buffer);

      if (!parsed.rows.length || !parsed.headers.length) {
        alert("File kosong atau tidak memiliki header.");
        fileInput.value = "";
        return;
      }

      pendingImportedTable = {
        fileName: file.name,
        rows: parsed.rows,
        headers: parsed.headers,
      };
      openImportMapModal(parsed.headers);
      fileInput.value = "";
      return;
    }

    const text = await file.text();
    importedTableContext = null;
    const existing = usernamesInput.value.trim();
    usernamesInput.value = existing ? `${existing}\n${text}` : text;
    fileInput.value = "";
  } catch (error) {
    alert(error.message || "Gagal membaca file");
    fileInput.value = "";
  }
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

if (exportExcelBtn) {
  exportExcelBtn.addEventListener("click", () => {
    if (!latestPayload) return;
    exportResultToExcel(latestPayload);
  });
}

if (applyImportMapBtn) {
  applyImportMapBtn.addEventListener("click", () => {
    if (!pendingImportedTable) return;
    const selectedInputHeader = inputColumnSelect?.value;
    const selectedLabelHeader = labelColumnSelect?.value || "";
    if (!selectedInputHeader) {
      alert("Pilih kolom input dulu.");
      return;
    }

    const extractedInputs = pendingImportedTable.rows
      .map((row) => String(row[selectedInputHeader] || "").trim())
      .filter(Boolean);

    if (!extractedInputs.length) {
      alert("Kolom input kosong.");
      return;
    }

    importedTableContext = {
      fileName: pendingImportedTable.fileName,
      headers: pendingImportedTable.headers,
      rows: pendingImportedTable.rows,
      inputHeader: selectedInputHeader,
      labelHeader: selectedLabelHeader,
    };

    usernamesInput.value = extractedInputs.join("\n");
    pendingImportedTable = null;
    closeImportMapModal();
  });
}

if (cancelImportMapBtn) {
  cancelImportMapBtn.addEventListener("click", () => {
    pendingImportedTable = null;
    closeImportMapModal();
  });
}

if (sessionIdInput) {
  const savedSession = localStorage.getItem(SESSION_STORAGE_KEY);
  if (savedSession) {
    sessionIdInput.value = savedSession;
  }
  sessionIdInput.addEventListener("input", () => {
    // user can type freely, explicit save via button below
  });
}

if (saveSessionBtn) {
  saveSessionBtn.addEventListener("click", () => {
    localStorage.setItem(SESSION_STORAGE_KEY, getSessionIdValue());
    alert("Session ID disimpan.");
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

if (delayMsInput) {
  const savedDelayMs = localStorage.getItem(DELAY_MS_STORAGE_KEY);
  if (savedDelayMs) delayMsInput.value = savedDelayMs;
  delayMsInput.addEventListener("input", () => {
    localStorage.setItem(DELAY_MS_STORAGE_KEY, String(delayMsInput.value || ""));
  });
}

if (jitterMsInput) {
  const savedJitterMs = localStorage.getItem(JITTER_MS_STORAGE_KEY);
  if (savedJitterMs) jitterMsInput.value = savedJitterMs;
  jitterMsInput.addEventListener("input", () => {
    localStorage.setItem(JITTER_MS_STORAGE_KEY, String(jitterMsInput.value || ""));
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
  if (saveSessionBtn) saveSessionBtn.disabled = true;
  if (sessionIdInput) sessionIdInput.disabled = true;
  batchSizeInput.disabled = true;
  retryCountInput.disabled = true;
  if (delayMsInput) delayMsInput.disabled = true;
  if (jitterMsInput) jitterMsInput.disabled = true;
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
    if (saveSessionBtn) saveSessionBtn.disabled = false;
    if (sessionIdInput) sessionIdInput.disabled = false;
    batchSizeInput.disabled = false;
    retryCountInput.disabled = false;
    if (delayMsInput) delayMsInput.disabled = false;
    if (jitterMsInput) jitterMsInput.disabled = false;
    checkBtn.textContent = prevText;
    hideProgress();
  }
});
