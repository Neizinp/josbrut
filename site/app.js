const FALLBACK_SOURCES = [
  { id: "omni", name: "Omni", home: "https://omni.se" },
  { id: "svt", name: "SVT Nyheter", home: "https://www.svt.se/nyheter" },
  { id: "sydsvenskan", name: "Sydsvenskan", home: "https://www.sydsvenskan.se" },
  { id: "feber", name: "Feber", home: "https://feber.se" },
  { id: "sweclockers", name: "SweClockers", home: "https://www.sweclockers.com" },
  { id: "di", name: "Dagens industri", home: "https://www.di.se" },
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
const selectedSources = new Set(FALLBACK_SOURCES.map((source) => source.id));
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;
const TITLE_STOP_WORDS = new Set([
  "alla", "att", "av", "blev", "blir", "bra", "dag", "den", "denna", "deras", "det", "efter", "eller",
  "en", "ett", "flera", "från", "för", "har", "hela", "här", "i", "inte", "kan", "kommer", "kräver",
  "med", "men", "minst", "mot", "mycket", "när", "och", "om", "på", "samt", "sedan", "sin", "sitt", "ska", "som",
  "stor", "stora", "svensk", "sverige", "till", "under", "uppger", "vid", "vi", "över",
]);

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

function titleWords(title) {
  return new Set(
    title.toLocaleLowerCase("sv")
      .normalize("NFC")
      .match(/[\p{L}\p{N}]+/gu)
      ?.filter((word) => (word.length > 2 || /^\d{2,}$/.test(word)) && !TITLE_STOP_WORDS.has(word)) || [],
  );
}

function isDuplicateHeadline(first, second) {
  const firstTime = safeDate(first.published)?.getTime();
  const secondTime = safeDate(second.published)?.getTime();
  if (firstTime === undefined || secondTime === undefined || Math.abs(firstTime - secondTime) > DUPLICATE_WINDOW_MS) return false;
  if (first.url === second.url) return true;

  const firstWords = titleWords(first.title);
  const secondWords = titleWords(second.title);
  if (Math.min(firstWords.size, secondWords.size) < 3) return false;
  const sharedWords = [...firstWords].filter((word) => secondWords.has(word)).length;
  const unionSize = new Set([...firstWords, ...secondWords]).size;
  return sharedWords >= 3 && sharedWords / unionSize >= 0.38;
}

function groupDuplicateHeadlines(items) {
  const groups = [];
  for (const article of items) {
    const group = groups.find((candidate) => {
      if (candidate.articles.some((item) => item.sourceId === article.sourceId)) return false;
      return candidate.articles.some((item) => isDuplicateHeadline(item, article));
    });
    if (group) group.articles.push(article);
    else groups.push({ articles: [article] });
  }
  return groups;
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
    return matchesAge && matchesSource;
  });
  const groups = groupDuplicateHeadlines(filtered).filter((group) => !query || group.articles.some((article) =>
    `${article.title} ${article.description} ${article.sourceName}`.toLocaleLowerCase("sv").includes(query),
  ));

  articleList.replaceChildren();
  const fragment = document.createDocumentFragment();
  groups.forEach((group) => {
    const [article, ...duplicates] = group.articles;
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
    if (duplicates.length) {
      const duplicateList = document.createElement("div");
      duplicateList.className = "duplicate-sources";
      const label = document.createElement("span");
      label.textContent = "Även hos";
      duplicateList.append(label);
      duplicates.forEach((duplicate) => {
        const duplicateLink = document.createElement("a");
        duplicateLink.href = duplicate.url;
        duplicateLink.target = "_blank";
        duplicateLink.rel = "noopener noreferrer";
        duplicateLink.textContent = duplicate.sourceName;
        duplicateLink.setAttribute("aria-label", `Läs motsvarande rubrik hos ${duplicate.sourceName}`);
        duplicateList.append(duplicateLink);
      });
      main.append(duplicateList);
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
  emptyState.hidden = groups.length !== 0;
  const duplicateCount = groups.reduce((count, group) => count + group.articles.length - 1, 0);
  resultsStatus.textContent = `${groups.length} ${groups.length === 1 ? "nyhet" : "nyheter"}${duplicateCount ? ` · ${duplicateCount} dubletter samlade` : ""}`;
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
    if (Array.isArray(payload.sources) && payload.sources.length) {
      const previousIds = new Set(sources.map((source) => source.id));
      sources = payload.sources;
      sources.forEach((source) => {
        if (!previousIds.has(source.id)) selectedSources.add(source.id);
      });
      for (const sourceId of selectedSources) {
        if (!sources.some((source) => source.id === sourceId)) selectedSources.delete(sourceId);
      }
    }
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

renderSources();
loadFeeds();
window.setInterval(() => loadFeeds(), 5 * 60 * 1000);