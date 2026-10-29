const FALLBACK_SOURCES = [
  { id: "omni", name: "Omni", home: "https://omni.se", feedUrl: "https://omni.se/rss.xml" },
  { id: "svt", name: "SVT Nyheter", home: "https://www.svt.se/nyheter", feedUrl: "https://www.svt.se/nyheter/rss.xml" },
  { id: "sydsvenskan", name: "Sydsvenskan", home: "https://www.sydsvenskan.se", feedUrl: "https://www.sydsvenskan.se/rss.xml" },
  { id: "feber", name: "Feber", home: "https://feber.se", feedUrl: "https://feber.se/rss/" },
  { id: "sweclockers", name: "SweClockers", home: "https://www.sweclockers.com", feedUrl: "https://www.sweclockers.com/feeds/nyheter" },
  { id: "di", name: "Dagens industri", home: "https://www.di.se", feedUrl: "https://www.di.se/rss" },
];

const sourceNav = document.querySelector("#source-nav");
const articleList = document.querySelector("#article-list");
const searchInput = document.querySelector("#search-input");
const resultsStatus = document.querySelector("#results-status");
const feedStatus = document.querySelector("#feed-status");
const emptyState = document.querySelector("#empty-state");
const refreshButton = document.querySelector("#refresh-button");
let sources = FALLBACK_SOURCES;
let articles = [];
let feedUpdatedAt = "";
let lastUpdatedAt = null;
const selectedSources = new Set(FALLBACK_SOURCES.map((source) => source.id));
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ARTICLES_PER_SOURCE = 500;
const LIVE_CACHE_KEY = "nyheter-live-feed-cache-v2";
const FEED_PROXY = "https://r.jina.ai/";
let liveRefreshInProgress = false;

function safeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function ageLabel(value) {
  const date = safeDate(value);
  if (!date) return "";
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
  if (minutes < 1) return "NU";
  if (minutes < 60) return `${minutes} MIN`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} TIM`;
  return `${Math.floor(hours / 24)} DAG`;
}

function articleUrlKey(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "");
    const path = url.pathname.replace(/\/+$/, "");
    return `${host}${path}`;
  } catch {
    return value;
  }
}

function parseRssFeed(xmlText, source, previousArticles) {
  const document = new DOMParser().parseFromString(xmlText, "application/xml");
  if (document.querySelector("parsererror")) throw new Error("RSS-källan returnerade ogiltig XML");

  let entries = [...document.getElementsByTagName("item")];
  if (!entries.length) entries = [...document.getElementsByTagNameNS("*", "entry")];
  const previousByUrl = new Map(previousArticles.map((article) => [articleUrlKey(article.url), article]));
  const parsed = [];

  for (const entry of entries) {
    const childText = (...names) => {
      const child = [...entry.children].find((element) => names.includes(element.localName));
      return child?.textContent?.trim() || "";
    };
    const linkElement = [...entry.children].find((element) => element.localName === "link");
    const url = linkElement?.getAttribute("href") || childText("link");
    const title = childText("title");
    const dateText = childText("pubDate", "published", "updated", "date");
    const published = dateText ? new Date(dateText) : null;
    if (!title || !url || !/^https?:\/\//i.test(url) || !published || Number.isNaN(published.getTime())) continue;
    if (published.getTime() < Date.now() - WEEK_MS || published.getTime() > Date.now()) continue;

    const oldArticle = previousByUrl.get(articleUrlKey(url));
    const rawDescription = childText("description", "summary", "encoded", "content");
    const description = new DOMParser().parseFromString(rawDescription, "text/html").body.textContent
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 280);

    parsed.push({
      title,
      url,
      published: published.toISOString(),
      description: description || oldArticle?.description || "",
      sourceId: source.id,
      sourceName: source.name,
    });
  }
  return parsed.slice(0, MAX_ARTICLES_PER_SOURCE);
}

function mergeArticleArchive(existingArticles, incomingArticles) {
  const now = Date.now();
  const cutoff = now - WEEK_MS;
  const archive = new Map();

  for (const article of [...existingArticles, ...incomingArticles]) {
    const published = safeDate(article.published)?.getTime();
    if (published === undefined || published < cutoff || published > now) continue;

    const key = `${article.sourceId}:${articleUrlKey(article.url)}`;
    const previous = archive.get(key);
    archive.set(key, {
      ...previous,
      ...article,
      title: article.title || previous?.title || "",
      description: article.description || previous?.description || "",
    });
  }

  return [...archive.values()].sort((first, second) => safeDate(second.published) - safeDate(first.published));
}

function applyFeedPayload(payload) {
  const incomingArticles = Array.isArray(payload.articles) ? payload.articles : [];
  articles = mergeArticleArchive(articles, incomingArticles);
  const incomingUpdatedAt = safeDate(payload.updatedAt);
  const currentUpdatedAt = safeDate(feedUpdatedAt);
  if (incomingUpdatedAt && (!currentUpdatedAt || incomingUpdatedAt > currentUpdatedAt)) {
    feedUpdatedAt = incomingUpdatedAt.toISOString();
  }
  if (Array.isArray(payload.sources) && payload.sources.length) {
    const previousIds = new Set(sources.map((source) => source.id));
    sources = payload.sources.map((source) => ({
      ...FALLBACK_SOURCES.find((fallback) => fallback.id === source.id),
      ...source,
    }));
    sources.forEach((source) => {
      if (!previousIds.has(source.id)) selectedSources.add(source.id);
    });
    for (const sourceId of selectedSources) {
      if (!sources.some((source) => source.id === sourceId)) selectedSources.delete(sourceId);
    }
  }
  setUpdatedAt(payload.updatedAt);
  renderArticles();
}

function renderSources() {
  const counts = Object.fromEntries(sources.map((source) => [source.id, 0]));
  articles.forEach((article) => { counts[article.sourceId] = (counts[article.sourceId] || 0) + 1; });
  document.querySelector("#all-count").textContent = String(articles.length);
  sourceNav.querySelectorAll(".source-filter[data-source]").forEach((label) => label.remove());

  sources.forEach((source) => {
    const row = document.createElement("div");
    row.className = "source-filter";
    row.dataset.source = source.id;
    const choice = document.createElement("label");
    choice.className = "source-choice";
    choice.htmlFor = `source-${source.id}`;
    const checkbox = document.createElement("input");
    checkbox.id = `source-${source.id}`;
    checkbox.type = "checkbox";
    checkbox.checked = selectedSources.has(source.id);
    const count = document.createElement("span");
    count.className = "source-count";
    count.textContent = String(counts[source.id] || 0);
    const sourceLabel = document.createElement("span");
    sourceLabel.textContent = source.name;
    choice.append(checkbox, sourceLabel, count);

    const soloButton = document.createElement("button");
    soloButton.className = "source-solo";
    soloButton.type = "button";
    soloButton.dataset.soloSource = source.id;
    soloButton.title = `Visa bara ${source.name}`;
    soloButton.setAttribute("aria-label", `Visa bara ${source.name}`);
    soloButton.setAttribute("aria-pressed", String(selectedSources.size === 1 && selectedSources.has(source.id)));
    soloButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3"/><path d="M12 1v3M23 12h-3M12 23v-3M1 12h3"/></svg>';

    row.append(choice, soloButton);
    sourceNav.append(row);
  });

  const allCheckbox = document.querySelector("#source-all");
  const selectedCount = sources.filter((source) => selectedSources.has(source.id)).length;
  allCheckbox.checked = selectedCount === sources.length;
  allCheckbox.indeterminate = selectedCount > 0 && selectedCount < sources.length;
  allCheckbox.closest(".source-filter").classList.toggle("is-active", allCheckbox.checked);
  allCheckbox.closest(".source-filter").classList.toggle("is-partial", allCheckbox.indeterminate);
  sourceNav.querySelectorAll(".source-filter[data-source]").forEach((label) => {
    label.classList.toggle("is-active", selectedSources.has(label.dataset.source));
    const soloButton = label.querySelector(".source-solo");
    soloButton.setAttribute("aria-pressed", String(selectedSources.size === 1 && selectedSources.has(label.dataset.source)));
  });
}

function renderArticles() {
  const query = searchInput.value.trim().toLocaleLowerCase("sv");
  const now = Date.now();
  const filtered = articles.filter((article) => {
    const published = safeDate(article.published)?.getTime();
    const matchesAge = published !== undefined && published >= now - WEEK_MS && published <= now;
    const matchesSource = selectedSources.has(article.sourceId);
    const matchesQuery = !query || `${article.title} ${article.description} ${article.sourceName}`.toLocaleLowerCase("sv").includes(query);
    return matchesAge && matchesSource && matchesQuery;
  });

  articleList.replaceChildren();
  const fragment = document.createDocumentFragment();
  filtered.forEach((article) => {
    const row = document.createElement("article");
    row.className = "article-row";
    const source = sources.find((item) => item.id === article.sourceId);
    const sourceLink = document.createElement("a");
    sourceLink.className = "article-source";
    sourceLink.href = source?.home || "#";
    sourceLink.target = "_blank";
    sourceLink.rel = "noopener noreferrer";
    sourceLink.textContent = article.sourceName;
    const main = document.createElement("div");
    main.className = "article-main";
    const title = document.createElement("a");
    title.className = "article-title";
    title.href = article.url;
    title.target = "_blank";
    title.rel = "noopener noreferrer";
    title.textContent = article.title;
    main.append(title);
    if (article.description) {
      const description = document.createElement("p");
      description.className = "article-description";
      description.textContent = article.description;
      main.append(description);
    }
    const time = document.createElement("time");
    time.className = "article-time";
    time.dateTime = safeDate(article.published)?.toISOString() || "";
    time.textContent = ageLabel(article.published);
    time.title = article.published || "";
    row.append(sourceLink, main, time);
    fragment.append(row);
  });
  articleList.append(fragment);
  emptyState.hidden = filtered.length !== 0;
  updateResultsStatus(filtered.length);
  renderSources();
}

function updateResultsStatus(count = articleList.querySelectorAll(".article-row").length) {
  const headlineCount = `${count} ${count === 1 ? "rubrik" : "rubriker"}`;
  if (!lastUpdatedAt) {
    resultsStatus.textContent = headlineCount;
    return;
  }

  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - lastUpdatedAt.getTime()) / 60000));
  const relativeTime = elapsedMinutes < 1
    ? "nyss"
    : elapsedMinutes < 60
      ? `${elapsedMinutes} min sedan`
      : elapsedMinutes < 1440
        ? `${Math.floor(elapsedMinutes / 60)} tim sedan`
        : `${Math.floor(elapsedMinutes / 1440)} d sedan`;
  const clockTime = new Intl.DateTimeFormat("sv-SE", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(lastUpdatedAt);
  resultsStatus.textContent = `${headlineCount} · ${clockTime} · ${relativeTime}`;
}

function showFeedState(message, isError = false) {
  feedStatus.textContent = message;
  feedStatus.hidden = !message;
  feedStatus.classList.toggle("is-error", isError);
}

function setUpdatedAt(value) {
  const date = safeDate(value);
  lastUpdatedAt = date;
  document.querySelector("#update-time").textContent = date
    ? `Uppdaterad ${new Intl.DateTimeFormat("sv-SE", { hour: "2-digit", minute: "2-digit" }).format(date)}`
    : "Väntar på nyheter";
  updateResultsStatus();
}

async function loadFeeds(showRefresh = false) {
  refreshButton.classList.toggle("is-loading", showRefresh);
  refreshButton.disabled = showRefresh;
  showFeedState("");
  try {
    const response = await fetch(`./feeds.json?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Nyhetsflödet kunde inte hämtas.");
    const payload = await response.json();
    applyFeedPayload(payload);
    if (payload.errors?.length) {
      const names = payload.errors.map((error) => sources.find((source) => source.id === error.sourceId)?.name || error.sourceId);
      showFeedState(`Kunde inte uppdatera: ${names.join(", ")}. Visar tillgängliga rubriker.`, true);
    } else {
      showFeedState("");
    }
    renderArticles();
  } catch (error) {
    renderArticles();
    showFeedState(`${error.message} Kontrollera anslutningen och försök igen.`, true);
  } finally {
    refreshButton.classList.remove("is-loading");
    refreshButton.disabled = false;
  }
}

function loadLocalLiveCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(LIVE_CACHE_KEY) || "null");
    if (cached?.articles?.length) applyFeedPayload(cached);
  } catch {
    localStorage.removeItem(LIVE_CACHE_KEY);
  }
}

async function refreshLiveFeeds() {
  if (liveRefreshInProgress) return;
  liveRefreshInProgress = true;

  refreshButton.classList.add("is-loading");
  refreshButton.disabled = true;
  showFeedState("Hämtar senaste nyheterna från källorna …");

  const previousArticles = articles;
  const results = await Promise.allSettled(sources.map(async (source) => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch(`${FEED_PROXY}${source.feedUrl}`, {
        headers: { "X-No-Cache": "true", "X-Return-Format": "html" },
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return { source, articles: parseRssFeed(await response.text(), source, previousArticles) };
    } finally {
      window.clearTimeout(timeout);
    }
  }));

  const refreshedIds = new Set();
  const errors = [];
  const nextArticles = [...previousArticles];
  results.forEach((result, index) => {
    const source = sources[index];
    if (result.status === "fulfilled" && result.value.articles.length) {
      refreshedIds.add(source.id);
      nextArticles.push(...result.value.articles);
    } else {
      const message = result.status === "rejected" ? result.reason?.message : "Tomt eller okänt RSS-format";
      errors.push(`${source.name} (${message})`);
    }
  });

  if (refreshedIds.size) {
    const payload = {
      updatedAt: new Date().toISOString(),
      sources,
      articles: mergeArticleArchive([], nextArticles),
      errors: errors.map((message) => ({ message })),
    };
    try {
      localStorage.setItem(LIVE_CACHE_KEY, JSON.stringify({ ...payload, articles: mergeArticleArchive(articles, payload.articles) }));
    } catch {
      showFeedState("Nyheterna hämtades, men webbläsarens lokala lagring är full.");
    }
    applyFeedPayload(payload);
    showFeedState(errors.length ? `Uppdaterad. Kunde inte nå: ${errors.join(", ")}.` : "", errors.length > 0);
  } else {
    showFeedState("Livehämtningen misslyckades. Visar senast tillgängliga nyheter.", true);
  }

  refreshButton.classList.remove("is-loading");
  refreshButton.disabled = false;
  liveRefreshInProgress = false;
}

sourceNav.addEventListener("change", (event) => {
  const checkbox = event.target.closest("input[type='checkbox']");
  if (!checkbox) return;
  if (checkbox.id === "source-all") {
    if (checkbox.checked) sources.forEach((source) => selectedSources.add(source.id));
    else selectedSources.clear();
  } else {
    const sourceId = checkbox.closest("[data-source]").dataset.source;
    if (checkbox.checked) selectedSources.add(sourceId);
    else selectedSources.delete(sourceId);
  }
  renderArticles();
});
sourceNav.addEventListener("click", (event) => {
  const soloButton = event.target.closest(".source-solo");
  if (!soloButton) return;
  selectedSources.clear();
  selectedSources.add(soloButton.dataset.soloSource);
  renderArticles();
});
searchInput.addEventListener("input", renderArticles);
refreshButton.addEventListener("click", () => refreshLiveFeeds());
document.addEventListener("keydown", (event) => {
  if (event.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
    event.preventDefault();
    searchInput.focus();
  }
  if (event.key === "Escape" && document.activeElement === searchInput) {
    searchInput.value = "";
    renderArticles();
    searchInput.blur();
  }
});

renderSources();
loadLocalLiveCache();
loadFeeds().then(() => {
  loadLocalLiveCache();
  return refreshLiveFeeds();
});
window.setInterval(() => updateResultsStatus(), 60 * 1000);