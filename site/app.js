const FALLBACK_SOURCES = [
  { id: "omni", name: "Omni", home: "https://omni.se" },
  { id: "svt", name: "SVT Nyheter", home: "https://www.svt.se/nyheter" },
  { id: "sydsvenskan", name: "Sydsvenskan", home: "https://www.sydsvenskan.se" },
  { id: "feber", name: "Feber", home: "https://feber.se" },
  { id: "sweclockers", name: "SweClockers", home: "https://www.sweclockers.com" },
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
let selectedSource = "all";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

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

function renderSources() {
  const counts = Object.fromEntries(sources.map((source) => [source.id, 0]));
  articles.forEach((article) => { counts[article.sourceId] = (counts[article.sourceId] || 0) + 1; });
  document.querySelector("#all-count").textContent = String(articles.length);
  sourceNav.querySelectorAll(".source-filter:not([data-source='all'])").forEach((button) => button.remove());

  sources.forEach((source) => {
    const button = document.createElement("button");
    button.className = `source-filter${selectedSource === source.id ? " is-active" : ""}`;
    button.type = "button";
    button.dataset.source = source.id;
    button.setAttribute("aria-pressed", String(selectedSource === source.id));
    const label = document.createElement("span");
    label.textContent = source.name;
    const count = document.createElement("span");
    count.className = "source-count";
    count.textContent = String(counts[source.id] || 0);
    button.append(label, count);
    sourceNav.append(button);
  });

  sourceNav.querySelectorAll(".source-filter").forEach((button) => {
    const active = button.dataset.source === selectedSource;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function renderArticles() {
  const query = searchInput.value.trim().toLocaleLowerCase("sv");
  const now = Date.now();
  const filtered = articles.filter((article) => {
    const published = safeDate(article.published)?.getTime();
    const matchesAge = published !== undefined && published >= now - WEEK_MS && published <= now;
    const matchesSource = selectedSource === "all" || article.sourceId === selectedSource;
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
  resultsStatus.textContent = `${filtered.length} ${filtered.length === 1 ? "rubrik" : "rubriker"}`;
  renderSources();
}

function showFeedState(message, isError = false) {
  feedStatus.textContent = message;
  feedStatus.hidden = !message;
  feedStatus.classList.toggle("is-error", isError);
}

function setUpdatedAt(value) {
  const date = safeDate(value);
  document.querySelector("#update-time").textContent = date
    ? `Uppdaterad ${new Intl.DateTimeFormat("sv-SE", { hour: "2-digit", minute: "2-digit" }).format(date)}`
    : "Väntar på nyheter";
}

async function loadFeeds(showRefresh = false) {
  refreshButton.classList.toggle("is-loading", showRefresh);
  refreshButton.disabled = showRefresh;
  showFeedState("");
  try {
    const response = await fetch(`./feeds.json?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Nyhetsflödet kunde inte hämtas.");
    const payload = await response.json();
    articles = Array.isArray(payload.articles) ? payload.articles : [];
    if (Array.isArray(payload.sources) && payload.sources.length) sources = payload.sources;
    setUpdatedAt(payload.updatedAt);
    if (payload.errors?.length) {
      const names = payload.errors.map((error) => sources.find((source) => source.id === error.sourceId)?.name || error.sourceId);
      showFeedState(`Kunde inte uppdatera: ${names.join(", ")}. Visar tillgängliga rubriker.`, true);
    }
    renderArticles();
  } catch (error) {
    articles = [];
    renderArticles();
    setUpdatedAt(null);
    showFeedState(`${error.message} Kontrollera anslutningen och försök igen.`, true);
  } finally {
    refreshButton.classList.remove("is-loading");
    refreshButton.disabled = false;
  }
}

sourceNav.addEventListener("click", (event) => {
  const button = event.target.closest(".source-filter");
  if (!button) return;
  selectedSource = button.dataset.source;
  renderArticles();
});
searchInput.addEventListener("input", renderArticles);
refreshButton.addEventListener("click", () => loadFeeds(true));
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

document.querySelector("#today-date").textContent = new Intl.DateTimeFormat("sv-SE", {
  day: "numeric", month: "long", year: "numeric",
}).format(new Date()).toLocaleUpperCase("sv-SE");
renderSources();
loadFeeds();
window.setInterval(() => loadFeeds(), 5 * 60 * 1000);