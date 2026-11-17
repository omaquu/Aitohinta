// content/content.js
// Aitohinta – Hintatarkistaja & Hintavertailu
// Multi-source: Hinta.fi, Hintaopas.fi, Vertaa.fi
// Injects price-check badges directly next to product prices and in listing cards

(function () {
  "use strict";

  if (window.__hintafiInjected) return;
  window.__hintafiInjected = true;

  const host = location.hostname;
  let lastUrl = location.href;
  let isProcessingProduct = false;
  let isScanningListings = false;
  const listingCache = new Map();

  const MONTH_FI = [
    "", "tammikuussa", "helmikuussa", "maaliskuussa", "huhtikuussa",
    "toukokuussa", "kesäkuussa", "heinäkuussa", "elokuussa",
    "syyskuussa", "lokakuussa", "marraskuussa", "joulukuussa"
  ];

  // ── Helpers ──────────────────────────────────────────────────
  function parsePrice(text) {
    if (!text) return null;
    const m = String(text).match(/(\d[\d\s\u00a0]*[\.,]\d{2}|\d+)\s*€?/);
    if (m) {
      const clean = m[1].replace(/[\s\u00a0]/g, "").replace(",", ".");
      const val = parseFloat(clean);
      return isNaN(val) ? null : val;
    }
    return null;
  }

  function fmt(n) {
    if (n === null || n === undefined || isNaN(n)) return "–";
    return Math.round(n).toLocaleString("fi-FI") + " €";
  }

  function fmtExact(n) {
    if (n === null || n === undefined || isNaN(n)) return "–";
    return n.toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  }

  function esc(s) {
    if (!s) return "";
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function getExternalUrls(query) {
    const q = encodeURIComponent(query || "");
    return {
      hintaopas: `https://hintaopas.fi/search?query=${q}`,
      vertaa: `https://www.vertaa.fi/?q=${q}`,
      hintafi: `https://hinta.fi/haku?q=${q}`,
    };
  }

  function log(...args) {
    console.log("[Aitohinta]", ...args);
  }

  // ── Page Type Detection ──────────────────────────────────────
  function isProductPage() {
    if (host.includes("verkkokauppa")) {
      return /\/product\//.test(location.pathname) || !!document.querySelector("aside data[data-price='current'], aside [class*='stm-price']");
    }
    if (host.includes("gigantti")) {
      return /\/product\//.test(location.pathname) || !!document.querySelector('[data-cro="pdp-buy-box"], [data-testid="pdp-buy-box"]');
    }
    if (host.includes("proshop")) {
      return /\/\d{5,8}$/.test(location.pathname) || !!document.querySelector(".site-currency-attention");
    }
    if (host.includes("power.fi")) {
      return /\/product\//.test(location.pathname);
    }
    if (host.includes("jimms")) {
      return /\/product\//.test(location.pathname) || /\/tuote\//.test(location.pathname);
    }
    const path = location.pathname.toLowerCase();
    if (/search|haku|kategoria|category|catalog/.test(path)) return false;
    return !!document.querySelector("h1");
  }

  // ── SVG Chart ────────────────────────────────────────────────
  function generateInteractiveSvgChart(historyPoints, lowestEver, avgPrice, highestEver, width, height) {
    width = width || 380;
    height = height || 136;
    if (!historyPoints || historyPoints.length < 2) {
      return '<div style="padding:15px; color:#6b7280; font-size:11px; text-align:center;">Ei riittävästi hintahistoriadataa saatavilla.</div>';
    }

    const prices = historyPoints.map((p) => p.price);
    const minP = lowestEver !== null ? lowestEver : Math.min(...prices);
    const maxP = highestEver !== null ? highestEver : Math.max(...prices);
    const pRange = maxP - minP || 1;

    const padL = 36, padR = 16, padT = 16, padB = 22;
    const chartW = width - padL - padR;
    const chartH = height - padT - padB;

    const n = historyPoints.length;
    const pts = historyPoints.map((pt, i) => {
      const x = padL + (i / Math.max(1, n - 1)) * chartW;
      const y = padT + chartH - ((pt.price - minP) / pRange) * chartH;
      return { x, y, price: pt.price, date: pt.date, title: pt.title || pt.date, offers: pt.offers || [] };
    });

    let pathD = `M ${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) {
      pathD += ` L ${pts[i].x.toFixed(1)},${pts[i].y.toFixed(1)}`;
    }

    const areaD = `${pathD} L ${pts[pts.length - 1].x.toFixed(1)},${(height - padB).toFixed(1)} L ${pts[0].x.toFixed(1)},${(height - padB).toFixed(1)} Z`;
    const avgY = avgPrice ? (padT + chartH - ((avgPrice - minP) / pRange) * chartH) : null;
    const firstDate = historyPoints[0].date || "";
    const lastDate = historyPoints[historyPoints.length - 1].date || "";

    const dotsSvg = pts.map((pt) => {
      const jsonOffers = esc(JSON.stringify({ title: pt.title, price: pt.price, offers: pt.offers }));
      return `<circle class="hf-chart-dot" data-info="${jsonOffers}" cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="3.5" fill="#10b981" stroke="#ffffff" stroke-width="1.5"/>`;
    }).join("");

    let avgLine = "";
    if (avgY !== null) {
      avgLine = `<line x1="${padL}" y1="${avgY.toFixed(1)}" x2="${width - padR}" y2="${avgY.toFixed(1)}" stroke="#f59e0b" stroke-dasharray="3,3" stroke-width="1.2"/>` +
        `<text x="${width - padR}" y="${avgY - 4}" font-size="8" fill="#d97706" text-anchor="end" font-weight="700">Keskihinta ${Math.round(avgPrice)}€</text>`;
    }

    return `<div style="position:relative;">` +
      `<div class="hf-point-tooltip" id="hf-pt-tooltip" style="display:none;"></div>` +
      `<svg viewBox="0 0 ${width} ${height}" style="width:100%; height:auto; display:block;">` +
      `<defs><linearGradient id="hfGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#10b981" stop-opacity="0.30"/><stop offset="100%" stop-color="#10b981" stop-opacity="0.0"/></linearGradient></defs>` +
      `<line x1="${padL}" y1="${padT}" x2="${width - padR}" y2="${padT}" stroke="#e5e7eb" stroke-dasharray="3,3"/>` +
      `<text x="${padL - 4}" y="${padT + 3}" font-size="9" fill="#9ca3af" text-anchor="end" font-weight="600">${Math.round(maxP)}€</text>` +
      avgLine +
      `<line x1="${padL}" y1="${height - padB}" x2="${width - padR}" y2="${height - padB}" stroke="#e5e7eb" stroke-dasharray="3,3"/>` +
      `<text x="${padL - 4}" y="${height - padB + 3}" font-size="9" fill="#9ca3af" text-anchor="end" font-weight="600">${Math.round(minP)}€</text>` +
      `<text x="${padL}" y="${height - 6}" font-size="9" fill="#9ca3af">${firstDate}</text>` +
      `<text x="${width - padR}" y="${height - 6}" font-size="9" fill="#9ca3af" text-anchor="end">${lastDate}</text>` +
      `<path d="${areaD}" fill="url(#hfGrad)"/>` +
      `<path d="${pathD}" fill="none" stroke="#10b981" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>` +
      dotsSvg +
      `</svg></div>`;
  }

  // ── Forecast ─────────────────────────────────────────────────
  function generateForecastData(pts, currentPrice, lowestEver, avgPrice) {
    if (!pts || pts.length < 4) return null;
    const drops = [];
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1].price;
      const curr = pts[i].price;
      if (prev > 0 && (prev - curr) / prev >= 0.10) {
        drops.push({ date: pts[i].date, to: curr, pct: Math.round(((prev - curr) / prev) * 100) });
      }
    }
    if (drops.length === 0) return null;

    const months = [];
    for (let j = 0; j < drops.length; j++) {
      try {
        const mon = parseInt(drops[j].date.split("-")[1], 10);
        if (mon > 0) months.push(mon);
      } catch (e) {}
    }
    const freq = {};
    months.forEach((m) => { freq[m] = (freq[m] || 0) + 1; });
    const topMonths = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 3).map((e) => parseInt(e[0], 10));
    const monthNames = topMonths.map((m) => MONTH_FI[m] || "").filter(Boolean);

    const isAtLow = currentPrice !== null && lowestEver !== null && currentPrice <= lowestEver * 1.03;
    const dropExamples = drops.slice(-3).map((d) => `${d.date.substring(0, 7)} (${fmt(d.to)}, -${d.pct}%)`).join(", ");
    const shortSeason = monthNames[0] || "seuraavassa alennussesongissa";

    let detailedText = "";
    if (isAtLow) {
      detailedText = `Tuote on nyt <strong>historiansa alimmalla tasolla (${fmt(currentPrice)})</strong>! Aikaisemmat pudotukset: ${monthNames.join(", ")} (${dropExamples}). Hinta nousee tyypillisesti ~${fmt(avgPrice)} tasolle. <strong>Nyt on erinomainen aika ostaa.</strong>`;
    } else {
      detailedText = `Hinta on pudonnut tyypillisesti <strong>${monthNames.join(", ")}</strong> (${dropExamples}). Seuraava ale odotettavissa <strong>${shortSeason}</strong>, jolloin hinta voi laskea lähelle ${fmt(lowestEver)} tasoa.`;
    }
    return { shortSeason, isAtLow, detailedText };
  }

  // ── Find Product Title ───────────────────────────────────────
  function findProductName() {
    try {
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (let k = 0; k < scripts.length; k++) {
        try {
          const data = JSON.parse(scripts[k].textContent);
          let p = null;
          if (data["@type"] === "Product") p = data;
          else if (Array.isArray(data["@graph"])) p = data["@graph"].find((x) => x["@type"] === "Product");
          if (p && p.name) return p.name;
        } catch (e) {}
      }
    } catch (e) {}

    const h1 = document.querySelector("h1");
    if (h1 && h1.textContent.trim().length > 3) return h1.textContent.trim();

    const og = document.querySelector("meta[property='og:title']");
    if (og && og.content && og.content.length > 3) {
      return og.content.replace(/\s*[-–|].*$/, "").trim();
    }
    return null;
  }

  // ── Buy Box Detection ───────────────────────────────────────
  function locateProductBuyBox() {
    let storePrice = null;
    let anchor = null;
    let claimedNorm = null;
    let claimedSavings = null;

    try {
      // ──── 1. Gigantti.fi (Exact live DOM match) ─────────────
      if (host.includes("gigantti")) {
        // Targeted Gigantti buy-box selector
        const buyBox = document.querySelector('[data-cro="pdp-buy-box"], [data-testid="pdp-buy-box"]');
        const mainPriceBox = document.querySelector('[data-cro="pdp-main-price-box"]');

        if (mainPriceBox || buyBox) {
          const scope = mainPriceBox || buyBox;

          // Price value
          const primaryEl = scope.querySelector('[data-primary-price]');
          if (primaryEl) {
            storePrice = parseFloat(primaryEl.getAttribute('data-primary-price')) || null;
          }
          if (!storePrice) {
            const incVat = scope.querySelector('.inc-vat');
            if (incVat) storePrice = parsePrice(incVat.textContent);
          }

          // Savings
          const saveEl = scope.querySelector('[data-highlight-price]');
          if (saveEl) {
            claimedSavings = parseFloat(saveEl.getAttribute('data-highlight-price')) || null;
          }

          // Normal price
          const normEl = scope.querySelector('[data-secondary-price]');
          if (normEl) {
            claimedNorm = parseFloat(normEl.getAttribute('data-secondary-price')) || null;
          }

          // Anchor: use mainPriceBox or primaryEl's container
          anchor = mainPriceBox || primaryEl || buyBox.firstElementChild || buyBox;

          log("Gigantti buybox found:", { storePrice, claimedNorm, claimedSavings, anchorTag: anchor.tagName });
          return { storePrice, anchor, claimedNorm, claimedSavings };
        }
      }

      // ──── 2. Verkkokauppa.com (Exact live DOM match) ─────────
      if (host.includes("verkkokauppa")) {
        const aside = document.querySelector("aside");
        if (aside) {
          const curData = aside.querySelector("data[data-price='current']");
          const prevData = aside.querySelector("data[data-price='previous'], data[class*='previousData']");
          if (curData) storePrice = parseFloat(curData.getAttribute("value")) || null;
          if (prevData) claimedNorm = parseFloat(prevData.getAttribute("value")) || null;

          const asideText = aside.textContent || "";
          const saveM = asideText.match(/säästä\s*([\d\s\u00a0,.]+)\s*€/i);
          if (saveM) claimedSavings = parsePrice(saveM[1]);

          if (!storePrice) {
            const curM = asideText.match(/(\d+[\.,]\d{2})\s*€/);
            if (curM) storePrice = parsePrice(curM[1]);
          }

          // In Verkkokauppa, anchor directly next to/below the price row
          const priceRoot = aside.querySelector("[class*='stm-price__root']");
          const priceBlock = priceRoot?.closest("[class*='stm-blockstack'], [class*='stm-inlinestack']") || priceRoot;

          anchor = priceBlock || aside.firstElementChild || aside;
          log("Verkkokauppa buybox found:", { storePrice, claimedNorm, claimedSavings, anchorTag: anchor.tagName });
          return { storePrice, anchor, claimedNorm, claimedSavings };
        }
      }

      // ──── 3. Proshop.fi ──────────────────────────────────────
      if (host.includes("proshop")) {
        const priceEl = document.querySelector(".site-currency-attention, [class*='site-currency']");
        if (priceEl) {
          storePrice = parsePrice(priceEl.textContent);
          anchor = priceEl.closest(".site-product-price, .site-product-buy-panel") || priceEl.parentElement || priceEl;
          return { storePrice, anchor, claimedNorm: null, claimedSavings: null };
        }
      }

      // ──── 4. Generic Fallback ────────────────────────────────
      const main = document.querySelector("main") || document.body;
      const allEls = main.querySelectorAll("div, span, p, strong");
      let bestEl = null;
      let maxScore = -1;

      for (let i = 0; i < allEls.length; i++) {
        const el = allEls[i];
        if (el.closest("header, nav, footer, [role='banner']")) continue;
        if (el.id === "hintafi-price-widget" || el.closest("#hintafi-price-widget")) continue;

        try {
          const cs = window.getComputedStyle(el);
          if (cs.position === "fixed") continue;
        } catch (e) {}

        const txt = (el.textContent || "").trim();
        if (txt.length > 50) continue;
        if (txt.includes("€") && /\d+/.test(txt)) {
          const p = parsePrice(txt);
          if (p && p >= 5 && p < 50000) {
            const style = window.getComputedStyle(el);
            const fs = parseFloat(style.fontSize) || 14;
            const fw = parseInt(style.fontWeight) || 400;
            let score = fs * 2 + (fw >= 600 ? 30 : 0);
            if (fs >= 24) score += 40;

            const ptxt = (el.parentElement?.textContent || "").substring(0, 100);
            if (/säästä|norm\.|ovh/i.test(ptxt)) score += 50;

            if (score > maxScore) {
              maxScore = score;
              bestEl = el;
              storePrice = p;
            }
          }
        }
      }

      if (bestEl) {
        anchor = bestEl.parentElement || bestEl;
        return { storePrice, anchor, claimedNorm, claimedSavings };
      }
    } catch (err) {
      log("Error in locateProductBuyBox:", err);
    }

    // Ultimate fallback: right below h1
    const h1 = document.querySelector("h1");
    if (h1) {
      return { storePrice, anchor: h1, claimedNorm: null, claimedSavings: null };
    }

    return { storePrice: null, anchor: null, claimedNorm: null, claimedSavings: null };
  }

  // ── Render Product Page Widget ───────────────────────────────
  function renderProductPageWidget(widget, product, details, storePrice, claimedNorm, claimedSavings, rawQuery) {
    const match = product.matchPercent || 0;
    const badgeCls = match >= 70 ? "hf-badge-high" : match >= 40 ? "hf-badge-med" : "hf-badge-low";

    const low = details.lowestEver || null;
    const avg = details.averagePrice || null;
    const high = details.highestEver || null;
    const curLow = details.currentLowest || product.currentLowestPrice || null;
    const stores = details.stores || [];
    const pts = details.historyPoints || [];
    const histUrl = details.historyUrl || product.url || "";

    const price = storePrice || curLow;
    const extUrls = getExternalUrls(product.name || rawQuery);
    const sourceLabel = product.source === "hintaopas" ? "Hintaopas.fi" : "Hinta.fi";

    // Deal pill & savings
    let dealHtml = "";
    let normHtml = "";
    let savingsHtml = "";

    if (price && avg) {
      const diff = price - avg;
      const pct = Math.round((diff / avg) * 100);

      if (low !== null && price <= low * 1.03) {
        dealHtml = `<div class="hf-deal-pill all-time-low"><span class="hf-arrow-down">↓</span> 🏆 Kaikkien aikojen alin hinta!</div>`;
      } else if (pct < -5) {
        dealHtml = `<div class="hf-deal-pill discount"><span class="hf-arrow-down">↓</span> Todellinen ale: -${Math.abs(pct)}% keskihinnasta</div>`;
      } else if (pct > 5) {
        dealHtml = `<div class="hf-deal-pill fake"><span class="hf-arrow-up">↑</span> 🚨 Feikkiale: +${pct}% yli keskihinnan!</div>`;
      } else {
        dealHtml = `<div class="hf-deal-pill fake"><span>⚠️</span> Normaali hintataso – ei aitoa alennusta</div>`;
      }

      if (claimedNorm && claimedNorm > avg * 1.1) {
        normHtml = `
          <div class="hf-mini-row">
            <span class="hf-mini-label">Oikea normihinta:</span>
            <span>
              <strong class="hf-mini-val">${fmt(avg)}</strong>
              <span class="hf-mini-val strikethrough" title="Kaupan väittämä normihinta">väite ${fmt(claimedNorm)}</span>
            </span>
          </div>`;
      } else {
        normHtml = `
          <div class="hf-mini-row">
            <span class="hf-mini-label">Oikea normihinta:</span>
            <strong class="hf-mini-val">${fmt(avg)}</strong>
          </div>`;
      }

      if (pct < 0) {
        const realSaved = Math.abs(diff);
        const realSavedPct = Math.abs(pct);
        if (claimedSavings && claimedSavings > realSaved * 1.25) {
          savingsHtml = `
            <div class="hf-mini-row">
              <span class="hf-mini-label">Todellinen säästö:</span>
              <span>
                <strong class="hf-mini-val green">${fmt(realSaved)} (-${realSavedPct}%)</strong>
                <span class="hf-mini-val strikethrough" title="Kaupan väittämä säästö">väite ${fmt(claimedSavings)}</span>
              </span>
            </div>`;
        } else {
          savingsHtml = `
            <div class="hf-mini-row">
              <span class="hf-mini-label">Todellinen säästö:</span>
              <strong class="hf-mini-val green">${fmt(realSaved)} (-${realSavedPct}%)</strong>
            </div>`;
        }
      }
    } else if (price && curLow && price > curLow * 1.05) {
      const diff = price - curLow;
      const pct = Math.round((diff / price) * 100);
      dealHtml = `<div class="hf-deal-pill fake"><span>ℹ️</span> Muualla edullisempi: säästä ${fmt(diff)} (-${pct}%)</div>`;
    }

    // Forecast
    const fc = generateForecastData(pts, price, low, avg);
    let forecastHtml = "";
    if (fc) {
      forecastHtml = `
        <div class="hf-compact-forecast">
          <div class="hf-forecast-left">
            <span>📅</span>
            <span>Arvioitu ale: <strong>${esc(fc.shortSeason)}</strong></span>
            <span class="hf-info-btn" title="Lue hintakehitysarvio">ℹ️</span>
            <div class="hf-info-tooltip">${fc.detailedText}</div>
          </div>
        </div>`;
    }

    // External search bar
    const sourcesBarHtml = `
      <div class="hf-sources-bar">
        <span class="hf-sources-label">Vertaa myös:</span>
        <a href="${esc(extUrls.hintaopas)}" target="_blank" rel="noopener noreferrer" class="hf-source-pill">Hintaopas.fi ↗</a>
        <a href="${esc(extUrls.vertaa)}" target="_blank" rel="noopener noreferrer" class="hf-source-pill">Vertaa.fi ↗</a>
      </div>`;

    // Clickable store rows
    let storesHtml = "";
    if (stores.length > 0) {
      const rows = stores.slice(0, 5).map((s, i) => {
        const targetUrl = s.storeUrl || histUrl;
        return `
          <a href="${esc(targetUrl)}" target="_blank" rel="noopener noreferrer" class="hf-store-link-row" title="Siirry kauppaan ${esc(s.name)}">
            <span class="hf-popover-store-name">${i === 0 ? "🏆 " : ""}${esc(s.name)} <span class="hf-link-icon">↗</span></span>
            <div>
              <span class="hf-popover-store-price">${fmtExact(s.price)}</span>
              ${s.delivery ? `<span class="hf-popover-store-delivery">(${esc(s.delivery)})</span>` : ""}
            </div>
          </a>`;
      }).join("");

      storesHtml = `
        <div class="hf-popover-stores">
          <div class="hf-popover-stores-title">Kaupat &amp; hinnat nyt (${stores.length} kpl - klikkaa kauppaan):</div>
          ${rows}
        </div>`;
    }

    // Interactive chart
    const chartHtml = generateInteractiveSvgChart(pts, low, avg, high);
    let chartStatsHtml = "";
    if (pts.length >= 2) {
      chartStatsHtml = `
        <div class="hf-chart-stats">
          <span>Korkein: <strong>${fmt(high)}</strong></span>
          <span>Keskihinta: <strong>${fmt(avg)}</strong></span>
          <span>Alin: <strong>${fmt(low)}</strong></span>
        </div>`;
    }

    // Assemble inner HTML
    widget.innerHTML = `
      <div class="hf-mini-header">
        <span class="hf-mini-logo">💰 ${sourceLabel} Vertailu</span>
        <span class="hf-mini-badge ${badgeCls}">${match}% vastaavuus</span>
      </div>

      ${dealHtml}

      <div class="hf-mini-details">
        ${normHtml}
        ${savingsHtml}
        ${curLow !== null ? `<div class="hf-mini-row"><span class="hf-mini-label">🏷️ Halvin nyt:</span><strong class="hf-mini-val">${fmt(curLow)}</strong></div>` : ""}
        ${low !== null ? `<div class="hf-mini-row"><span class="hf-mini-label">📉 Alin ikinä:</span><strong class="hf-mini-val">${fmt(low)}</strong></div>` : ""}
      </div>

      ${forecastHtml}
      ${sourcesBarHtml}

      <div class="hf-hover-hint">
        <span>📈 Vie hiiri: hintakäyrä &amp; kaupat</span>
        <span>▾</span>
      </div>

      <div class="hf-popover" id="hintafi-hover-popover">
        <div class="hf-popover-title">
          <span>📈 Hintakehitys (vie hiiri pisteiden päälle)</span>
          <span style="font-size:11px; font-weight:normal; color:#6b7280">${esc(product.name)}</span>
        </div>

        <div class="hf-chart-box">
          ${chartHtml}
          ${chartStatsHtml}
        </div>

        ${storesHtml}

        <a class="hf-popover-btn" href="${esc(histUrl)}" target="_blank" rel="noopener noreferrer">
          Avaa tuote ja kaupat palvelussa ➔
        </a>
      </div>
    `;

    // Tooltip listeners
    const chartBox = widget.querySelector(".hf-chart-box");
    const ptTooltip = widget.querySelector("#hf-pt-tooltip");
    if (chartBox && ptTooltip) {
      widget.querySelectorAll(".hf-chart-dot").forEach((dot) => {
        dot.addEventListener("mouseenter", () => {
          try {
            const data = JSON.parse(dot.getAttribute("data-info"));
            let offersText = "";
            if (data.offers && data.offers.length > 0) {
              offersText = data.offers
                .slice(0, 4)
                .map((o) => `<div>• ${esc(o.store)}: <strong>${fmt(o.price)}</strong></div>`)
                .join("");
            }
            ptTooltip.innerHTML = `
              <div class="hf-point-title">${esc(data.title)}</div>
              <div>Alin hinta: <strong>${fmt(data.price)}</strong></div>
              ${offersText ? `<div class="hf-point-stores-list" style="margin-top:3px;">${offersText}</div>` : ""}
            `;
            ptTooltip.style.display = "block";
          } catch (err) {}
        });
      });
      chartBox.addEventListener("mouseleave", () => { ptTooltip.style.display = "none"; });
    }

    // Main Popover hover/click
    const pop = widget.querySelector("#hintafi-hover-popover");
    let ht = null;
    const show = () => { clearTimeout(ht); pop.classList.add("hf-visible"); };
    const hide = () => { ht = setTimeout(() => pop.classList.remove("hf-visible"), 250); };

    widget.addEventListener("mouseenter", show);
    widget.addEventListener("mouseleave", hide);
    pop.addEventListener("mouseenter", () => clearTimeout(ht));
    pop.addEventListener("mouseleave", hide);
    widget.addEventListener("click", (e) => {
      if (!e.target.closest("a")) pop.classList.toggle("hf-visible");
    });
  }

  // ── Main Pipeline: Product Page ──────────────────────────────
  async function runProductPage() {
    if (isProcessingProduct) return;
    if (document.getElementById("hintafi-price-widget")) return;
    if (!isProductPage()) return;

    const productName = findProductName();
    if (!productName) {
      log("Product name not found yet");
      return;
    }
    log("Product detected:", productName);

    const buyBoxInfo = locateProductBuyBox();
    if (!buyBoxInfo.anchor) {
      log("Anchor not found yet");
      return;
    }
    log("Anchor element found:", buyBoxInfo.anchor);

    isProcessingProduct = true;

    const widget = document.createElement("div");
    widget.id = "hintafi-price-widget";
    widget.innerHTML = `
      <div class="hf-mini-header">
        <span class="hf-mini-logo">💰 Aitohinta</span>
        <span class="hf-mini-badge hf-badge-med">Haetaan…</span>
      </div>
      <div class="hf-mini-loading"><span class="hf-mini-spinner"></span> Haetaan vertailuhintoja…</div>
    `;

    // Place directly adjacent to price
    buyBoxInfo.anchor.insertAdjacentElement("afterend", widget);
    log("Widget placed into DOM!");

    try {
      const searchRes = await browser.runtime.sendMessage({
        action: "searchMultiSource",
        productName,
      });

      const extUrls = getExternalUrls(productName);

      if (!searchRes || !searchRes.results || searchRes.results.length === 0) {
        log("No automatic results found");
        widget.innerHTML = `
          <div class="hf-mini-header">
            <span class="hf-mini-logo">💰 Aitohinta</span>
          </div>
          <div class="hf-not-found-box">
            <div class="hf-not-found-title">ℹ️ Ei automaattista osumaa</div>
            <div class="hf-not-found-desc">Vertaa tuotteen hintaa yhdellä klikkauksella:</div>
            <div class="hf-not-found-buttons">
              <a class="hf-alt-btn" href="${esc(extUrls.hintafi)}" target="_blank" rel="noopener noreferrer">🔍 Hinta.fi ➔</a>
              <a class="hf-alt-btn" href="${esc(extUrls.hintaopas)}" target="_blank" rel="noopener noreferrer">🔍 Hintaopas.fi ➔</a>
              <a class="hf-alt-btn" href="${esc(extUrls.vertaa)}" target="_blank" rel="noopener noreferrer">🔍 Vertaa.fi ➔</a>
            </div>
          </div>
        `;
        isProcessingProduct = false;
        return;
      }

      const best = searchRes.results[0];
      log("Best match:", best.name, "match:", best.matchPercent, "source:", best.source);

      let details = {};
      try {
        const detailsRes = await browser.runtime.sendMessage({
          action: "getProductDetails",
          url: best.url,
          source: best.source,
        });
        details = detailsRes && detailsRes.success ? detailsRes.data : {};
      } catch (e) {
        log("getProductDetails error:", e);
      }

      // Fallback fields if details call returned partial data
      if (!details.currentLowest && best.currentLowestPrice) {
        details.currentLowest = best.currentLowestPrice;
      }
      if (!details.productName && best.name) {
        details.productName = best.name;
      }
      if (!details.historyUrl) {
        details.historyUrl = best.url;
      }

      renderProductPageWidget(
        widget,
        best,
        details,
        buyBoxInfo.storePrice,
        buyBoxInfo.claimedNorm,
        buyBoxInfo.claimedSavings,
        productName
      );
    } catch (err) {
      log("Search execution error:", err);
      const extUrls = getExternalUrls(productName);
      widget.innerHTML = `
        <div class="hf-mini-header">
          <span class="hf-mini-logo">💰 Aitohinta</span>
        </div>
        <div class="hf-not-found-box">
          <div class="hf-not-found-title">ℹ️ Avaa hintavertailu suoraan:</div>
          <div class="hf-not-found-buttons">
            <a class="hf-alt-btn" href="${esc(extUrls.hintafi)}" target="_blank" rel="noopener noreferrer">🔍 Hinta.fi ➔</a>
            <a class="hf-alt-btn" href="${esc(extUrls.hintaopas)}" target="_blank" rel="noopener noreferrer">🔍 Hintaopas.fi ➔</a>
            <a class="hf-alt-btn" href="${esc(extUrls.vertaa)}" target="_blank" rel="noopener noreferrer">🔍 Vertaa.fi ➔</a>
          </div>
        </div>
      `;
    } finally {
      isProcessingProduct = false;
    }
  }

  // ── Category / Search Listing Scanner ─────────────────────────
  // Shows a "Hae hinta" button on each listing card instead of auto-fetching
  // to avoid flood protection / rate limiting from price comparison sites
  async function scanProductListings() {
    if (isProductPage()) return;
    if (isScanningListings) return;

    let cardElements = [];

    if (host.includes("verkkokauppa")) {
      const pLinks = document.querySelectorAll("a[href*='/product/']");
      pLinks.forEach((a) => {
        let p = a.parentElement;
        for (let i = 0; i < 5 && p; i++) {
          if (p.tagName === "ARTICLE" || p.tagName === "LI" || (p.className && (String(p.className).includes("card") || String(p.className).includes("product")))) {
            if (!cardElements.includes(p)) cardElements.push(p);
            break;
          }
          p = p.parentElement;
        }
      });
    }

    if (host.includes("gigantti")) {
      const cards = document.querySelectorAll("[data-testid*='product-card'], article[class*='product']");
      cards.forEach((c) => { if (!cardElements.includes(c)) cardElements.push(c); });
    }

    if (host.includes("proshop")) {
      const cards = document.querySelectorAll(".site-product-list-item, li[class*='product']");
      cards.forEach((c) => { if (!cardElements.includes(c)) cardElements.push(c); });
    }

    const pending = cardElements
      .filter((c) => !c.querySelector(".hf-listing-badge-container"))
      .slice(0, 20);

    if (pending.length === 0) return;

    isScanningListings = true;

    for (const card of pending) {
      let title = "";
      const tEl = card.querySelector("h2, h3, h4, a[class*='title'], a[href*='/product']");
      if (tEl) title = tEl.textContent.trim();
      if (!title || title.length < 5) continue;

      let cardPrice = null;
      const allText = card.textContent || "";
      const pM = allText.match(/(\d[\d\s\u00a0]*[\.,]\d{2}|\d+)\s*€/);
      if (pM) cardPrice = parsePrice(pM[0]);

      const priceAnchor =
        card.querySelector("[class*='stm-price__root'], [class*='price__root'], [class*='stm-price'], [class*='Price'], data[data-price='current'], [data-testid*='price']") ||
        card.querySelector("button")?.parentElement ||
        card.lastElementChild;
      if (!priceAnchor) continue;

      // Create a "Hae hinta" button instead of auto-fetching
      const badgeContainer = document.createElement("div");
      badgeContainer.className = "hf-listing-badge-container";
      badgeContainer.innerHTML = `
        <button class="hf-listing-fetch-btn" title="Hae vertailuhinta tähän tuotteeseen">
          💰 Hae hinta
        </button>
      `;

      priceAnchor.insertAdjacentElement("afterend", badgeContainer);

      // Attach click handler to fetch prices on demand
      const btn = badgeContainer.querySelector(".hf-listing-fetch-btn");
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();

        // Show loading state
        btn.disabled = true;
        btn.textContent = "⏳ Haetaan…";
        btn.classList.add("hf-listing-btn-loading");

        try {
          let cached = listingCache.get(title);
          if (!cached) {
            const searchRes = await browser.runtime.sendMessage({
              action: "searchMultiSource",
              productName: title,
            });

            if (searchRes && searchRes.results && searchRes.results.length > 0) {
              const best = searchRes.results[0];
              let details = {};
              try {
                const detailsRes = await browser.runtime.sendMessage({
                  action: "getProductDetails",
                  url: best.url,
                  source: best.source,
                });
                details = detailsRes && detailsRes.success ? detailsRes.data : {};
              } catch (e) {
                log("Listing getProductDetails error:", e);
              }
              if (!details.currentLowest && best.currentLowestPrice) {
                details.currentLowest = best.currentLowestPrice;
              }
              cached = { best, details };
              listingCache.set(title, cached);
            } else {
              listingCache.set(title, { notFound: true });
            }
          }

          if (!cached || cached.notFound || !cached.best) {
            const extUrls = getExternalUrls(title);
            badgeContainer.innerHTML = `
              <div class="hf-listing-pill hf-listing-not-found">
                <span>💰</span>
                <span class="hf-listing-norm">Ei osumaa</span>
                <a href="${esc(extUrls.hintafi)}" target="_blank" class="hf-listing-link-btn" title="Hae Hinta.fi:stä">Hinta.fi ↗</a>
                <a href="${esc(extUrls.hintaopas)}" target="_blank" class="hf-listing-link-btn" title="Hae Hintaopas:sta">Hintaopas ↗</a>
              </div>
            `;
            return;
          }

          const best = cached.best;
          const details = cached.details || {};
          const avg = details.averagePrice;
          const curLow = details.currentLowest || best.currentLowestPrice;

          if (!avg && !curLow) {
            badgeContainer.innerHTML = `
              <div class="hf-listing-pill">
                <span>💰</span>
                <span class="hf-listing-norm">Ei hintatietoja</span>
              </div>
            `;
            return;
          }

          const isCheaperElsewhere = cardPrice && curLow && cardPrice > curLow * 1.05;
          const diffFromAvg = (cardPrice || curLow) - (avg || cardPrice || 0);
          const pctFromAvg = avg ? Math.round((diffFromAvg / avg) * 100) : 0;
          const extUrls = getExternalUrls(best.name || title);

          badgeContainer.innerHTML = `
            <div class="hf-listing-pill">
              <span>💰</span>
              ${avg ? `<span class="hf-listing-norm">Norm. ~${fmt(avg)}</span>` : ""}
              ${pctFromAvg < 0 ? `<span class="hf-listing-discount">↓ -${Math.abs(pctFromAvg)}%</span>` : ""}
              ${isCheaperElsewhere ? `<span class="hf-listing-cheaper">Muualla: ${fmt(curLow)}</span>` : ""}
              <span class="hf-listing-info-icon">ℹ️</span>
            </div>
            <div class="hf-listing-popover">
              <div style="font-weight:700; color:#111827; margin-bottom:4px;">${esc(best.name)}</div>
              <div>Vastaavuus: <strong>${best.matchPercent}%</strong></div>
              ${avg ? `<div>Oikea normihinta: <strong>${fmt(avg)}</strong></div>` : ""}
              ${curLow ? `<div>Halvin hinta nyt: <strong style="color:#059669;">${fmt(curLow)}</strong></div>` : ""}
              ${details.lowestEver ? `<div>Alin koskaan: <strong>${fmt(details.lowestEver)}</strong></div>` : ""}
              <div style="margin-top:6px; display:flex; gap:6px; flex-wrap:wrap;">
                <a href="${esc(best.url)}" target="_blank" style="color:#2563eb; text-decoration:none; font-weight:700;">Avaa tuote ➔</a>
                <a href="${esc(extUrls.hintaopas)}" target="_blank" style="color:#2563eb; text-decoration:none; font-weight:700;">Hintaopas ↗</a>
                <a href="${esc(extUrls.vertaa)}" target="_blank" style="color:#2563eb; text-decoration:none; font-weight:700;">Vertaa.fi ↗</a>
              </div>
            </div>
          `;
        } catch (err) {
          log("Listing fetch error:", err);
          btn.textContent = "❌ Virhe – yritä uudelleen";
          btn.disabled = false;
          btn.classList.remove("hf-listing-btn-loading");
        }
      });
    }

    isScanningListings = false;
  }

  // ── Dispatcher & Watcher ─────────────────────────────────────
  function checkAndRun() {
    if (isProductPage()) {
      runProductPage();
    } else {
      scanProductListings();
    }
  }

  // Initial runs
  [400, 1200, 2500].forEach((ms) => setTimeout(checkAndRun, ms));

  // SPA navigation watcher
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      isProcessingProduct = false;
      const old = document.getElementById("hintafi-price-widget");
      if (old) old.remove();
      [400, 1200, 2500].forEach((ms) => setTimeout(checkAndRun, ms));
    }
  }, 800);

  // MutationObserver for dynamically loaded cards / content
  let mutTimer = null;
  const observer = new MutationObserver(() => {
    clearTimeout(mutTimer);
    mutTimer = setTimeout(checkAndRun, 600);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Popup listener
  browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "getProductInfo") {
      const buyBox = locateProductBuyBox();
      sendResponse({
        productName: findProductName(),
        currentPrice: buyBox.storePrice,
        url: location.href,
      });
    }
  });
})();
