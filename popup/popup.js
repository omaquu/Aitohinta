// popup/popup.js
"use strict";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let currentPageInfo = null;
let searchResults = [];
let selectedProduct = null;

// Initialize
document.addEventListener("DOMContentLoaded", () => {
  $("#search-btn").addEventListener("click", onSearch);
  $("#auto-detect-btn").addEventListener("click", onAutoDetect);
  $("#product-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") onSearch();
  });
});

async function onAutoDetect() {
  showLoading();

  try {
    const tabs = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tabs[0]) {
      showError("Ei aktiivista välilehteä.");
      return;
    }

    // Try to get info from content script
    try {
      const info = await browser.tabs.sendMessage(tabs[0].id, {
        action: "getProductInfo",
      });
      if (info && info.productName) {
        currentPageInfo = info;
        $("#product-input").value = info.productName;

        if (info.currentPrice) {
          showCurrentPrice(info.currentPrice, tabs[0].url);
        }

        await searchHintaFi(info.productName);
        return;
      }
    } catch (e) {
      // Content script not injected on this page
    }

    // Fallback: try to get page title
    const title = tabs[0].title || "";
    const cleanTitle = title
      .replace(
        /[-–|]\s*(gigantti|verkkokauppa|power|dustinhome|jimms|cdon|amazon).*/i,
        ""
      )
      .replace(/\s*[-–|].*$/, "")
      .trim();

    if (cleanTitle.length > 3) {
      $("#product-input").value = cleanTitle;
      await searchHintaFi(cleanTitle);
    } else {
      showError(
        "Tuotetta ei voitu tunnistaa sivulta. Kirjoita tuotteen nimi manuaalisesti."
      );
    }
  } catch (err) {
    showError("Virhe: " + err.message);
  }
}

async function onSearch() {
  const query = $("#product-input").value.trim();
  if (!query) {
    showError("Kirjoita tuotteen nimi!");
    return;
  }

  showLoading();
  await searchHintaFi(query);
}

async function searchHintaFi(productName) {
  try {
    const response = await browser.runtime.sendMessage({
      action: "searchHintaFi",
      productName,
    });

    if (!response || !response.success) {
      showError(
        "Haku epäonnistui: " +
          (response ? response.error : "Tuntematon virhe") +
          ". Tarkista nettiyhteys."
      );
      return;
    }

    searchResults = response.results;

    if (searchResults.length === 0) {
      showError(
        'Tuotetta ei löytynyt hinta.fi:stä. Kokeile eri hakusanaa tai avaa <a href="https://hinta.fi" style="color: #3498db;">hinta.fi</a> suoraan.'
      );
      return;
    }

    hideLoading();
    showSearchResults(searchResults, response.searchUrl);

    // Auto-select best match
    if (searchResults[0].matchPercent >= 40) {
      await selectProduct(searchResults[0]);
    }
  } catch (err) {
    showError("Virhe hakiessa: " + err.message);
  }
}

function showSearchResults(results, searchUrl) {
  const container = $("#search-results");
  container.innerHTML = `<h3>Hakutulokset (${results.length})</h3>`;

  results.forEach((result, index) => {
    const item = document.createElement("div");
    item.className = "result-item";
    item.dataset.index = index;

    const matchClass =
      result.matchPercent >= 70
        ? "high"
        : result.matchPercent >= 40
          ? "medium"
          : "low";

    item.innerHTML = `
      <span class="result-name" title="${escapeHtml(result.name)}">${escapeHtml(result.name)}</span>
      <span class="result-match ${matchClass}">${result.matchPercent}%</span>
      ${result.currentLowestPrice ? `<span class="result-price">${formatPrice(result.currentLowestPrice)}</span>` : ""}
    `;

    item.addEventListener("click", () => selectProduct(result));
    container.appendChild(item);
  });

  $("#results-section").classList.remove("hidden");
}

async function selectProduct(product) {
  selectedProduct = product;

  // Highlight selected
  $$(".result-item").forEach((el) => el.classList.remove("selected"));
  const index = searchResults.indexOf(product);
  const items = $$(".result-item");
  if (items[index]) items[index].classList.add("selected");

  // Show match percentage
  const matchBadge = $("#match-percent");
  matchBadge.textContent = product.matchPercent + "%";
  matchBadge.className =
    "match-badge " +
    (product.matchPercent >= 70
      ? "high"
      : product.matchPercent >= 40
        ? "medium"
        : "low");

  // Set link to full history page
  const histUrl = product.url.split("?")[0].replace(/\/+$/, "") + "/historia?l=1";
  $("#open-hintafi").href = histUrl;
  $("#open-hintafi").onclick = (e) => {
    e.preventDefault();
    browser.tabs.create({ url: histUrl });
  };

  // Show details section
  $("#product-details").classList.remove("hidden");

  // Reset price displays
  $("#lowest-price").textContent = "Ladataan...";
  $("#average-price").textContent = "Ladataan...";
  $("#current-lowest-price").textContent = "Ladataan...";

  // Hide alerts
  $("#fake-sale-alert").classList.add("hidden");
  $("#real-deal-alert").classList.add("hidden");
  $("#stores-section").classList.add("hidden");

  // Fetch product details
  try {
    const response = await browser.runtime.sendMessage({
      action: "getProductDetails",
      url: product.url,
    });

    if (response && response.success && response.data) {
      displayProductDetails(response.data, product);
    } else {
      $("#lowest-price").textContent = "-";
      $("#average-price").textContent = "-";
      $("#current-lowest-price").textContent = product.currentLowestPrice
        ? formatPrice(product.currentLowestPrice)
        : "-";
    }
  } catch (err) {
    console.error("Error fetching details:", err);
    $("#lowest-price").textContent = "Virhe";
    $("#average-price").textContent = "Virhe";
  }
}

function displayProductDetails(data, product) {
  // Prices
  const lowestEver = data.lowestEver;
  const avgPrice = data.averagePrice;
  const currentLowest = data.currentLowest || product.currentLowestPrice;

  $("#lowest-price").textContent = lowestEver
    ? formatPrice(lowestEver)
    : "-";
  $("#average-price").textContent = avgPrice
    ? formatPrice(avgPrice)
    : "-";
  $("#current-lowest-price").textContent = currentLowest
    ? formatPrice(currentLowest)
    : "-";

  // Check for fake sales
  if (currentPageInfo && currentPageInfo.currentPrice && currentLowest) {
    const shopPrice = currentPageInfo.currentPrice;
    const priceDiff = shopPrice - currentLowest;
    const percentAboveLowest = currentLowest > 0
      ? ((priceDiff / currentLowest) * 100).toFixed(0)
      : 0;

    if (avgPrice && shopPrice >= avgPrice * 0.95) {
      // Price is at or above average - likely fake sale
      const fakeSaleAlert = $("#fake-sale-alert");
      fakeSaleAlert.classList.remove("hidden");
      const percentAboveAvg = avgPrice > 0
        ? (((shopPrice - avgPrice) / avgPrice) * 100).toFixed(0)
        : 0;

      if (shopPrice > avgPrice) {
        $("#fake-sale-text").textContent =
          `⚠️ VAROITUS: Kaupan hinta (${formatPrice(shopPrice)}) on ${percentAboveAvg}% KESKIHINTAA KORKEAMPI! ` +
          `Tämä EI ole hyvä tarjous. Halvin hinta nyt on ${formatPrice(currentLowest)}.`;
      } else {
        $("#fake-sale-text").textContent =
          `Kaupan hinta (${formatPrice(shopPrice)}) on lähellä keskihintaa (${formatPrice(avgPrice)}). ` +
          `Todennäköisesti ei oikeasti alennettu. Halvin hinta on ${formatPrice(currentLowest)}.`;
      }
    } else if (lowestEver && shopPrice <= lowestEver * 1.05) {
      // Price is near all-time low
      const realDeal = $("#real-deal-alert");
      realDeal.classList.remove("hidden");
      $("#real-deal-text").textContent =
        `Hinta on lähellä kaikkien aikojen alinta (${formatPrice(lowestEver)})! Tämä vaikuttaa hyvältä tarjoukselta.`;
    } else if (currentLowest && shopPrice > currentLowest * 1.1) {
      // Price is more than 10% above current lowest
      const fakeSaleAlert = $("#fake-sale-alert");
      fakeSaleAlert.classList.remove("hidden");
      $("#fake-sale-text").textContent =
        `Kaupan hinta (${formatPrice(shopPrice)}) on ${percentAboveLowest}% halvinta nykyhintaa korkeampi. ` +
        `Halvempi vaihtoehto löytyy muualta: ${formatPrice(currentLowest)}.`;
    }
  }

  // Stores
  if (data.stores && data.stores.length > 0) {
    const storesSection = $("#stores-section");
    storesSection.classList.remove("hidden");
    const storesList = $("#stores-list");
    storesList.innerHTML = "";

    // Sort by price
    const sortedStores = [...data.stores].sort((a, b) => a.price - b.price);
    const cheapestPrice = sortedStores[0].price;

    sortedStores.forEach((store) => {
      const item = document.createElement("div");
      item.className = "store-item";
      const isCheapest = store.price === cheapestPrice;
      item.innerHTML = `
        <span class="store-name">${escapeHtml(store.name)}</span>
        <span class="store-price${isCheapest ? " cheapest" : ""}">${formatPrice(store.price)}${isCheapest ? " 🏆" : ""}</span>
      `;
      storesList.appendChild(item);
    });
  }
}

function showCurrentPrice(price, url) {
  const box = $("#current-price-box");
  box.classList.remove("hidden");
  $("#current-price-value").textContent = formatPrice(price);

  try {
    const hostname = new URL(url).hostname.replace("www.", "");
    $("#current-price-source").textContent = hostname;
  } catch (e) {
    /* ignore */
  }
}

function showLoading() {
  $("#loading").classList.remove("hidden");
  $("#error-section").classList.add("hidden");
  $("#results-section").classList.add("hidden");
}

function hideLoading() {
  $("#loading").classList.add("hidden");
}

function showError(message) {
  hideLoading();
  $("#error-section").classList.remove("hidden");
  $("#error-message").innerHTML = message;
}

function formatPrice(price) {
  if (price === null || price === undefined) return "-";
  return (
    price.toLocaleString("fi-FI", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + " €"
  );
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
