// background/background.js
// Multi-source price comparison: Hinta.fi & Hintaopas.fi
// Features: AbortController timeouts, in-memory caching, series conflict detection,
// historical store offers parsing, and direct store links.

const HINTA_BASE = "https://hinta.fi";
const HINTA_SEARCH_URL = "https://hinta.fi/haku?q=";
const HINTAOPAS_SEARCH_URL = "https://hintaopas.fi/search?query=";

// In-memory cache to prevent repeated fetches
const searchCache = new Map();
const detailsCache = new Map();

// Strict fetch with AbortController timeout (3.5s)
async function fetchWithTimeout(url, options = {}, timeoutMs = 3500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

const FILLER_WORDS = [
  "tuplakorilla", "tuplakori", "kaksoiskori", "kaksoiskorilla",
  "ilmakypsennin", "kiertoilmakypsennin", "kuumakiertoilmakypsennin",
  "airfryer", "airfryeri", "kannettava", "kannettavat", "tietokone", "pöytäkone",
  "pelitietokone", "näyttö", "pelinaeyttoe", "oled-näyttö", "monitori",
  "musta", "valkoinen", "hopea", "harmaa", "kuparinvärinen", "kupari", "black", "white", "silver", "grey",
  "dual", "basket", "xl", "xxl", "tarjous", "uutuus"
];

const KNOWN_SERIES = [
  "odyssey", "viewfinity", "smart monitor",
  "ideapad", "thinkpad", "legion", "yoga", "thinkbook",
  "zenbook", "vivobook", "rog", "tuf", "expertbook",
  "predator", "nitro", "aspire", "swift",
  "galaxy", "xperia", "pixel", "iphone", "ipad", "macbook"
];

// ── Model code extraction ───────────────────────────────────────
function extractModelCodes(text) {
  if (!text) return [];
  const tokens = text.match(/[A-Za-z0-9/-]{3,}/g) || [];
  const codes = [];
  for (const t of tokens) {
    if (/\d/.test(t) && /[A-Za-z]/.test(t)) {
      // Exclude resolution / spec tokens like 4K, 240Hz, 65W, 3840x2160
      if (!t.toLowerCase().match(/^(?:4k|8k|\d+hz|\d+w|\d+gb|\d+tb|\d+v|\d+x\d+)$/)) {
        codes.push(t);
      }
    }
  }
  return codes;
}

// ── Smart Query Builder ─────────────────────────────────────────
function buildSearchQueries(rawTitle) {
  if (!rawTitle) return [];
  const queries = [];
  const trimmed = rawTitle.trim();
  queries.push(trimmed);

  // Extract brand
  const mBrand = trimmed.match(/\b(Samsung|Philips|Lenovo|Asus|Apple|Sony|LG|Acer|HP|Dell|Gigabyte|MSI|Bosch|Siemens|DeLonghi|Moccamaster|Electrolux|Xiaomi|OnePlus|Nokia|Whirlpool|Dyson|Roborock|Tefal|OBH Nordica|Braun|Wilfa)\b/i);
  const brand = mBrand ? mBrand[1] : trimmed.split(/\s+/)[0];

  // Extract series if any
  const seriesFound = KNOWN_SERIES.filter((s) => trimmed.toLowerCase().includes(s));
  const seriesName = seriesFound.length > 0 ? seriesFound[0] : "";

  // Extract model codes
  const codes = extractModelCodes(trimmed);

  // 1. Brand + Series + Code
  for (const c of codes) {
    if (seriesName) {
      queries.push(`${brand} ${seriesName} ${c}`);
    }
    queries.push(`${brand} ${c}`);
    queries.push(c);
    if (c.includes("/")) {
      queries.push(`${brand} ${c.split("/")[0]}`);
      queries.push(c.split("/")[0]);
    }
  }

  // 2. Brand + Series + key descriptor
  if (seriesName) {
    queries.push(`${brand} ${seriesName}`);
    const mSub = trimmed.match(/(?:oled\s*g\d+|g\d+|slim\s*\d+|flip|fold)/i);
    if (mSub) {
      queries.push(`${brand} ${seriesName} ${mSub[0]}`);
    }
  }

  // 3. Cleaned title
  let cleaned = trimmed;
  for (const w of FILLER_WORDS) {
    cleaned = cleaned.replace(new RegExp(`\\b${w}\\b`, "gi"), " ");
  }
  cleaned = cleaned.replace(/[()[\],"-]/g, " ").replace(/\s+/g, " ").trim();
  if (cleaned.length > 3 && !queries.includes(cleaned)) {
    queries.push(cleaned);
  }

  // 4. First 4 words
  const words = cleaned.split(" ").filter((w) => w.length > 1);
  if (words.length > 3) {
    const shortQ = words.slice(0, 4).join(" ");
    if (!queries.includes(shortQ)) queries.push(shortQ);
  }

  return [...new Set(queries)].filter((q) => q && q.length >= 2);
}

// ── Smart Similarity with Series Conflict Detection ────────────
function computeSimilarity(query, resultName) {
  if (!query || !resultName) return 0;
  const qLow = query.toLowerCase();
  const rLow = resultName.toLowerCase();

  // Severe penalty for series conflict (e.g. Odyssey vs ViewFinity)
  const qSeries = KNOWN_SERIES.filter((s) => qLow.includes(s));
  const rSeries = KNOWN_SERIES.filter((s) => rLow.includes(s));
  if (qSeries.length > 0 && rSeries.length > 0) {
    const hasCommon = qSeries.some((s) => rSeries.includes(s));
    if (!hasCommon) {
      return 15; // Conflict! E.g. ViewFinity when user wants Odyssey
    }
  }

  const qCodes = extractModelCodes(query).map((c) => c.toLowerCase());
  const rCodes = extractModelCodes(resultName).map((c) => c.toLowerCase());

  let codeMatch = false;
  let partialCodeMatch = false;

  if (qCodes.length > 0 && rCodes.length > 0) {
    for (const qc of qCodes) {
      for (const rc of rCodes) {
        if (qc === rc) {
          codeMatch = true;
          break;
        }
        if (qc.startsWith(rc) || rc.startsWith(qc)) {
          partialCodeMatch = true;
        }
      }
      if (codeMatch) break;
    }
  }

  // Token Jaccard
  function toTokens(s) {
    return new Set(s.replace(/[^a-z0-9äöå/]/g, " ").split(/\s+/).filter(Boolean));
  }
  const t1 = toTokens(qLow);
  const t2 = toTokens(rLow);
  let inter = 0;
  for (const t of t1) {
    if (t2.has(t)) inter++;
  }
  const union = new Set([...t1, ...t2]).size;
  const jaccard = union > 0 ? (inter / union) * 100 : 0;

  // Bigrams
  function bigrams(s) {
    const cl = s.replace(/\s+/g, "");
    const set = new Set();
    for (let i = 0; i < cl.length - 1; i++) {
      set.add(cl.substring(i, i + 2));
    }
    return set;
  }
  const bg1 = bigrams(qLow);
  const bg2 = bigrams(rLow);
  let bgInter = 0;
  for (const b of bg1) {
    if (bg2.has(b)) bgInter++;
  }
  const bgDice = bg1.size + bg2.size > 0 ? ((2 * bgInter) / (bg1.size + bg2.size)) * 100 : 0;

  let score = jaccard * 0.4 + bgDice * 0.4;

  if (codeMatch) {
    score = Math.max(score, 92);
  } else if (partialCodeMatch) {
    score = Math.max(score, 82);
  } else if (qCodes.length > 0 && !codeMatch && !partialCodeMatch) {
    // Query had a specific model code, but result didn't match it
    score = Math.min(score, 65);
  }

  // Series match bonus
  if (qSeries.length > 0 && rSeries.length > 0 && qSeries[0] === rSeries[0]) {
    score = Math.max(score, 75);
  }

  return Math.min(100, Math.round(score));
}

// ── Price parser ────────────────────────────────────────────────
function parsePrice(text) {
  if (!text) return null;
  const match = String(text).match(/(\d+[\s\u00a0]*\d*[\.,]\d{2}|\d+)\s*€?/);
  if (match) {
    const cleaned = match[1].replace(/[\s\u00a0]/g, "").replace(",", ".");
    return parseFloat(cleaned);
  }
  return null;
}

// ── Parse Hinta.fi Search Results ───────────────────────────────
function parseHintaSearchResults(html, originalQuery) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const results = [];

  const rows = doc.querySelectorAll("tr.hv-prt-tr, tr[class*='hv-prt-tr']");

  rows.forEach((row) => {
    const linkEl = row.querySelector("a.hv-prt_product-a, a[href*='/']");
    if (!linkEl) return;

    const href = linkEl.getAttribute("href") || "";
    if (!href.match(/^\/\d+\//) && !href.match(/^https:\/\/hinta\.fi\/\d+\//)) return;

    const url = href.startsWith("http") ? href : HINTA_BASE + href;
    const nameEl = row.querySelector("strong.hv--name, [class*='hv--name']") || linkEl;
    const name = nameEl.textContent.trim();

    const priceEl = row.querySelector("td.hv--price, [class*='hv--price']");
    const price = priceEl ? parsePrice(priceEl.textContent) : null;

    const storeCountEl = row.querySelector("td.hv--store-count, [class*='store-count']");
    const storeCount = storeCountEl ? parseInt(storeCountEl.textContent.trim(), 10) : null;

    if (name.length > 1) {
      results.push({
        source: "hintafi",
        name,
        url,
        currentLowestPrice: price,
        storeCount: storeCount || null,
        matchPercent: computeSimilarity(originalQuery, name),
      });
    }
  });

  results.sort((a, b) => b.matchPercent - a.matchPercent);
  return results;
}

// ── Parse Hintaopas.fi Search Results (Schema.org JSON-LD) ──────
function parseHintaopasSearchResults(html, originalQuery) {
  const results = [];
  const ldMatches = html.match(/<script\s+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi) || [];

  for (const m of ldMatches) {
    try {
      const jsonStr = m.replace(/<script[^>]*>/i, "").replace(/<\/script>/i, "").trim();
      const data = JSON.parse(jsonStr);
      if (data["@type"] === "ItemList" && Array.isArray(data.itemListElement)) {
        for (const el of data.itemListElement) {
          const item = el.item || el;
          const name = item.name;
          const rawUrl = item["@id"] || item.url || "";
          const url = rawUrl.startsWith("http") ? rawUrl : "https://hintaopas.fi" + rawUrl;

          let lowPrice = null;
          let highPrice = null;
          let storeCount = null;

          if (item.offers) {
            lowPrice = item.offers.lowPrice || item.offers.price || null;
            highPrice = item.offers.highPrice || null;
            storeCount = item.offers.offerCount || null;
          }

          if (name && url) {
            results.push({
              source: "hintaopas",
              name: name.trim(),
              url,
              currentLowestPrice: lowPrice ? parseFloat(lowPrice) : null,
              highestPrice: highPrice ? parseFloat(highPrice) : null,
              storeCount: storeCount || null,
              matchPercent: computeSimilarity(originalQuery, name),
            });
          }
        }
      }
    } catch (e) {
      // JSON parse error, ignore
    }
  }

  results.sort((a, b) => b.matchPercent - a.matchPercent);
  return results;
}

// ── Execute Hinta.fi Search ─────────────────────────────────────
async function executeHintaSearch(productName) {
  const queries = buildSearchQueries(productName);

  for (const q of queries.slice(0, 3)) {
    try {
      const searchUrl = HINTA_SEARCH_URL + encodeURIComponent(q);
      const res = await fetchWithTimeout(searchUrl, {
        headers: {
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "fi-FI,fi;q=0.9",
        },
      }, 3000);

      if (!res || !res.ok) continue;

      const html = await res.text();
      const results = parseHintaSearchResults(html, productName);

      if (results.length > 0) {
        return {
          success: true,
          source: "hintafi",
          results,
          searchUrl,
          usedQuery: q,
        };
      }
    } catch (e) {
      // Timeout or network error, continue to next query
    }
  }

  return {
    success: false,
    results: [],
  };
}

// ── Execute Hintaopas.fi Search ─────────────────────────────────
async function executeHintaopasSearch(productName) {
  const queries = buildSearchQueries(productName);

  for (const q of queries.slice(0, 2)) {
    try {
      const searchUrl = HINTAOPAS_SEARCH_URL + encodeURIComponent(q);
      const res = await fetchWithTimeout(searchUrl, {
        headers: {
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "fi-FI,fi;q=0.9",
        },
      }, 3500);

      if (!res || !res.ok) continue;

      const html = await res.text();
      const results = parseHintaopasSearchResults(html, productName);

      if (results.length > 0) {
        return {
          success: true,
          source: "hintaopas",
          results,
          searchUrl,
          usedQuery: q,
        };
      }
    } catch (e) {
      // Timeout or network error
    }
  }

  return {
    success: false,
    results: [],
  };
}

// ── Multi-Source Search (Hinta.fi primary, Hintaopas.fi secondary) 
async function executeMultiSourceSearch(productName) {
  const cacheKey = productName.trim().toLowerCase();
  if (searchCache.has(cacheKey)) {
    return searchCache.get(cacheKey);
  }

  // 1. Try Hinta.fi
  let hintaRes = null;
  try {
    hintaRes = await executeHintaSearch(productName);
  } catch (e) {
    hintaRes = { success: false, results: [] };
  }

  if (hintaRes && hintaRes.success && hintaRes.results.length > 0 && hintaRes.results[0].matchPercent >= 60) {
    searchCache.set(cacheKey, hintaRes);
    return hintaRes;
  }

  // 2. Try Hintaopas.fi if Hinta.fi failed or gave low match
  try {
    const opasRes = await executeHintaopasSearch(productName);
    if (opasRes && opasRes.success && opasRes.results.length > 0 && opasRes.results[0].matchPercent >= 60) {
      searchCache.set(cacheKey, opasRes);
      return opasRes;
    }
  } catch (e) {
    // ignore
  }

  // 3. Fallback: return best result between the two if any, or empty with direct URLs
  const bestResults = (hintaRes && hintaRes.results.length > 0) ? hintaRes.results : [];
  const finalRes = {
    success: true,
    source: (bestResults.length > 0) ? "hintafi" : "none",
    results: bestResults,
    searchUrl: HINTA_SEARCH_URL + encodeURIComponent(productName),
    usedQuery: productName,
  };

  searchCache.set(cacheKey, finalRes);
  return finalRes;
}

// ── Fetch Product Details & Historical Stores ───────────────────
async function fetchProductDetails(productUrl, source = "hintafi") {
  if (detailsCache.has(productUrl)) {
    return detailsCache.get(productUrl);
  }

  const baseProdUrl = productUrl.split("?")[0].replace(/\/+$/, "");
  const historyUrl = `${baseProdUrl}/historia?l=1`;

  const details = {
    source: source,
    productName: null,
    lowestEver: null,
    averagePrice: null,
    highestEver: null,
    currentLowest: null,
    lowest30d: null,
    stores: [],
    historyPoints: [],
    productUrl: baseProdUrl,
    historyUrl: historyUrl,
  };

  // If source is Hintaopas, we might not have Hinta.fi's custom history endpoint
  if (source === "hintaopas" || productUrl.includes("hintaopas.fi")) {
    details.productUrl = productUrl;
    details.historyUrl = productUrl;
    detailsCache.set(productUrl, details);
    return details;
  }

  // 1. Fetch Product Page for Store listings with Direct URLs (Hinta.fi)
  try {
    const prodRes = await fetchWithTimeout(baseProdUrl, {
      headers: {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "fi-FI,fi;q=0.9",
      },
    }, 3000);

    if (prodRes && prodRes.ok) {
      const prodHtml = await prodRes.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(prodHtml, "text/html");

      const h1 = doc.querySelector("h1");
      if (h1) details.productName = h1.textContent.trim();

      const p30Match = prodHtml.match(/Alin hinta 30 päivän aikana\s*([\d\s,.]+)\s*€/i);
      if (p30Match) details.lowest30d = parsePrice(p30Match[1]);

      const storeRows = doc.querySelectorAll("tr.hv-oft-tr, tr[class*='hv-oft-tr']");
      storeRows.forEach((row) => {
        const thStore = row.querySelector("th.hv--store, td.hv--store, [class*='hv--store']");
        let storeName = "";
        let storeUrl = "";

        if (thStore) {
          const a = thStore.querySelector("a[href]");
          if (a) {
            const href = a.getAttribute("href");
            storeUrl = href.startsWith("http") ? href : HINTA_BASE + href;
            if (a.getAttribute("title")) {
              const tm = a.getAttribute("title").match(/Siirry kauppaan:\s*(.+)/i);
              storeName = tm ? tm[1].trim() : a.getAttribute("title").trim();
            }
          }
          if (!storeName) {
            const hiddenSpan = thStore.querySelector(".hv-visual-hide");
            storeName = hiddenSpan ? hiddenSpan.textContent.trim() : thStore.textContent.trim();
          }
        }

        // Also check "Kauppaan" link
        if (!storeUrl) {
          const linkTd = row.querySelector("td.hv--link a[href]");
          if (linkTd) {
            const href = linkTd.getAttribute("href");
            storeUrl = href.startsWith("http") ? href : HINTA_BASE + href;
          }
        }

        let price = null;
        const dataPrice = row.getAttribute("data-price");
        if (dataPrice) {
          price = parsePrice(dataPrice);
        } else {
          const tdPrice = row.querySelector("td.hv--price, [class*='hv--price']");
          if (tdPrice) price = parsePrice(tdPrice.textContent);
        }

        const delivery = row.getAttribute("data-delivery-fee") || "";

        if (storeName && price) {
          details.stores.push({
            name: storeName,
            price: price,
            delivery: delivery,
            storeUrl: storeUrl || historyUrl,
          });
        }
      });

      if (details.stores.length > 0) {
        details.stores.sort((a, b) => a.price - b.price);
        details.currentLowest = details.stores[0].price;
      }
    }
  } catch (err) {
    // Timeout or network error
  }

  // 2. Fetch History Page with Historical Store Offers from 'custom'
  try {
    const histRes = await fetchWithTimeout(historyUrl, {
      headers: {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "fi-FI,fi;q=0.9",
      },
    }, 3000);

    if (histRes && histRes.ok) {
      const histHtml = await histRes.text();
      const histMatch = histHtml.match(/var\s+hvEnvProductHistory\s*=\s*(\{.*?\});/s);

      if (histMatch) {
        try {
          const histData = JSON.parse(histMatch[1]);
          const datasets = histData.datasets || [];
          const labels = histData.labels || [];
          const custom = histData.custom || {};

          if (datasets.length > 0 && datasets[0].data) {
            const validPrices = datasets[0].data.filter((p) => p !== null && p > 0);
            if (validPrices.length > 0) {
              details.lowestEver = Math.min(...validPrices);
              details.highestEver = Math.max(...validPrices);
              const sum = validPrices.reduce((a, b) => a + b, 0);
              details.averagePrice = Math.round((sum / validPrices.length) * 100) / 100;

              for (let i = 0; i < labels.length; i++) {
                const label = labels[i];
                const p = datasets[0].data[i];
                if (p !== null && p > 0) {
                  const customItem = custom[label] || {};
                  const offers = (customItem.offers || []).map((o) => ({
                    store: o.store || "",
                    price: o.value || o.price,
                  }));

                  details.historyPoints.push({
                    date: (label || "").split(" ")[0],
                    title: customItem.title || label,
                    price: p,
                    offers: offers,
                  });
                }
              }
            }
          }
        } catch (e) {
          // JSON parse error
        }
      }
    }
  } catch (err) {
    // Timeout or network error
  }

  if (!details.currentLowest && details.lowestEver) {
    details.currentLowest = details.lowestEver;
  }

  detailsCache.set(productUrl, details);
  return details;
}

// ── Message Listener ────────────────────────────────────────────
browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "searchHintaFi" || msg.action === "searchMultiSource") {
    executeMultiSourceSearch(msg.productName)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (msg.action === "getProductDetails") {
    fetchProductDetails(msg.url, msg.source)
      .then((data) => sendResponse({ success: true, data }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
});