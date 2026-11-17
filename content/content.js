// content/content.js
// Aitohinta – Hintatarkistaja & Hintavertailu
// Multi-source: Hinta.fi, Hintaopas.fi, Vertaa.fi
// Injects price-check badges directly next to product prices and in listing cards

(function () {
  "use strict";

  if (typeof browser === "undefined") {
    globalThis.browser = globalThis.chrome;
  }

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
      const path = location.pathname;
      if (/search|haku|kategoria|category|catalog/i.test(path)) return false;
      if (document.querySelector(".site-product-list, #site-product-list, .site-product-list-item")) return false;
      return /\/\d{5,9}(\/|$)/.test(path) || !!document.querySelector(".site-product-priceRelationsStockContainer, h1.site-product-title");
    }
    if (host.includes("power.fi")) {
      return /\/product\//.test(location.pathname);
    }
    if (host.includes("jimms")) {
      return /\/product\//.test(location.pathname) || /\/tuote\//.test(location.pathname);
    }
    if (host.includes("elisa")) {
      return /\/kauppa\/tuote\//.test(location.pathname) || /\/kauppa\/.*\/tuote/.test(location.pathname) || !!document.querySelector("[data-testid*='pdp'], [data-testid*='product-page']");
    }
    if (host.includes("dna")) {
      return /\/tuotteet\//.test(location.pathname) || /\/laitteet\//.test(location.pathname) || /\/tuote\//.test(location.pathname) || !!document.querySelector("[data-testid*='product-page']");
    }
    if (host.includes("telia")) {
      return /\/kauppa\/.*\/tuote/.test(location.pathname) || /\/kauppa\/laitteet\//.test(location.pathname) || /\/tuote\//.test(location.pathname) || !!document.querySelector("[data-testid*='product-page']");
    }
    if (host.includes("prisma")) {
      return /\/tuotteet\//.test(location.pathname) || /\/tuote\//.test(location.pathname);
    }
    if (host.includes("tokmanni")) {
      return /\-\d{8,14}$/.test(location.pathname) || /\/tuote\//.test(location.pathname);
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
    // 1. Store-specific title selectors if available
    const specificH1 = document.querySelector("h1.site-product-title, [data-cro='pdp-product-title'], [data-testid*='product-title'], [class*='ProductTitle']");
    if (specificH1 && specificH1.textContent.trim().length > 3) {
      return specificH1.textContent.trim();
    }

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
      return og.content.replace(/\s*[-–|]\s*(proshop|gigantti|verkkokauppa|power|elisa|dna|telia|prisma|tokmanni|edullinen).*$/i, "").trim();
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

      // ──── 3. Proshop.fi (Exact live DOM match) ─────────────
      if (host.includes("proshop")) {
        // Find price elements excluding fixed bottom ribbons
        const priceEls = Array.from(document.querySelectorAll(".site-currency-attention, .site-currency-wrapper, .site-product-priceRelationsStockContainer, [class*='site-currency']"));
        const mainPriceEl = priceEls.find((el) => !el.closest(".bottom-ribbon-price, [class*='ribbon']")) || priceEls[0];

        if (mainPriceEl) {
          const rawPriceEl = mainPriceEl.querySelector(".site-currency-attention") || mainPriceEl;
          storePrice = parsePrice(rawPriceEl.textContent);

          // Check if there was an expired campaign price or normal price
          const prevEl = document.querySelector(".site-currency-expired, .site-currency-pre");
          if (prevEl) {
            claimedNorm = parsePrice(prevEl.textContent);
          }

          // Anchor directly below the main buy/price container in main view
          const buyContainer = mainPriceEl.closest(".site-product-priceRelationsStockContainer, .site-product-stock-price-buy, [class*='priceRelations'], [class*='stock-price']") ||
                               mainPriceEl.closest(".site-currency-wrapper")?.parentElement ||
                               mainPriceEl.closest(".site-currency-wrapper") ||
                               mainPriceEl;

          anchor = buyContainer || mainPriceEl;
          log("Proshop buybox found:", { storePrice, claimedNorm, anchorTag: anchor.tagName, anchorClass: anchor.className });
          return { storePrice, anchor, claimedNorm, claimedSavings };
        }
      }

      // ──── 4. Prisma.fi ──────────────────────────────────────
      if (host.includes("prisma")) {
        const priceEl = document.querySelector("[data-testid*='product-price'], [class*='ProductPrice'], [class*='Price_price'], [data-test-id*='price']");
        if (priceEl) {
          storePrice = parsePrice(priceEl.textContent);
          const normEl = document.querySelector("[class*='CrossedPrice'], [class*='originalPrice'], [class*='oldPrice']");
          if (normEl) claimedNorm = parsePrice(normEl.textContent);
          const buyBtn = document.querySelector("[data-testid*='add-to-cart'], button[class*='AddToCart']");
          anchor = buyBtn?.parentElement || priceEl.closest("[class*='ProductDetails'], [class*='ProductInfo']") || priceEl.parentElement || priceEl;
          return { storePrice, anchor, claimedNorm, claimedSavings };
        }
      }

      // ──── 5. Tokmanni.fi ────────────────────────────────────
      if (host.includes("tokmanni")) {
        const priceEl = document.querySelector(".product-info-price, [data-price-type='finalPrice'], .price-box .price, .product-info-main .price");
        if (priceEl) {
          storePrice = parsePrice(priceEl.textContent);
          const oldPriceEl = document.querySelector(".old-price .price, [data-price-type='oldPrice']");
          if (oldPriceEl) claimedNorm = parsePrice(oldPriceEl.textContent);
          anchor = priceEl.closest(".product-info-price") || priceEl.parentElement || priceEl;
          return { storePrice, anchor, claimedNorm, claimedSavings };
        }
      }

      // ──── 6. Elisa.fi ───────────────────────────────────────
      if (host.includes("elisa")) {
        const priceEl = document.querySelector("[data-testid*='price'], [class*='Price__Container'], [class*='ProductPrice'], [class*='price-container']");
        if (priceEl) {
          storePrice = parsePrice(priceEl.textContent);
          const normEl = document.querySelector("[data-testid*='normal-price'], [class*='NormalPrice'], [class*='old-price']");
          if (normEl) claimedNorm = parsePrice(normEl.textContent);
          anchor = priceEl.parentElement || priceEl;
          return { storePrice, anchor, claimedNorm, claimedSavings };
        }
      }

      // ──── 7. DNA.fi ─────────────────────────────────────────
      if (host.includes("dna")) {
        const priceEl = document.querySelector("[data-testid*='price'], [class*='product-summary__price'], [class*='Price__'], [class*='price-container']");
        if (priceEl) {
          storePrice = parsePrice(priceEl.textContent);
          const normEl = document.querySelector("[class*='normal-price'], [class*='old-price']");
          if (normEl) claimedNorm = parsePrice(normEl.textContent);
          anchor = priceEl.parentElement || priceEl;
          return { storePrice, anchor, claimedNorm, claimedSavings };
        }
      }

      // ──── 8. Telia.fi ───────────────────────────────────────
      if (host.includes("telia")) {
        const priceEl = document.querySelector("[data-testid*='price'], [class*='PriceContainer'], [class*='product-price'], [class*='price-wrapper']");
        if (priceEl) {
          storePrice = parsePrice(priceEl.textContent);
          const normEl = document.querySelector("[class*='normal-price'], [class*='original-price']");
          if (normEl) claimedNorm = parsePrice(normEl.textContent);
          anchor = priceEl.parentElement || priceEl;
          return { storePrice, anchor, claimedNorm, claimedSavings };
        }
      }

      // ──── 9. Generic Fallback ────────────────────────────────
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
    // Brand label - always "Aitohinta"
    const sourceLabel = "Aitohinta";

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

    // External comparison links bar
    const sourcesBarHtml = `
      <div class="hf-sources-bar">
        <span class="hf-sources-label">Vertaa palveluissa:</span>
        <a href="${esc(extUrls.hintafi)}" target="_blank" rel="noopener noreferrer" class="hf-source-pill">Hinta.fi ↗</a>
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
        <span class="hf-mini-logo">💰 Aitohinta</span>
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

        <div class="hf-popover-service-links">
          <a class="hf-popover-btn" href="${esc(histUrl)}" target="_blank" rel="noopener noreferrer">
            Avaa tuote ja kaupat (${product.source === "hintaopas" ? "Hintaopas.fi" : "Hinta.fi"}) ➔
          </a>
          ${product.source === "hintaopas" ? `
            <a class="hf-popover-btn hf-popover-btn-alt" href="${esc(extUrls.hintafi)}" target="_blank" rel="noopener noreferrer" title="Avaa vertailu Hinta.fi:ssä">
              Avaa Hinta.fi vertailu ↗
            </a>
          ` : `
            <a class="hf-popover-btn hf-popover-btn-alt" href="${esc(extUrls.hintaopas)}" target="_blank" rel="noopener noreferrer" title="Avaa vertailu Hintaopas.fi:ssä">
              Avaa Hintaopas.fi vertailu ↗
            </a>
          `}
        </div>
      </div>
    `;

    // Tooltip listeners - follow cursor directly
    const chartBox = widget.querySelector(".hf-chart-box");
    const ptTooltip = widget.querySelector("#hf-pt-tooltip");
    if (chartBox && ptTooltip) {
      const updateTooltipPos = (e) => {
        const boxRect = chartBox.getBoundingClientRect();
        const mouseX = e.clientX - boxRect.left;
        const mouseY = e.clientY - boxRect.top;

        let left = mouseX + 12;
        let top = mouseY - 15;

        if (left + 195 > boxRect.width) {
          left = mouseX - 205;
        }
        if (left < 5) left = 5;
        if (top < 5) top = 5;

        ptTooltip.style.left = left + "px";
        ptTooltip.style.top = top + "px";
        ptTooltip.style.right = "auto";
        ptTooltip.style.bottom = "auto";
      };

      widget.querySelectorAll(".hf-chart-dot").forEach((dot) => {
        dot.addEventListener("mouseenter", (e) => {
          try {
            const data = JSON.parse(dot.getAttribute("data-info"));
            let offersText = "";
            if (data.offers && data.offers.length > 0) {
              offersText = data.offers
                .slice(0, 5)
                .map((o) => `<div>• ${esc(o.store)}: <strong>${fmt(o.price)}</strong></div>`)
                .join("");
            }
            ptTooltip.innerHTML = `
              <div class="hf-point-title">📅 ${esc(data.title)}</div>
              <div style="font-size:11px; margin-bottom:2px;">Alin hinta: <strong style="color:#059669;">${fmt(data.price)}</strong></div>
              ${offersText ? `<div class="hf-point-stores-list" style="margin-top:4px; padding-top:3px; border-top:1px solid #f1f5f9;">${offersText}</div>` : ""}
            `;
            updateTooltipPos(e);
            ptTooltip.style.display = "block";
          } catch (err) {}
        });

        dot.addEventListener("mousemove", (e) => {
          updateTooltipPos(e);
        });

        dot.addEventListener("mouseleave", () => {
          ptTooltip.style.display = "none";
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

      // Dual-source fallback: if primary returned no/few history points, try the other source
      const altResult = searchRes.altResult;
      if (altResult && altResult.url && altResult.source !== best.source) {
        const hasGoodHistory = details.historyPoints && details.historyPoints.length >= 2;
        if (!hasGoodHistory) {
          log("Primary source has no history, trying fallback source:", altResult.source, altResult.url);
          try {
            const altDetailsRes = await browser.runtime.sendMessage({
              action: "getProductDetails",
              url: altResult.url,
              source: altResult.source,
            });
            const altDetails = altDetailsRes && altDetailsRes.success ? altDetailsRes.data : {};
            // Merge: take history data from alt if it has more
            if (altDetails.historyPoints && altDetails.historyPoints.length > (details.historyPoints || []).length) {
              log("Using fallback history from", altResult.source, ":", altDetails.historyPoints.length, "points");
              details.historyPoints = altDetails.historyPoints;
              details.lowestEver = altDetails.lowestEver || details.lowestEver;
              details.highestEver = altDetails.highestEver || details.highestEver;
              details.averagePrice = altDetails.averagePrice || details.averagePrice;
              // Keep historyUrl pointing to the source that actually has history
              details.historyUrl = altResult.url;
            }
            // Also merge stores if primary had none
            if ((!details.stores || details.stores.length === 0) && altDetails.stores && altDetails.stores.length > 0) {
              details.stores = altDetails.stores;
            }
            if (!details.currentLowest && altDetails.currentLowest) {
              details.currentLowest = altDetails.currentLowest;
            }
          } catch (e) {
            log("Fallback getProductDetails error:", e);
          }
        }
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
      // 1. By product links (every product in Proshop has a 6-8 digit ID in its link)
      const allLinks = document.querySelectorAll("a[href]");
      allLinks.forEach((a) => {
        const href = a.getAttribute("href") || "";
        if (/\/\d{6,8}(\/|$)/.test(href) && !href.includes("cart") && !href.includes("login") && !href.includes("kori")) {
          let p = a.parentElement;
          for (let i = 0; i < 6 && p && p !== document.body; i++) {
            if (p.tagName === "LI" || p.tagName === "ARTICLE" || (p.className && (String(p.className).includes("product") || String(p.className).includes("item")))) {
              if (!cardElements.includes(p)) cardElements.push(p);
              break;
            }
            p = p.parentElement;
          }
        }
      });
      // 2. Direct selectors
      const directCards = document.querySelectorAll(".site-product-list-item, li[class*='product'], div[class*='site-product-list-item'], [data-product-id], ul.site-product-list > li");
      directCards.forEach((c) => { if (!cardElements.includes(c)) cardElements.push(c); });
    }

    if (host.includes("prisma")) {
      const cards = document.querySelectorAll("article[class*='ProductCard'], [data-testid*='product-card'], article, li[class*='product']");
      cards.forEach((c) => { if (!cardElements.includes(c)) cardElements.push(c); });
    }

    if (host.includes("tokmanni")) {
      const cards = document.querySelectorAll(".product-item, li.product-item, [class*='product-card']");
      cards.forEach((c) => { if (!cardElements.includes(c)) cardElements.push(c); });
    }

    if (host.includes("elisa") || host.includes("dna") || host.includes("telia")) {
      const cards = document.querySelectorAll("[data-testid*='product-card'], [class*='ProductCard'], [class*='product-card'], article[class*='product']");
      cards.forEach((c) => { if (!cardElements.includes(c)) cardElements.push(c); });
    }

    const pending = cardElements
      .filter((c) => !c.querySelector(".hf-listing-badge-container"))
      .slice(0, 20);

    if (pending.length === 0) return;

    isScanningListings = true;

    for (const card of pending) {
      let title = "";
      const tEl = card.querySelector("h2, h3, h4, a.site-product-link, [class*='product-title'], [class*='title'], a[class*='name'], a[href*='/product'], a[href]");
      if (tEl) title = tEl.textContent.trim();
      if (!title || title.length < 5) continue;

      // Better price anchor detection per store so the button is placed directly below the site's own price
      let priceAnchor = null;
      if (host.includes("verkkokauppa")) {
        priceAnchor = card.querySelector("data[data-price='current']") ||
                      card.querySelector("[class*='price__root']") ||
                      card.querySelector("[class*='price-wrapper']") ||
                      card.querySelector("[class*='PriceSection']") ||
                      card.querySelector("[class*='Price']");
      } else if (host.includes("gigantti")) {
        priceAnchor = card.querySelector("[data-testid*='product-price']") ||
                      card.querySelector("[data-testid*='price']") ||
                      card.querySelector("[class*='product-price']");
      } else if (host.includes("proshop")) {
        priceAnchor = card.querySelector(".site-currency-wrapper:not([class*='bottom-ribbon'])") ||
                      card.querySelector(".site-currency-wrapper") ||
                      card.querySelector(".site-currency-attention") ||
                      card.querySelector("[class*='site-currency']");
      } else if (host.includes("prisma")) {
        priceAnchor = card.querySelector("[data-testid*='price'], [class*='ProductPrice'], [class*='Price_price']") ||
                      card.querySelector("[class*='price']");
      } else if (host.includes("tokmanni")) {
        priceAnchor = card.querySelector(".price-box, [data-price-type='finalPrice'], .price-wrapper, .price") ||
                      card.querySelector("[class*='price']");
      } else if (host.includes("elisa") || host.includes("dna") || host.includes("telia")) {
        priceAnchor = card.querySelector("[data-testid*='price'], [class*='Price'], [class*='price-container'], [class*='price']") ||
                      card.querySelector("button")?.parentElement;
      }

      if (!priceAnchor) {
        priceAnchor = card.querySelector("[class*='stm-price__root'], [class*='price__root'], [class*='stm-price'], [class*='Price'], data[data-price='current'], [data-testid*='price'], [class*='price']") ||
                      card.querySelector("button")?.parentElement ||
                      card.lastElementChild;
      }
      if (!priceAnchor) continue;

      // Find the outermost price container if nested so the button sits below all price info
      let anchor = priceAnchor;
      if (anchor.parentElement && anchor.parentElement !== card && anchor.parentElement.tagName !== "ARTICLE" && anchor.parentElement.tagName !== "LI") {
        const pClass = String(anchor.parentElement.className || "").toLowerCase();
        if (pClass.includes("price") || pClass.includes("hinta") || anchor.parentElement.tagName === "SECTION") {
          anchor = anchor.parentElement;
        }
      }

      // Exact store price detection from card
      let cardPrice = null;
      if (host.includes("verkkokauppa")) {
        const dataEl = card.querySelector("data[data-price='current']");
        if (dataEl) {
          const val = dataEl.getAttribute("value");
          if (val) cardPrice = parseFloat(val);
        }
      }
      if (!cardPrice && priceAnchor) {
        const pText = priceAnchor.textContent || "";
        const m = pText.match(/(\d[\d\s\u00a0]*[\.,]\d{2}|\d+)\s*€/);
        if (m) cardPrice = parsePrice(m[0]);
      }
      if (!cardPrice) {
        const allText = card.textContent || "";
        const pM = allText.match(/(\d[\d\s\u00a0]*[\.,]\d{2}|\d+)\s*€/);
        if (pM) cardPrice = parsePrice(pM[0]);
      }

      // Create a "Hae hinta" button placed directly below the price
      const badgeContainer = document.createElement("div");
      badgeContainer.className = "hf-listing-badge-container";
      badgeContainer.innerHTML = `
        <button class="hf-listing-fetch-btn" title="Hae vertailuhinta tähän tuotteeseen">
          💰 Hae hinta
        </button>
      `;

      anchor.insertAdjacentElement("afterend", badgeContainer);

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

              // Fallback to secondary source if primary has no history/stores
              const altResult = searchRes.altResult;
              if (altResult && altResult.url && altResult.source !== best.source) {
                const hasGoodHistory = details.historyPoints && details.historyPoints.length >= 2;
                if (!hasGoodHistory || !details.averagePrice) {
                  try {
                    const altRes = await browser.runtime.sendMessage({
                      action: "getProductDetails",
                      url: altResult.url,
                      source: altResult.source,
                    });
                    const altDetails = altRes && altRes.success ? altRes.data : {};
                    if (altDetails.historyPoints && altDetails.historyPoints.length > (details.historyPoints || []).length) {
                      details.historyPoints = altDetails.historyPoints;
                      details.lowestEver = altDetails.lowestEver || details.lowestEver;
                      details.highestEver = altDetails.highestEver || details.highestEver;
                      details.averagePrice = altDetails.averagePrice || details.averagePrice;
                      details.historyUrl = altResult.url;
                    }
                    if ((!details.stores || details.stores.length === 0) && altDetails.stores && altDetails.stores.length > 0) {
                      details.stores = altDetails.stores;
                    }
                    if (!details.currentLowest && altDetails.currentLowest) {
                      details.currentLowest = altDetails.currentLowest;
                    }
                  } catch (e) {
                    log("Listing alt details error:", e);
                  }
                }
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
                <span class="hf-listing-brand">💰 Aitohinta</span>
                <span class="hf-listing-norm">Ei osumaa</span>
                <a href="${esc(extUrls.hintafi)}" target="_blank" rel="noopener noreferrer" class="hf-listing-link-btn" title="Hae Hinta.fi:stä">Hinta.fi ↗</a>
                <a href="${esc(extUrls.hintaopas)}" target="_blank" rel="noopener noreferrer" class="hf-listing-link-btn" title="Hae Hintaopas:sta">Hintaopas ↗</a>
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
                <span class="hf-listing-brand">💰 Aitohinta</span>
                <span class="hf-listing-norm">Ei hintatietoja</span>
              </div>
            `;
            return;
          }

          const extUrls = getExternalUrls(best.name || title);

          // 1. Lowest / Elsewhere price with percentage
          let curLowHtml = "";
          if (curLow) {
            if (cardPrice && curLow < cardPrice * 0.98) {
              const diff = cardPrice - curLow;
              const pct = Math.round((diff / cardPrice) * 100);
              curLowHtml = `<span class="hf-listing-cheaper">Muualla: <strong>${fmt(curLow)}</strong> <span class="hf-listing-pct-badge">-${pct}%</span></span>`;
            } else if (cardPrice && cardPrice <= curLow * 1.02) {
              curLowHtml = `<span class="hf-listing-best-here">Täällä halvin! (<strong>${fmt(cardPrice)}</strong>)</span>`;
            } else {
              curLowHtml = `<span class="hf-listing-curlow">Halvin nyt: <strong>${fmt(curLow)}</strong></span>`;
            }
          }

          // 2. Normal price
          let normHtml = "";
          if (avg) {
            normHtml = `<span class="hf-listing-norm">Norm. ~<strong>${fmt(avg)}</strong></span>`;
          }

          // 3. Discount from normal price if store price is below normal and cheaper elsewhere wasn't shown
          let discountHtml = "";
          if (cardPrice && avg && cardPrice < avg * 0.95 && (!curLow || curLow >= cardPrice * 0.98)) {
            const diffAvg = avg - cardPrice;
            const pctAvg = Math.round((diffAvg / avg) * 100);
            discountHtml = `<span class="hf-listing-pct-badge">-${pctAvg}% norm.</span>`;
          }

          // 4. Stores list for popover
          let storesHtml = "";
          if (details.stores && details.stores.length > 0) {
            const storeRows = details.stores.slice(0, 4).map((s, i) => {
              const sUrl = s.storeUrl || best.url;
              return `
                <a href="${esc(sUrl)}" target="_blank" rel="noopener noreferrer" class="hf-listing-store-row" title="Siirry kauppaan ${esc(s.name)}">
                  <span class="hf-listing-store-name">${i === 0 ? "🏆 " : ""}${esc(s.name)} ↗</span>
                  <strong class="hf-listing-store-price">${fmtExact(s.price)}</strong>
                </a>
              `;
            }).join("");

            storesHtml = `
              <div class="hf-listing-stores">
                <div class="hf-listing-stores-title">Kaupat &amp; hinnat nyt (klikkaa kauppaan):</div>
                ${storeRows}
              </div>
            `;
          }

          badgeContainer.innerHTML = `
            <div class="hf-listing-pill" title="Klikkaa lukitaksesi tiedot tai vie hiiri päälle">
              <span class="hf-listing-brand">💰 Aitohinta:</span>
              ${curLowHtml}
              ${normHtml}
              ${discountHtml}
              <span class="hf-listing-info-icon">ℹ️ Kaupat ▾</span>
            </div>
            <div class="hf-listing-popover">
              <div class="hf-listing-popover-title">
                <div class="hf-listing-popover-name">${esc(best.name)}</div>
                <span class="hf-listing-popover-badge">${best.matchPercent}% vastaavuus</span>
              </div>
              <div class="hf-listing-popover-meta">
                ${cardPrice ? `<div>Kaupan hinta: <strong>${fmt(cardPrice)}</strong></div>` : ""}
                ${curLow ? `<div>Halvin hinta nyt: <strong style="color:#059669;">${fmt(curLow)}</strong></div>` : ""}
                ${avg ? `<div>Oikea normihinta: <strong>${fmt(avg)}</strong></div>` : ""}
                ${details.lowestEver ? `<div>Kaikkien aikojen alin: <strong>${fmt(details.lowestEver)}</strong></div>` : ""}
              </div>
              ${storesHtml}
              <div class="hf-listing-links-row">
                <a href="${esc(details.historyUrl || best.url)}" target="_blank" rel="noopener noreferrer" class="hf-listing-main-btn">
                  Avaa tuote ja kaupat vertailussa ➔
                </a>
                <div class="hf-listing-sub-links">
                  <a href="${esc(extUrls.hintafi)}" target="_blank" rel="noopener noreferrer" class="hf-listing-link-btn">Hinta.fi ↗</a>
                  <a href="${esc(extUrls.hintaopas)}" target="_blank" rel="noopener noreferrer" class="hf-listing-link-btn">Hintaopas ↗</a>
                  <a href="${esc(extUrls.vertaa)}" target="_blank" rel="noopener noreferrer" class="hf-listing-link-btn">Vertaa.fi ↗</a>
                </div>
              </div>
            </div>
          `;

          // Hover & Click controls to ensure popover NEVER closes accidentally
          const pill = badgeContainer.querySelector(".hf-listing-pill");
          const popover = badgeContainer.querySelector(".hf-listing-popover");

          let hideTimer = null;

          const showPop = () => {
            if (hideTimer) {
              clearTimeout(hideTimer);
              hideTimer = null;
            }
            badgeContainer.classList.add("hf-active");
            popover.classList.add("hf-popover-open");

            const rect = popover.getBoundingClientRect();
            if (rect.top < 15) {
              popover.classList.add("hf-popover-below");
            } else {
              popover.classList.remove("hf-popover-below");
            }
          };

          const hidePop = () => {
            if (badgeContainer.classList.contains("hf-locked")) return;
            hideTimer = setTimeout(() => {
              badgeContainer.classList.remove("hf-active");
              popover.classList.remove("hf-popover-open");
            }, 400); // 400ms grace period
          };

          badgeContainer.addEventListener("mouseenter", showPop);
          badgeContainer.addEventListener("mouseleave", hidePop);
          popover.addEventListener("mouseenter", showPop);
          popover.addEventListener("mouseleave", hidePop);

          // Click pill to lock open / toggle
          pill.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (badgeContainer.classList.contains("hf-locked")) {
              badgeContainer.classList.remove("hf-locked", "hf-active");
              popover.classList.remove("hf-popover-open");
            } else {
              showPop();
              badgeContainer.classList.add("hf-locked");
            }
          });

          // Prevent popover clicks from bubbling to the parent product card (which could navigate away)
          popover.addEventListener("click", (e) => {
            e.stopPropagation();
          });

          // Close when clicking outside
          document.addEventListener("click", (e) => {
            if (!badgeContainer.contains(e.target)) {
              badgeContainer.classList.remove("hf-locked", "hf-active");
              popover.classList.remove("hf-popover-open");
            }
          });
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
