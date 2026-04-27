const express = require("express");
const cors = require("cors");
const axios = require("axios");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const USERNAME_PATTERN = /^[a-zA-Z0-9._]{1,30}$/;

function extractProfileUsername(rawInput, platform) {
  const input = String(rawInput || "").trim();
  if (!input) return null;

  const plain = input.replace(/^@/, "").trim();
  if (USERNAME_PATTERN.test(plain)) return plain;

  const firstUrl = input.match(/https?:\/\/[^\s]+/i)?.[0];
  if (!firstUrl) return null;

  let url;
  try {
    url = new URL(firstUrl);
  } catch (_) {
    return null;
  }

  const hostname = url.hostname.toLowerCase();
  const pathSegments = url.pathname.split("/").filter(Boolean);
  if (!pathSegments.length) return null;

  if (platform === "instagram") {
    if (!hostname.includes("instagram.com")) return null;
    const reserved = new Set([
      "reel",
      "p",
      "tv",
      "explore",
      "accounts",
      "about",
      "developer",
      "legal",
      "api",
      "oauth",
      "direct",
      "stories",
    ]);
    const candidate = pathSegments[0].replace(/^@/, "");
    if (reserved.has(candidate.toLowerCase())) return null;
    return USERNAME_PATTERN.test(candidate) ? candidate : null;
  }

  if (platform === "tiktok") {
    if (!hostname.includes("tiktok.com")) return null;
    const first = pathSegments[0];
    const candidate = (first.startsWith("@") ? first.slice(1) : first).trim();
    if (!candidate || ["tag", "discover", "music", "video"].includes(candidate.toLowerCase())) {
      return null;
    }
    return USERNAME_PATTERN.test(candidate) ? candidate : null;
  }

  return null;
}

function normalizeUsernames(input, platform) {
  if (!Array.isArray(input)) return [];

  const cleaned = input
    .map((v) => extractProfileUsername(v, platform))
    .filter(Boolean)
    .filter((v) => USERNAME_PATTERN.test(v));

  return [...new Set(cleaned)];
}

function normalizeContentInputs(input) {
  if (!Array.isArray(input)) return [];

  const cleaned = input
    .map((v) => String(v || "").trim())
    .filter(Boolean);

  return [...new Set(cleaned)];
}

function extractTikTokVideoInput(rawInput) {
  const input = String(rawInput || "").trim();
  if (!input) return null;

  const urlMatch = input.match(/https?:\/\/[^\s]+/i);
  if (urlMatch && /tiktok\.com/i.test(urlMatch[0])) {
    return { url: urlMatch[0], videoId: null };
  }

  if (/^\d{10,25}$/.test(input)) {
    return {
      url: `https://www.tiktok.com/@placeholder/video/${input}`,
      videoId: input,
    };
  }

  return null;
}

function extractInstagramShortcode(rawInput) {
  const input = String(rawInput || "").trim();
  const urlMatch = input.match(/instagram\.com\/(reel|p|tv)\/([a-zA-Z0-9_-]{5,})/i);
  if (urlMatch) {
    return { shortcode: urlMatch[2], pathType: urlMatch[1].toLowerCase() };
  }

  if (/^[a-zA-Z0-9_-]{5,}$/.test(input)) {
    return { shortcode: input, pathType: null };
  }

  return null;
}

function parseAbbrevNumber(value) {
  if (!value) return null;
  const raw = String(value).trim().toUpperCase().replace(/\s+/g, "");
  const unit = raw.slice(-1);
  const hasUnit = ["K", "M", "B"].includes(unit);
  let normalized = raw;
  if (hasUnit) {
    normalized = raw.slice(0, -1);
    if (normalized.includes(",") && !normalized.includes(".")) {
      normalized = normalized.replace(",", ".");
    } else {
      normalized = normalized.replace(/,/g, "");
    }
    normalized = `${normalized}${unit}`;
  } else {
    normalized = raw.replace(/,/g, "");
  }
  const matched = normalized.match(/^(\d+(?:\.\d+)?)([KMB])?$/);
  if (!matched) return null;
  const num = Number(matched[1]);
  if (!Number.isFinite(num)) return null;
  const suffix = matched[2];
  if (suffix === "K") return Math.round(num * 1_000);
  if (suffix === "M") return Math.round(num * 1_000_000);
  if (suffix === "B") return Math.round(num * 1_000_000_000);
  return Math.round(num);
}

function isInstagramLoginPage(html) {
  const text = String(html || "");
  if (!text) return false;
  return (
    /instagram\.com\/accounts\/login/i.test(text) ||
    /<title>\s*(Log in|Masuk)\s*[|.-]\s*Instagram/i.test(text) ||
    /name=["']username["']/i.test(text)
  );
}

function decodeJsonEscapedString(value) {
  const raw = String(value || "");
  try {
    return JSON.parse(`"${raw.replace(/"/g, '\\"')}"`);
  } catch (_) {
    return raw
      .replace(/\\n/g, "\n")
      .replace(/\\u0026/gi, "&")
      .replace(/\\"/g, '"');
  }
}

function extractJsonStringField(html, fieldName) {
  const pattern = new RegExp(`"${fieldName}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, "i");
  const match = String(html || "").match(pattern);
  if (!match?.[1]) return "";
  return decodeJsonEscapedString(match[1]).trim();
}

function extractInstagramBioLinkUrl(html) {
  const match = String(html || "").match(
    /"bio_links"\s*:\s*\[\s*\{[\s\S]*?"url"\s*:\s*"((?:\\.|[^"\\])*)"/i
  );
  if (!match?.[1]) return "";
  return decodeJsonEscapedString(match[1]).trim();
}

function resolveInstagramSessionId(rawSessionId) {
  return String(rawSessionId || "").trim();
}

function getInstagramCookieHeader(sessionId) {
  if (!sessionId) return undefined;
  return `sessionid=${sessionId};`;
}

function findMediaByShortcodeInGraphql(payload, shortcode) {
  if (!payload || typeof payload !== "object") return null;

  if (
    payload.media &&
    typeof payload.media === "object" &&
    payload.media.code === shortcode
  ) {
    return payload.media;
  }

  for (const value of Object.values(payload)) {
    if (value && typeof value === "object") {
      const found = findMediaByShortcodeInGraphql(value, shortcode);
      if (found) return found;
    }
  }

  return null;
}

function findInstagramUserInGraphql(payload, targetUsername) {
  if (!payload || typeof payload !== "object") return null;
  const normalizedTarget = String(targetUsername || "").toLowerCase();

  if (
    typeof payload.username === "string" &&
    payload.username.toLowerCase() === normalizedTarget &&
    (payload.biography !== undefined ||
      payload.external_url !== undefined ||
      payload.follower_count !== undefined ||
      payload.edge_followed_by?.count !== undefined)
  ) {
    return payload;
  }

  for (const value of Object.values(payload)) {
    if (value && typeof value === "object") {
      const found = findInstagramUserInGraphql(value, targetUsername);
      if (found) return found;
    }
  }

  return null;
}

function normalizeInstagramFollowerResult(user, fallbackUsername) {
  if (!user || typeof user !== "object") return null;
  const username = user.username || fallbackUsername;
  const followers =
    user?.edge_followed_by?.count ??
    user?.follower_count ??
    user?.followers ??
    null;
  if (typeof followers !== "number" || !Number.isFinite(followers)) return null;

  const biographyText = String(user.biography || user.bio || "").trim() || "-";
  const externalUrl =
    (typeof user.external_url === "string" && user.external_url.trim()) ||
    (Array.isArray(user.bio_links) && user.bio_links[0]?.url ? String(user.bio_links[0].url).trim() : "") ||
    `https://www.instagram.com/${username}/`;

  return {
    username,
    fullName: user.full_name || "-",
    bio: biographyText,
    biography: biographyText,
    url: externalUrl,
    isPrivate: user.is_private == null ? null : Boolean(user.is_private),
    isVerified: user.is_verified == null ? null : Boolean(user.is_verified),
    followers,
  };
}

async function fetchInstagramProfileFromRenderedGraphql(username, sessionId) {
  if (!sessionId) return null;
  let chromium = null;
  try {
    ({ chromium } = require("playwright"));
  } catch (_) {
    return null;
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await context.addCookies([
      {
        name: "sessionid",
        value: sessionId,
        domain: ".instagram.com",
        path: "/",
        httpOnly: true,
        secure: true,
      },
    ]);

    const page = await context.newPage();
    let graphqlUser = null;
    page.on("response", async (response) => {
      try {
        if (!response.url().includes("/graphql/query")) return;
        const raw = await response.text();
        if (!raw || !raw.includes(username)) return;
        const body = JSON.parse(raw);
        const user = findInstagramUserInGraphql(body, username);
        if (user) graphqlUser = user;
      } catch (_) {
        // Ignore malformed/non-JSON responses
      }
    });

    await page.goto(`https://www.instagram.com/${encodeURIComponent(username)}/`, {
      waitUntil: "domcontentloaded",
      timeout: 25000,
    });
    await page.waitForTimeout(4500);

    return normalizeInstagramFollowerResult(graphqlUser, username);
  } catch (_) {
    return null;
  } finally {
    await browser.close();
  }
}

async function fetchInstagramViewsFromRenderedDom(url, shortcode, sessionId) {
  if (!sessionId) return null;
  let chromium = null;
  try {
    ({ chromium } = require("playwright"));
  } catch (_) {
    return null;
  }

  const browser = await chromium.launch({ headless: true });
  try {
    try {
      const context = await browser.newContext();
      await context.addCookies([
        {
          name: "sessionid",
          value: sessionId,
          domain: ".instagram.com",
          path: "/",
          httpOnly: true,
          secure: true,
        },
      ]);

      const page = await context.newPage();
      let graphqlMedia = null;

      page.on("response", async (response) => {
        try {
          if (!response.url().includes("/graphql/query")) return;
          const raw = await response.text();
          if (!raw) return;
          let body = null;
          try {
            body = JSON.parse(raw);
          } catch (_) {
            return;
          }
          const media = findMediaByShortcodeInGraphql(body, shortcode);
          if (media) graphqlMedia = media;
        } catch (_) {
          // Ignore parse/network errors from non-JSON responses.
        }
      });

      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
      await page.waitForTimeout(4500);

      if (graphqlMedia) {
        const viewsFromGraphql =
          graphqlMedia.play_count ?? graphqlMedia.video_view_count ?? graphqlMedia.view_count ?? null;
        const likesFromGraphql = graphqlMedia.like_count ?? null;
        const commentsFromGraphql = graphqlMedia.comment_count ?? null;

        if (typeof viewsFromGraphql === "number") {
          return {
            views: viewsFromGraphql,
            likes: typeof likesFromGraphql === "number" ? likesFromGraphql : null,
            comments: typeof commentsFromGraphql === "number" ? commentsFromGraphql : null,
          };
        }
      }

      const text = await page.locator("body").innerText();
      const match = text.match(/([\d.,]+[KMB]?)\s*(views|plays|tayangan|ditonton)/i);
      if (!match) return null;
      return { views: parseAbbrevNumber(match[1]), likes: null, comments: null };
    } catch (_) {
      // Do not fail the whole request if Playwright hits timeout/challenge.
      return null;
    }
  } finally {
    await browser.close();
  }
}

async function fetchInstagramViewsFromUserReelsGraphql(ownerUsername, shortcode, sessionId) {
  if (!sessionId || !ownerUsername) return null;
  let chromium = null;
  try {
    ({ chromium } = require("playwright"));
  } catch (_) {
    return null;
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await context.addCookies([
      {
        name: "sessionid",
        value: sessionId,
        domain: ".instagram.com",
        path: "/",
        httpOnly: true,
        secure: true,
      },
    ]);

    const page = await context.newPage();
    let graphqlMedia = null;
    page.on("response", async (response) => {
      try {
        if (!response.url().includes("/graphql/query")) return;
        const raw = await response.text();
        if (!raw || !raw.includes(shortcode)) return;
        let body = null;
        try {
          body = JSON.parse(raw);
        } catch (_) {
          return;
        }
        const media = findMediaByShortcodeInGraphql(body, shortcode);
        if (media) graphqlMedia = media;
      } catch (_) {
        // Ignore
      }
    });

    await page.goto(`https://www.instagram.com/${ownerUsername}/reels/`, {
      waitUntil: "domcontentloaded",
      timeout: 25000,
    });
    await page.waitForTimeout(5000);

    if (!graphqlMedia) return null;
    const views =
      graphqlMedia.play_count ?? graphqlMedia.video_view_count ?? graphqlMedia.view_count ?? null;
    if (typeof views !== "number") return null;
    return {
      views,
      likes: typeof graphqlMedia.like_count === "number" ? graphqlMedia.like_count : null,
      comments: typeof graphqlMedia.comment_count === "number" ? graphqlMedia.comment_count : null,
    };
  } catch (_) {
    return null;
  } finally {
    await browser.close();
  }
}

async function fetchFollowersByUsername(username, sessionId) {
  const endpoint = `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;

  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "X-IG-App-ID": "936619743392459",
    Accept: "application/json",
    ...(getInstagramCookieHeader(sessionId) ? { Cookie: getInstagramCookieHeader(sessionId) } : {}),
  };

  try {
    const response = await axios.get(endpoint, {
      headers,
      timeout: 15000,
    });

    const user = response?.data?.data?.user;
    const normalized = normalizeInstagramFollowerResult(user, username);
    if (!normalized) {
      throw new Error("Data user tidak ditemukan");
    }
    return normalized;
  } catch (_) {
    if (sessionId) {
      const renderedGraphqlData = await fetchInstagramProfileFromRenderedGraphql(username, sessionId);
      if (renderedGraphqlData) return renderedGraphqlData;
    }

    const profileUrl = `https://www.instagram.com/${encodeURIComponent(username)}/`;
    const htmlRes = await axios.get(profileUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "text/html",
      },
      timeout: 15000,
      validateStatus: () => true,
    });

    if (htmlRes.status === 404) {
      throw new Error("Username tidak ditemukan");
    }

    if (htmlRes.status >= 400) {
      throw new Error("Gagal mengambil profil");
    }

    const html = String(htmlRes.data || "");
    const ogMetaMatch = html.match(/<meta[^>]+(?:property|name)=["']og:description["'][^>]*>/i);
    const ogDescriptionMatch = ogMetaMatch?.[0]?.match(/content=["']([^"']+)["']/i);
    const ogDescription = ogDescriptionMatch?.[1] || "";
    const followersReadable = ogDescription.split(",")[0]?.trim();
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    const canonicalUsernameMatch = html.match(/@([a-zA-Z0-9._]{1,30})\)/);
    const fullNameFromDescMatch = ogDescription.match(/from\s+(.+?)\s+\(&#064;/i);
    const bioFromDescMatch = ogDescription.match(/on Instagram:\s*"([^"]*)"/i);
    const biographyFromJson = extractJsonStringField(html, "biography");
    const externalUrlFromJson = extractJsonStringField(html, "external_url");
    const bioLinkUrlFromJson = extractInstagramBioLinkUrl(html);

    if (!followersReadable) {
      throw new Error("Followers count tidak tersedia");
    }

    const biographyText = biographyFromJson || bioFromDescMatch?.[1]?.trim() || "-";
    const externalUrl = externalUrlFromJson || bioLinkUrlFromJson || profileUrl;

    return {
      username: (canonicalUsernameMatch?.[1] || username).replace(/^@/, ""),
      fullName: fullNameFromDescMatch?.[1] || titleMatch?.[1]?.split("(@")[0]?.trim() || "-",
      bio: biographyText,
      biography: biographyText,
      url: externalUrl,
      isPrivate: null,
      isVerified: null,
      followers: parseAbbrevNumber(followersReadable.replace(/\s*Followers$/i, "")) || followersReadable,
    };
  }
}

async function fetchTikTokFollowersByUsername(username) {
  const endpoint = "https://www.tikwm.com/api/user/info";
  const response = await axios.get(endpoint, {
    params: { unique_id: username },
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json",
    },
    timeout: 15000,
    validateStatus: () => true,
  });

  if (response.status >= 400) {
    throw new Error("Gagal mengambil profil TikTok");
  }

  const body = response.data || {};
  if (body.code !== 0 || !body.data?.user || !body.data?.stats) {
    throw new Error("Username tidak ditemukan");
  }

  const user = body.data.user;
  const stats = body.data.stats;

  return {
    username: user.uniqueId || username,
    fullName: user.nickname || "-",
    bio: user.signature || "-",
    biography: user.signature || "-",
    url: user.bioLink?.link || user.bio_link || `https://www.tiktok.com/@${user.uniqueId || username}`,
    isPrivate: null,
    isVerified: Boolean(user.verified),
    followers: Number(stats.followerCount || 0),
  };
}

async function fetchTikTokContentViews(contentInput) {
  const extracted = extractTikTokVideoInput(contentInput);
  if (!extracted) {
    throw new Error("Input harus berupa URL video TikTok atau video ID yang valid");
  }

  const response = await axios.get("https://www.tikwm.com/api/", {
    params: { url: extracted.url },
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json",
    },
    timeout: 20000,
    validateStatus: () => true,
  });

  if (response.status >= 400) {
    throw new Error("Gagal mengambil data TikTok");
  }

  const body = response.data || {};
  if (body.code !== 0 || !body.data) {
    throw new Error(body.msg || "Video tidak ditemukan");
  }

  const data = body.data;
  const author = data.author || {};

  return {
    input: contentInput,
    videoId: data.id || extracted.videoId || null,
    url: extracted.url,
    username: author.unique_id || null,
    fullName: author.nickname || "-",
    views: Number(data.play_count || 0),
    likes: Number(data.digg_count || 0),
    comments: Number(data.comment_count || 0),
    shares: Number(data.share_count || 0),
    title: data.title || "",
  };
}

async function fetchInstagramContentViews(contentInput, sessionId) {
  const extracted = extractInstagramShortcode(contentInput);
  if (!extracted) {
    throw new Error("Input harus berupa URL/shortcode Instagram yang valid");
  }
  const { shortcode } = extracted;

  const candidatePaths = extracted.pathType ? [extracted.pathType] : ["reel", "p", "tv"];

  for (const pathType of candidatePaths) {
    const htmlUrl = `https://www.instagram.com/${pathType}/${encodeURIComponent(shortcode)}/`;
    const htmlRes = await axios.get(htmlUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "text/html",
        ...(getInstagramCookieHeader(sessionId) ? { Cookie: getInstagramCookieHeader(sessionId) } : {}),
      },
      timeout: 15000,
      validateStatus: () => true,
    });

    if (htmlRes.status === 404) {
      continue;
    }

    if (htmlRes.status >= 400) {
      continue;
    }

    const html = String(htmlRes.data || "");
    if (sessionId && isInstagramLoginPage(html)) {
      throw new Error("SESSION_EXPIRED");
    }
    const patterns = [
      /"video_view_count"\s*:\s*(\d+)/,
      /"video_play_count"\s*:\s*(\d+)/,
      /"play_count"\s*:\s*(\d+)/,
      /"view_count"\s*:\s*(\d+)/,
    ];

    let views = null;
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) {
        views = Number(match[1]);
        break;
      }
    }

    const ownerMatch = html.match(/"owner"\s*:\s*\{[^{}]*"username"\s*:\s*"([^"]+)"/);
    const likesMatch = html.match(/"like_count"\s*:\s*(\d+)/);
    const commentsMatch = html.match(/"comment_count"\s*:\s*(\d+)/);
    const ogDescMetaMatch = html.match(/<meta[^>]+(?:property|name)=["']og:description["'][^>]*>/i);
    const ogDescContentMatch = ogDescMetaMatch?.[0]?.match(/content=["']([^"']+)["']/i);
    const ogDesc = ogDescContentMatch?.[1] || "";
    const ogOwnerMatch = ogDesc.match(/-\s*([a-zA-Z0-9._]{1,30})\s+on/i);
    const ogViewsMatch = ogDesc.match(/([\d.,]+[KMB]?)\s+views/i);
    const ogLikesMatch = ogDesc.match(/([\d.,]+[KMB]?)\s+likes/i);
    const ogCommentsMatch = ogDesc.match(/([\d.,]+[KMB]?)\s+comments/i);
    const ogViews = parseAbbrevNumber(ogViewsMatch?.[1]);
    const ogLikes = parseAbbrevNumber(ogLikesMatch?.[1]);
    const ogComments = parseAbbrevNumber(ogCommentsMatch?.[1]);

    if (typeof views === "number" && Number.isFinite(views)) {
      return {
        shortcode,
        input: contentInput,
        url: htmlUrl,
        ownerUsername: ownerMatch?.[1] || null,
        views,
        likes: ogLikes !== null ? ogLikes : likesMatch ? Number(likesMatch[1]) : null,
        comments: ogComments !== null ? ogComments : commentsMatch ? Number(commentsMatch[1]) : null,
        viewsAvailable: true,
      };
    }

    if (ogViews !== null) {
      return {
        shortcode,
        input: contentInput,
        url: htmlUrl,
        ownerUsername: ownerMatch?.[1] || null,
        views: ogViews,
        likes: ogLikes !== null ? ogLikes : likesMatch ? Number(likesMatch[1]) : null,
        comments: ogComments !== null ? ogComments : commentsMatch ? Number(commentsMatch[1]) : null,
        viewsAvailable: true,
      };
    }

    const renderedData = await fetchInstagramViewsFromRenderedDom(htmlUrl, shortcode, sessionId);
    if (renderedData?.views !== null && renderedData?.views !== undefined) {
      return {
        shortcode,
        input: contentInput,
        url: htmlUrl,
        ownerUsername: ownerMatch?.[1] || null,
        views: renderedData.views,
        likes:
          renderedData.likes !== null && renderedData.likes !== undefined
            ? renderedData.likes
            : ogLikes !== null
              ? ogLikes
              : likesMatch
                ? Number(likesMatch[1])
                : null,
        comments:
          renderedData.comments !== null && renderedData.comments !== undefined
            ? renderedData.comments
            : ogComments !== null
              ? ogComments
              : commentsMatch
                ? Number(commentsMatch[1])
                : null,
        viewsAvailable: true,
      };
    }

    const ownerUsername = ownerMatch?.[1] || ogOwnerMatch?.[1] || null;
    const reelsGraphqlData = await fetchInstagramViewsFromUserReelsGraphql(ownerUsername, shortcode, sessionId);
    if (reelsGraphqlData?.views !== null && reelsGraphqlData?.views !== undefined) {
      return {
        shortcode,
        input: contentInput,
        url: htmlUrl,
        ownerUsername,
        views: reelsGraphqlData.views,
        likes:
          reelsGraphqlData.likes !== null && reelsGraphqlData.likes !== undefined
            ? reelsGraphqlData.likes
            : ogLikes !== null
              ? ogLikes
              : likesMatch
                ? Number(likesMatch[1])
                : null,
        comments:
          reelsGraphqlData.comments !== null && reelsGraphqlData.comments !== undefined
            ? reelsGraphqlData.comments
            : ogComments !== null
              ? ogComments
              : commentsMatch
                ? Number(commentsMatch[1])
                : null,
        viewsAvailable: true,
      };
    }

    if (likesMatch || commentsMatch || ogLikes !== null || ogComments !== null) {
      return {
        shortcode,
        input: contentInput,
        url: htmlUrl,
        ownerUsername: ownerMatch?.[1] || null,
        views: null,
        likes: ogLikes !== null ? ogLikes : likesMatch ? Number(likesMatch[1]) : null,
        comments: ogComments !== null ? ogComments : commentsMatch ? Number(commentsMatch[1]) : null,
        viewsAvailable: false,
      };
    }
  }

  throw new Error("Views tidak tersedia atau konten bukan video/reel");
}

app.post("/api/followers", async (req, res) => {
  try {
    const usernames = normalizeUsernames(req.body?.usernames, "instagram");
    const sessionId = resolveInstagramSessionId(req.body?.sessionid);

    if (!usernames.length) {
      return res.status(400).json({
        error: "Masukkan minimal 1 username valid.",
      });
    }

    if (usernames.length > 50) {
      return res.status(400).json({
        error: "Maksimal 50 username per request.",
      });
    }

    const results = await Promise.all(
      usernames.map(async (username) => {
        try {
          const data = await fetchFollowersByUsername(username, sessionId);
          return { status: "ok", ...data };
        } catch (err) {
          const isSessionExpired = err?.message === "SESSION_EXPIRED";
          return {
            status: "error",
            username,
            code: isSessionExpired ? "SESSION_EXPIRED" : undefined,
            message:
              isSessionExpired
                ? "Session Instagram expired. Update sessionid lalu coba lagi."
                : err?.response?.status === 404
                ? "Username tidak ditemukan"
                : `Gagal mengambil data (${err.message})`,
          };
        }
      })
    );

    const sessionExpired = results.filter((r) => r.code === "SESSION_EXPIRED").length;
    res.json({
      total: results.length,
      success: results.filter((r) => r.status === "ok").length,
      failed: results.filter((r) => r.status === "error").length,
      sessionExpired,
      requiresSessionRefresh: sessionExpired > 0,
      results,
    });
  } catch (error) {
    res.status(500).json({
      error: "Terjadi error di server.",
      detail: error.message,
    });
  }
});

app.post("/api/tiktok/followers", async (req, res) => {
  try {
    const usernames = normalizeUsernames(req.body?.usernames, "tiktok");

    if (!usernames.length) {
      return res.status(400).json({
        error: "Masukkan minimal 1 username valid.",
      });
    }

    if (usernames.length > 50) {
      return res.status(400).json({
        error: "Maksimal 50 username per request.",
      });
    }

    const results = [];
    for (const username of usernames) {
      try {
        const data = await fetchTikTokFollowersByUsername(username);
        results.push({ status: "ok", ...data });
      } catch (err) {
        results.push({
          status: "error",
          username,
          message: `Gagal mengambil data (${err.message})`,
        });
      }
    }

    res.json({
      total: results.length,
      success: results.filter((r) => r.status === "ok").length,
      failed: results.filter((r) => r.status === "error").length,
      results,
    });
  } catch (error) {
    res.status(500).json({
      error: "Terjadi error di server.",
      detail: error.message,
    });
  }
});

app.post("/api/instagram/content-views", async (req, res) => {
  try {
    const inputs = normalizeContentInputs(req.body?.items || req.body?.usernames);
    const sessionId = resolveInstagramSessionId(req.body?.sessionid);

    if (!inputs.length) {
      return res.status(400).json({
        error: "Masukkan minimal 1 URL/shortcode valid.",
      });
    }

    if (inputs.length > 50) {
      return res.status(400).json({
        error: "Maksimal 50 item per request.",
      });
    }

    const results = await Promise.all(
      inputs.map(async (item) => {
        try {
          const data = await fetchInstagramContentViews(item, sessionId);
          return { status: "ok", ...data };
        } catch (err) {
          const isSessionExpired = err?.message === "SESSION_EXPIRED";
          return {
            status: "error",
            input: item,
            code: isSessionExpired ? "SESSION_EXPIRED" : undefined,
            message: isSessionExpired
              ? "Session Instagram expired. Update sessionid lalu coba lagi."
              : `Gagal mengambil data (${err.message})`,
          };
        }
      })
    );

    const sessionExpired = results.filter((r) => r.code === "SESSION_EXPIRED").length;
    res.json({
      total: results.length,
      success: results.filter((r) => r.status === "ok").length,
      failed: results.filter((r) => r.status === "error").length,
      sessionExpired,
      requiresSessionRefresh: sessionExpired > 0,
      results,
    });
  } catch (error) {
    res.status(500).json({
      error: "Terjadi error di server.",
      detail: error.message,
    });
  }
});

app.post("/api/tiktok/content-views", async (req, res) => {
  try {
    const inputs = normalizeContentInputs(req.body?.items || req.body?.usernames);

    if (!inputs.length) {
      return res.status(400).json({
        error: "Masukkan minimal 1 URL/ID video TikTok.",
      });
    }

    if (inputs.length > 50) {
      return res.status(400).json({
        error: "Maksimal 50 item per request.",
      });
    }

    const results = [];
    for (const item of inputs) {
      try {
        const data = await fetchTikTokContentViews(item);
        results.push({ status: "ok", ...data });
      } catch (err) {
        results.push({
          status: "error",
          input: item,
          message: `Gagal mengambil data (${err.message})`,
        });
      }
    }

    res.json({
      total: results.length,
      success: results.filter((r) => r.status === "ok").length,
      failed: results.filter((r) => r.status === "error").length,
      results,
    });
  } catch (error) {
    res.status(500).json({
      error: "Terjadi error di server.",
      detail: error.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
