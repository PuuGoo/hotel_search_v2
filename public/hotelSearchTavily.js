import axios from "https://cdn.jsdelivr.net/npm/axios@1.6.8/dist/esm/axios.min.js";
import { Toasts } from "/ui.js";

// Global fuzzy config so helper functions outside DOMContentLoaded can access
let fuzzyEnabled = false; // persisted via localStorage tavily_fuzzy_cfg
let fuzzyThreshold = 0.78; // 0 - 1
let fuzzyWorker = null; // worker instance
let pendingFuzzyQueue = [];
let lastFilterQueryRaw = ""; // active search query persisted across rerenders
const resultDetailState = {
  currentOrder: null,
  orders: [],
  elements: null,
  ensureVisible: null,
};

function getResultDetailElements() {
  if (resultDetailState.elements) return resultDetailState.elements;
  const modal = document.getElementById("resultDetailModal");
  if (!modal) return null;
  resultDetailState.elements = {
    modal,
    closeBtn: document.getElementById("resultDetailClose"),
    closeFooterBtn: document.getElementById("resultDetailCloseFooter"),
    prevBtn: document.getElementById("resultDetailPrev"),
    nextBtn: document.getElementById("resultDetailNext"),
    searchForm: document.getElementById("resultDetailSearchForm"),
    searchInput: document.getElementById("resultDetailSearchInput"),
    message: document.getElementById("resultDetailMessage"),
    order: document.getElementById("resultDetailOrder"),
    no: document.getElementById("resultDetailNo"),
    percentage: document.getElementById("resultDetailPercentage"),
    fuzzy: document.getElementById("resultDetailFuzzy"),
    status: document.getElementById("resultDetailStatus"),
    totalLinks: document.getElementById("resultDetailTotalLinks"),
    hotelName: document.getElementById("resultDetailHotelName"),
    hotelAddress: document.getElementById("resultDetailHotelAddress"),
    links: document.getElementById("resultDetailLinks"),
    openAllBtn: document.getElementById("resultDetailOpenAll"),
  };
  return resultDetailState.elements;
}

function getSortedOrdersAsc() {
  const results = Array.isArray(window.currentResults)
    ? window.currentResults
    : [];
  const orders = results
    .map((r) => Number(r?.order))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  return Array.from(new Set(orders));
}

function getResultByOrder(order) {
  const results = Array.isArray(window.currentResults)
    ? window.currentResults
    : [];
  const target = results.find((r) => Number(r?.order) === Number(order));
  return target || null;
}

function openUrlsWithDelay(urls, delay = 180) {
  const list = Array.isArray(urls) ? urls : [];
  const unique = Array.from(
    new Set(
      list
        .map((u) => (typeof u === "string" ? u.trim() : String(u || "").trim()))
        .filter(Boolean)
    )
  );
  unique.forEach((url, index) => {
    try {
      setTimeout(() => window.open(url, "_blank"), index * delay);
    } catch (e) {
      console.error("Open link failed", url, e);
    }
  });
}

function closeResultDetailModal() {
  const els = getResultDetailElements();
  if (!els || !els.modal) return;
  els.modal.classList.add("hidden");
  resultDetailState.currentOrder = null;
}

function renderResultDetail(result) {
  const els = getResultDetailElements();
  if (!els) return;
  const fmt = (val) => (val == null || val === "" ? "-" : String(val));
  els.order.textContent = fmt(result?.order);
  els.no.textContent = fmt(result?.hotelNo);
  if (result && result.percentage != null && result.percentage !== "") {
    const pctVal = Number(result.percentage);
    els.percentage.textContent = Number.isNaN(pctVal)
      ? String(result.percentage)
      : `${Math.round(pctVal)}%`;
  } else {
    els.percentage.textContent = "-";
  }
  els.fuzzy.textContent =
    result && result.fuzzy != null ? Number(result.fuzzy).toFixed(3) : "-";
  els.status.textContent = fmt(result?.status);
  const totalLinks = Array.isArray(result?.matchedLinks)
    ? result.matchedLinks.length
    : 0;
  els.totalLinks.textContent = String(totalLinks);
  els.hotelName.textContent = fmt(result?.hotelName);
  els.hotelAddress.textContent = fmt(result?.hotelAddress);
  const linksContainer = els.links;
  if (linksContainer) {
    linksContainer.innerHTML = "";
    if (totalLinks) {
      const frag = document.createDocumentFragment();
      result.matchedLinks.forEach((link) => {
        const info =
          typeof link === "string" ? { url: link, percentage: 0 } : link || {};
        const row = document.createElement("div");
        row.className = "flex gap-xs wrap";
        const url = info.url || "";
        const safeUrl = escapeHtml(url);
        const hasUrl = !!url;
        const linkLabel = escapeHtml(shortenUrl(url || ""));
        row.innerHTML = `
          ${
            hasUrl
              ? `<a href="${safeUrl}" target="_blank" class="link-chip" style="flex:1" title="${safeUrl}">${linkLabel}</a>`
              : `<span class="text-tertiary" style="flex:1">${
                  linkLabel || "Không có URL"
                }</span>`
          }
          <span class="text-tertiary" style="font-size:0.65rem">${Math.round(
            info.percentage || 0
          )}%</span>`;
        frag.appendChild(row);
      });
      linksContainer.appendChild(frag);
    } else {
      const empty = document.createElement("div");
      empty.className = "text-tertiary";
      empty.style.fontSize = "0.65rem";
      empty.textContent = "Không có link phù hợp";
      linksContainer.appendChild(empty);
    }
  }
  if (els.openAllBtn) {
    const urls = (result?.matchedLinks || []).map((l) =>
      typeof l === "string" ? l : l?.url || ""
    );
    const unique = Array.from(
      new Set(urls.map((u) => String(u || "").trim()).filter(Boolean))
    );
    els.openAllBtn.disabled = unique.length === 0;
    els.openAllBtn.dataset.urls = JSON.stringify(unique);
  }
}

function navigateResultDetail(delta) {
  if (!delta) return;
  const orders = getSortedOrdersAsc();
  if (!orders.length) return;
  resultDetailState.orders = orders;
  const current = Number(resultDetailState.currentOrder);
  const idx = orders.indexOf(current);
  const targetIdx =
    idx === -1 ? (delta > 0 ? 0 : orders.length - 1) : idx + delta;
  if (targetIdx < 0 || targetIdx >= orders.length) return;
  openResultDetailModal(orders[targetIdx]);
}

function handleResultDetailSearch(query) {
  const els = getResultDetailElements();
  if (!els) return;
  const trimmed = (query || "").trim();
  if (!trimmed) {
    if (els.message) {
      els.message.textContent = "Nhập order, No, tên hoặc địa chỉ để tìm.";
    }
    return;
  }
  const results = Array.isArray(window.currentResults)
    ? window.currentResults
    : [];
  if (!results.length) {
    if (els.message) {
      els.message.textContent = "Chưa có dữ liệu kết quả.";
    }
    return;
  }
  const lowered = trimmed.toLowerCase();
  const numeric = Number(trimmed);
  let targetOrder = null;
  if (Number.isFinite(numeric)) {
    const byOrder = results.find((r) => Number(r?.order) === numeric);
    if (byOrder) targetOrder = Number(byOrder.order);
  }
  if (targetOrder == null) {
    const byNo = results.find(
      (r) =>
        String(r?.hotelNo || "")
          .trim()
          .toLowerCase() === lowered
    );
    if (byNo) targetOrder = Number(byNo.order);
  }
  if (targetOrder == null) {
    const byName = results.find((r) =>
      String(r?.hotelName || "")
        .toLowerCase()
        .includes(lowered)
    );
    if (byName) targetOrder = Number(byName.order);
  }
  if (targetOrder == null) {
    const byAddress = results.find((r) =>
      String(r?.hotelAddress || "")
        .toLowerCase()
        .includes(lowered)
    );
    if (byAddress) targetOrder = Number(byAddress.order);
  }
  if (targetOrder == null || !Number.isFinite(targetOrder)) {
    if (els.message) {
      els.message.textContent = "Không tìm thấy dòng phù hợp.";
    }
    return;
  }
  if (els.message) els.message.textContent = "";
  openResultDetailModal(targetOrder, { scroll: true });
  if (els.searchInput) {
    setTimeout(() => {
      els.searchInput.focus();
      els.searchInput.select();
    }, 30);
  }
}

function openResultDetailModal(order, opts = {}) {
  const els = getResultDetailElements();
  if (!els || !els.modal) return;
  const targetOrder = Number(order);
  if (!Number.isFinite(targetOrder)) return;
  const data = getResultByOrder(targetOrder);
  if (!data) {
    if (els.message) {
      els.message.textContent = `Không tìm thấy dữ liệu cho order ${targetOrder}.`;
    }
    if (els.modal) els.modal.classList.remove("hidden");
    return;
  }
  resultDetailState.currentOrder = targetOrder;
  resultDetailState.orders = getSortedOrdersAsc();
  if (typeof resultDetailState.ensureVisible === "function") {
    resultDetailState.ensureVisible(targetOrder, {
      scroll: opts.scroll !== false,
    });
  }
  if (els.message) els.message.textContent = "";
  renderResultDetail(data);
  const idx = resultDetailState.orders.indexOf(targetOrder);
  if (els.prevBtn) {
    els.prevBtn.disabled = idx <= 0;
  }
  if (els.nextBtn) {
    els.nextBtn.disabled =
      idx === -1 || idx >= resultDetailState.orders.length - 1;
  }
  els.modal.classList.remove("hidden");
  if (opts.focusSearch && els.searchInput) {
    setTimeout(() => {
      els.searchInput.focus();
      els.searchInput.select();
    }, 50);
  }
}

// Đảm bảo rằng script chỉ chạy khi DOM đã tải xong
document.addEventListener("DOMContentLoaded", function () {
  // Fuzzy worker + config initialization (use existing globals)
  try {
    fuzzyWorker = new Worker("/fuzzyWorker.js");
    fuzzyWorker.addEventListener("message", (e) => {
      const msg = e.data || {};
      if (msg.type === "scored") {
        const pr = pendingFuzzyQueue.shift();
        if (!pr) return;
        const scores = msg.scores || [];
        let max = -1;
        let best = null;
        scores.forEach((s) => {
          if (s.score > max) {
            max = s.score;
            best = s;
          }
        });
        if (pr.resultObj) {
          pr.resultObj.fuzzy = max >= 0 ? max : null;
          pr.resultObj.fuzzyBreakdown = best;
          // Persist updated fuzzy info into session storage (previously we saved before async result arrived)
          try {
            const sess =
              JSON.parse(localStorage.getItem("tavily_session") || "null") ||
              {};
            if (Array.isArray(sess.results)) {
              // Find matching result by unique order (fallback by reference) and update stored copy
              const idx = sess.results.findIndex(
                (r) => r && pr.resultObj && r.order === pr.resultObj.order
              );
              if (idx >= 0) {
                sess.results[idx].fuzzy = pr.resultObj.fuzzy;
                sess.results[idx].fuzzyBreakdown = pr.resultObj.fuzzyBreakdown;
              }
              localStorage.setItem("tavily_session", JSON.stringify(sess));
            }
          } catch (persistErr) {
            // swallow
          }
        }
        // Console logging for diagnostic visibility per row
        try {
          if (best) {
            const candidate = pr.candidates && pr.candidates[best.index];
            const order = pr.resultObj ? pr.resultObj.order : undefined;
            const hotelName = pr.resultObj ? pr.resultObj.hotelName : undefined;
            console.log("[FUZZY]", {
              order,
              hotelName,
              matchedTitle: candidate ? candidate.title : undefined,
              url: candidate ? candidate.url : undefined,
              score: Number(best.score.toFixed(3)),
              percent: Math.round(best.score * 100),
              nameSim: Number((best.nameSim || 0).toFixed(3)),
              lev: Number((best.lev || 0).toFixed(3)),
              jw: Number((best.jw || 0).toFixed(3)),
              hostPathScore: Number((best.hostPathScore || 0).toFixed(3)),
              bonus: Number((best.bonus || 0).toFixed(3)),
              penalty: Number((best.penalty || 0).toFixed(3)),
              flags: best.flags || [],
            });
          } else if (pr && pr.resultObj) {
            console.log(
              "[FUZZY] No candidates",
              pr.resultObj.order,
              pr.resultObj.hotelName
            );
          }
        } catch (logErr) {
          // swallow logging errors
        }
        if (pr.rowRef) {
          const cell = pr.rowRef.querySelector('[data-col="fuzzy"]');
          if (cell) {
            if (max < 0) {
              cell.textContent = "-";
            } else {
              const flagMap = {
                TITLE_PREFIX_MATCH: "Tiêu đề bắt đầu bằng tên khách sạn",
                TOKEN_SEQUENCE_MATCH: "Đủ token theo đúng thứ tự",
                TOKEN_PERMUTATION_MATCH:
                  "Đủ hết token (bỏ từ chung) – thứ tự bất kỳ",
                AGGREGATOR: "Trang tổng hợp (aggregator)",
                OFFICIAL: "Có dấu hiệu trang chính thức",
                AGG_BONUS: "Aggregator path phù hợp (bonus)",
                GEO_MISMATCH: "Thiếu/khác token địa lý (phạt)",
              };
              const flagsDesc = (best.flags || [])
                .map((f) => flagMap[f] || f)
                .join("; ");
              const tip = best
                ? `Tên:${(best.nameSim || 0).toFixed(3)} | HostPath:${(
                    best.hostPathScore || 0
                  ).toFixed(3)} | Bonus:${(best.bonus || 0).toFixed(
                    2
                  )} | Penalty:${(best.penalty || 0).toFixed(2)}${
                    flagsDesc ? "\n" + flagsDesc : ""
                  }`
                : "";
              cell.innerHTML = `<span class=\"badge\" title=\"${tip}\" style=\"background:${
                max >= fuzzyThreshold
                  ? "rgba(46,204,113,0.18)"
                  : "rgba(255,255,255,0.08)"
              };color:${
                max >= fuzzyThreshold ? "#27ae60" : "var(--text-tertiary)"
              }\">${max.toFixed(3)}</span>`;
            }
          }
        }
      }
    });
  } catch (e) {
    console.warn("Fuzzy worker init failed", e);
  }
  // keep runCount but allow resume sessions
  // localStorage.removeItem("runCount");
  let MAX_RUNS = 0;
  let isPaused = false;
  let isProcessingRow = false;
  let shouldStop = false;
  let stoppedPermanently =
    localStorage.getItem("tavily_stopped_permanently") === "1";
  let runCount = parseInt(localStorage.getItem("runCount") || "0");
  // ===== Snapshot archive helpers =====
  function loadArchivedSnapshots() {
    try {
      return JSON.parse(localStorage.getItem("tavily_snapshots") || "[]") || [];
    } catch (e) {
      return [];
    }
  }
  function saveArchivedSnapshots(arr) {
    try {
      localStorage.setItem("tavily_snapshots", JSON.stringify(arr));
    } catch (e) {}
  }
  function addSnapshot(label, data) {
    const arr = loadArchivedSnapshots();
    arr.push({
      id: Date.now() + "_" + Math.random().toString(36).slice(2, 8),
      label,
      ts: Date.now(),
      runCount: data.runCount || 0,
      maxRuns: data.maxRuns || 0,
      results: (data.results || []).slice(0, 20000),
      allRows: data.allRows ? data.allRows.slice(0, 50000) : null,
    });
    saveArchivedSnapshots(arr);
    // reveal archive button if exists
    try {
      const b = document.getElementById("snapshotArchiveButton");
      if (b) b.classList.remove("hidden");
    } catch (e) {}
    return arr[arr.length - 1];
  }
  function formatDate(ts) {
    const d = new Date(ts);
    return d.toLocaleString();
  }
  // Pagination settings
  const PAGE_SIZES = [50, 100, 200, 500, 1000, 2000];
  const IMPORT_SNAPSHOT_LABEL = "Import CSV";
  let pageSize = parseInt(localStorage.getItem("tavily_pageSize") || "2000");
  if (!PAGE_SIZES.includes(pageSize)) pageSize = 2000;
  let currentPage = 1; // 1-based
  // Sort state – declared early so resume logic can access without TDZ issues
  let orderSortAsc = false;
  let noSortAsc = true;
  let pctSortAsc = true;
  let statusSortAsc = true;
  let nameSortAsc = true;
  let linksSortAsc = true;
  let currentSort = "order";
  const counterEl = document.getElementById("counter");
  const importButtonEl = document.getElementById("importCSVButton");
  const importInputEl = document.getElementById("importCSVInput");
  const resultsSection = document.getElementById("resultsSection");
  const detailEls = getResultDetailElements();
  if (detailEls) {
    if (detailEls.closeBtn)
      detailEls.closeBtn.addEventListener("click", () =>
        closeResultDetailModal()
      );
    if (detailEls.closeFooterBtn)
      detailEls.closeFooterBtn.addEventListener("click", () =>
        closeResultDetailModal()
      );
    if (detailEls.modal)
      detailEls.modal.addEventListener("click", (evt) => {
        if (evt.target === detailEls.modal) closeResultDetailModal();
      });
    if (detailEls.prevBtn)
      detailEls.prevBtn.addEventListener("click", () =>
        navigateResultDetail(-1)
      );
    if (detailEls.nextBtn)
      detailEls.nextBtn.addEventListener("click", () =>
        navigateResultDetail(1)
      );
    if (detailEls.openAllBtn)
      detailEls.openAllBtn.addEventListener("click", () => {
        let urls = [];
        try {
          urls = JSON.parse(detailEls.openAllBtn.dataset.urls || "[]");
        } catch (e) {
          urls = [];
        }
        openUrlsWithDelay(urls);
      });
    if (detailEls.searchForm)
      detailEls.searchForm.addEventListener("submit", (evt) => {
        evt.preventDefault();
        handleResultDetailSearch(detailEls.searchInput?.value || "");
      });
  }
  // === Visibility helpers (work with Tailwind-like .hidden utility) ===
  function show(el, display) {
    if (!el) return;
    el.classList.remove("hidden");
    if (display) el.style.display = display;
    else el.style.removeProperty("display");
  }
  function hide(el) {
    if (!el) return;
    if (!el.classList.contains("hidden")) el.classList.add("hidden");
  }
  function showResultsSection() {
    show(resultsSection);
  }
  function hideResultsSection() {
    hide(resultsSection);
  }
  // Helper: (Re)queue fuzzy scoring for rows missing fuzzy score (used after reload / resume)
  function recomputeMissingFuzzy() {
    if (!fuzzyEnabled || !fuzzyWorker) return;
    const results = window.currentResults || [];
    results.forEach((r) => {
      if (
        r &&
        r.fuzzy == null &&
        Array.isArray(r.matchedLinks) &&
        r.matchedLinks.length
      ) {
        const candidates = r.matchedLinks.map((l) => ({
          title: l.title || l.url,
          url: l.url,
        }));
        pendingFuzzyQueue.push({
          rowRef: null,
          resultObj: r,
          expected: candidates.length,
          candidates,
        });
        try {
          fuzzyWorker.postMessage({
            type: "score",
            query: r.hotelName || "",
            candidates,
            opts: { titleOnly: true },
          });
        } catch (e) {}
      }
    });
  }

  function enableClearButton(snapshotLabel = "Clear") {
    const clearBtnEl = document.getElementById("clearResultsButton");
    const downloadBtnEl = document.getElementById("downloadCSVButton");
    if (!clearBtnEl) return;
    show(clearBtnEl, "inline-flex");
    clearBtnEl.onclick = (ev) => {
      if (ev) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
      }
      const modal = document.getElementById("confirmModal");
      const input = document.getElementById("confirmInput");
      const ok = document.getElementById("confirmOk");
      const cancel = document.getElementById("confirmCancel");
      if (!modal || !input || !ok || !cancel) return;
      input.value = "";
      show(modal, "flex");
      input.focus();
      const cleanup = () => {
        hide(modal);
        ok.onclick = null;
        cancel.onclick = null;
      };
      cancel.onclick = () => {
        cleanup();
      };
      ok.onclick = () => {
        if (input.value === "Đồng Ý Xóa") {
          window.__lastClearedSnapshot = {
            results: (window.currentResults || []).slice(),
            runCountSnapshot: runCount,
            maxRunsSnapshot: MAX_RUNS,
          };
          let allRowsForSnap = null;
          try {
            const sess = JSON.parse(
              localStorage.getItem("tavily_session") || "null"
            );
            if (sess && Array.isArray(sess.allRows))
              allRowsForSnap = sess.allRows;
          } catch (e) {}
          addSnapshot(snapshotLabel, {
            results: window.__lastClearedSnapshot.results,
            runCount: runCount,
            maxRuns: MAX_RUNS,
            allRows: allRowsForSnap,
          });
          clearResultsTable();
          window.currentResults = [];
          hideResultsSection();
          hide(clearBtnEl);
          hide(downloadBtnEl);
          try {
            localStorage.removeItem("tavily_session");
            localStorage.removeItem("runCount");
            runCount = 0;
            updateCounter(counterEl, 0, 0);
            const resumeBtn = document.getElementById(
              "resumeSessionButton"
            );
            hide(resumeBtn);
          } catch (e) {}
          cleanup();
          if (Toasts) {
            Toasts.show("Đã xóa kết quả", {
              type: "success",
              title: "Xóa",
              actions: [
                {
                  label: "Hoàn tác",
                  onClick: () => {
                    const snap = window.__lastClearedSnapshot;
                    if (!snap) return;
                    window.currentResults = snap.results.slice();
                    runCount = snap.runCountSnapshot;
                    MAX_RUNS = snap.maxRunsSnapshot;
                    updateCounter(counterEl, runCount, MAX_RUNS);
                    showResultsSection();
                    clearResultsTable();
                    sortTable(currentSort, false);
                    setupDownloadButton(window.currentResults || []);
                    enableClearButton(snapshotLabel);
                    const undoInline = document.getElementById(
                      "undoInlineContainer"
                    );
                    if (undoInline) {
                      undoInline.innerHTML = "";
                      hide(undoInline);
                    }
                  },
                },
              ],
              timeout: 6000,
            });
          }
          try {
            const undoInline = document.getElementById(
              "undoInlineContainer"
            );
            if (undoInline) {
              undoInline.innerHTML = "";
              const btn = document.createElement("button");
              btn.className = "btn btn-outline btn-small";
              btn.innerHTML =
                '<i class="fa-solid fa-rotate-left"></i><span>Hoàn tác xóa</span>';
              btn.addEventListener("click", () => {
                const snap = window.__lastClearedSnapshot;
                if (!snap) return;
                window.currentResults = snap.results.slice();
                runCount = snap.runCountSnapshot;
                MAX_RUNS = snap.maxRunsSnapshot;
                updateCounter(counterEl, runCount, MAX_RUNS);
                showResultsSection();
                clearResultsTable();
                sortTable(currentSort, false);
                setupDownloadButton(window.currentResults || []);
                enableClearButton(snapshotLabel);
                undoInline.innerHTML = "";
                hide(undoInline);
              });
              undoInline.appendChild(btn);
              show(undoInline, "block");
              setTimeout(() => {
                if (undoInline && undoInline.firstChild) {
                  undoInline.innerHTML = "";
                  hide(undoInline);
                }
              }, 15000);
            }
          } catch (e) {}
        } else {
          if (Toasts)
            Toasts.show("Bạn phải nhập đúng: Đồng Ý Xóa", {
              type: "error",
              title: "Chưa xác nhận",
            });
          input.focus();
        }
      };
    };
  }

  function parseNumeric(value) {
    if (value == null || value === "") return NaN;
    const cleaned = String(value).trim().replace(/[^0-9.-]/g, "");
    if (!cleaned) return NaN;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  function buildCsvHeaderInfo(headerRow = []) {
    const raw = Array.isArray(headerRow) ? headerRow : [];
    const normalized = raw.map((cell) => String(cell ?? "").trim());
    const lower = normalized.map((cell) => cell.toLowerCase());
    const info = {
      raw: normalized,
      lower,
      orderIdx: lower.findIndex((c) => c === "order" || c === "stt" || c === "#"),
      noIdx: lower.findIndex((c) => c === "no" || c.includes("child no") || c.includes("số thứ tự")),
      nameIdx: lower.findIndex(
        (c) =>
          c === "name" ||
          c.includes("hotel name") ||
          (c.includes("child") && c.includes("name"))
      ),
      addressIdx: lower.findIndex((c) => c.includes("address") || c.includes("địa chỉ")),
      percentageIdx: lower.findIndex((c) => c.includes("percentage") || c.includes("%")),
      statusIdx: lower.findIndex((c) => c === "status" || c.includes("trạng thái")),
      fuzzyIdx: lower.findIndex((c) => c === "fuzzy" || c.includes("fuzzy score")),
      linkIdxs: [],
    };
    lower.forEach((cell, idx) => {
      if (!cell) return;
      if (cell.startsWith("matched link") || (cell.includes("link") && !cell.includes("count"))) {
        info.linkIdxs.push(idx);
      }
    });
    if (!info.linkIdxs.length) {
      for (let i = 6; i < normalized.length; i++) info.linkIdxs.push(i);
    }
    info.linkIdxs = Array.from(new Set(info.linkIdxs)).filter((i) => i >= 0).sort((a, b) => a - b);
    return info;
  }

  function rowsToImportedResults(rows, headerInfo) {
    const results = [];
    const seenOrders = new Set();
    let nextOrder = 1;
    const allocateOrder = (rawOrder) => {
      const candidate = Number.isFinite(rawOrder) ? Math.round(rawOrder) : NaN;
      if (Number.isFinite(candidate) && candidate > 0 && !seenOrders.has(candidate)) {
        seenOrders.add(candidate);
        if (candidate >= nextOrder) nextOrder = candidate + 1;
        return candidate;
      }
      while (seenOrders.has(nextOrder)) nextOrder++;
      const assigned = nextOrder;
      seenOrders.add(assigned);
      nextOrder++;
      return assigned;
    };
    rows.forEach((row, rowIndex) => {
      const cells = Array.isArray(row) ? row : [];
      const nameCell =
        headerInfo.nameIdx !== -1 ? cells[headerInfo.nameIdx] : cells[4];
      const addressCell =
        headerInfo.addressIdx !== -1 ? cells[headerInfo.addressIdx] : cells[5];
      const name = String(nameCell ?? "").trim();
      const address = String(addressCell ?? "").trim();
      if (!name && !address) return;
      const orderRaw =
        headerInfo.orderIdx !== -1 ? parseNumeric(cells[headerInfo.orderIdx]) : NaN;
      const order = allocateOrder(orderRaw);
      const hotelNoCell =
        headerInfo.noIdx !== -1 ? cells[headerInfo.noIdx] : rowIndex + 1;
      const percentageValue =
        headerInfo.percentageIdx !== -1
          ? parseNumeric(cells[headerInfo.percentageIdx])
          : NaN;
      const fuzzyValue =
        headerInfo.fuzzyIdx !== -1 ? parseNumeric(cells[headerInfo.fuzzyIdx]) : NaN;
      const statusRaw =
        headerInfo.statusIdx !== -1 ? String(cells[headerInfo.statusIdx] ?? "").trim() : "";
      const matchedLinks = [];
      headerInfo.linkIdxs.forEach((idx) => {
        if (idx >= cells.length) return;
        const value = cells[idx];
        if (value == null) return;
        const url = String(value).trim();
        if (!url) return;
        matchedLinks.push({
          url,
          percentage: Number.isFinite(percentageValue) ? percentageValue : 0,
          title: "",
        });
      });
      const percentage = Number.isFinite(percentageValue)
        ? Math.round(percentageValue)
        : matchedLinks.length
        ? 100
        : 0;
      results.push({
        order,
        hotelNo: String(hotelNoCell ?? "").trim() || String(rowIndex + 1),
        hotelName: name,
        hotelAddress: address,
        matchedLinks,
        percentage,
        status: statusRaw || (matchedLinks.length ? "Matched" : "No match"),
        fuzzy: Number.isFinite(fuzzyValue) ? fuzzyValue : null,
      });
    });
    results.sort((a, b) => a.order - b.order);
    return results;
  }

  function applyImportedResultsToUi(results, snapshotLabel = IMPORT_SNAPSHOT_LABEL) {
    if (!Array.isArray(results) || !results.length) return [];
    const prepared = results.map((row) => ({
      ...row,
      order: Number.isFinite(row.order) ? Math.round(row.order) : row.order,
      hotelNo: String(row.hotelNo ?? "").trim(),
      hotelName: String(row.hotelName ?? "").trim(),
      hotelAddress: String(row.hotelAddress ?? "").trim(),
      matchedLinks: (row.matchedLinks || []).map((link) => ({
        url: String(link?.url ?? "").trim(),
        percentage: Number.isFinite(link?.percentage) ? Number(link.percentage) : 0,
        title: String(link?.title ?? "").trim(),
      })),
      percentage: Number.isFinite(row.percentage) ? Math.round(row.percentage) : 0,
      status: String(row.status ?? "").trim() || "No match",
      fuzzy:
        row.fuzzy == null || row.fuzzy === ""
          ? null
          : Number.isFinite(Number(row.fuzzy))
          ? Number(row.fuzzy)
          : null,
    }));
    window.currentResults = prepared;
    runCount = prepared.length;
    MAX_RUNS = prepared.length;
    currentPage = 1;
    updateCounter(counterEl, runCount, MAX_RUNS || runCount);
    showResultsSection();
    clearResultsTable();
    ensureNewestFirstOrdering();
    setupDownloadButton(prepared);
    enableClearButton(snapshotLabel);
    const downloadBtn = document.getElementById("downloadCSVButton");
    if (downloadBtn) show(downloadBtn, "inline-flex");
    const spinnerEl = document.getElementById("spinner");
    hide(spinnerEl);
    const progressContainer = document.getElementById("progressContainer");
    hide(progressContainer);
    const pauseBtn = document.getElementById("pauseResumeButton");
    hide(pauseBtn);
    const stopBtn = document.getElementById("stopButton");
    hide(stopBtn);
    const resumeBadge = document.getElementById("resumeBadge");
    hide(resumeBadge);
    const resumeBtn = document.getElementById("resumeSessionButton");
    hide(resumeBtn);
    isPaused = false;
    isProcessingRow = false;
    shouldStop = false;
    stoppedPermanently = false;
    return prepared;
  }

  async function handleCsvImportFile(file) {
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      if (!workbook.SheetNames.length)
        throw new Error("File CSV không có dữ liệu.");
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!sheet) throw new Error("Không thể đọc dữ liệu CSV.");
      let rows = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        blankrows: false,
        defval: "",
        raw: false,
      });
      rows = rows
        .map((row) => (Array.isArray(row) ? row : []))
        .filter((row) =>
          row.some(
            (cell) =>
              cell !== null &&
              cell !== undefined &&
              String(cell).trim() !== ""
          )
        );
      if (!rows.length) throw new Error("File CSV rỗng.");
      const headerRow = rows.shift();
      const headerInfo = buildCsvHeaderInfo(headerRow);
      const results = rowsToImportedResults(rows, headerInfo);
      if (!results.length)
        throw new Error("Không tìm thấy dữ liệu hợp lệ trong file CSV.");
      const prepared = applyImportedResultsToUi(results, IMPORT_SNAPSHOT_LABEL);
      try {
        localStorage.setItem("runCount", String(runCount));
      } catch (e) {}
      try {
        const sessionPayload = {
          results: prepared,
          maxRuns: MAX_RUNS,
          nextIndex: 0,
          allRows: null,
          source: "csvImport",
          importedFile: file.name,
          importedAt: new Date().toISOString(),
        };
        localStorage.setItem("tavily_session", JSON.stringify(sessionPayload));
        localStorage.removeItem("tavily_stop_snapshot");
        localStorage.removeItem("tavily_stopped_permanently");
      } catch (e) {
        console.warn("Không thể lưu phiên sau khi import CSV", e);
      }
      if (Toasts)
        Toasts.show(`Đã import ${prepared.length} dòng từ CSV`, {
          type: "success",
          title: "Import CSV",
        });
    } catch (error) {
      console.error("Import CSV thất bại", error);
      const message = error?.message || "Không thể import CSV";
      if (Toasts)
        Toasts.show(message, {
          type: "error",
          title: "Import CSV",
        });
      else alert(message);
    } finally {
      if (importInputEl) importInputEl.value = "";
    }
  }

  function restoreImportedResultsFromSession() {
    try {
      const saved = JSON.parse(localStorage.getItem("tavily_session") || "null");
      if (
        saved &&
        saved.source === "csvImport" &&
        Array.isArray(saved.results) &&
        saved.results.length
      ) {
        applyImportedResultsToUi(saved.results, IMPORT_SNAPSHOT_LABEL);
        try {
          localStorage.setItem("runCount", String(runCount));
        } catch (e) {}
      }
    } catch (e) {
      console.warn("Không thể khôi phục dữ liệu import CSV", e);
    }
  }
  // If there's no saved session, clear any stale runCount so page doesn't show e.g. 10/0
  try {
    const s = localStorage.getItem("tavily_session");
    if (!s) {
      localStorage.removeItem("runCount");
      runCount = 0;
    }
  } catch (e) {}
  // Cập nhật giao diện ban đầu
  updateCounter(counterEl, runCount, MAX_RUNS);
  // focus the filter input on load so user can start typing immediately
  try {
    const initialFilter = document.getElementById("filterInput");
    if (initialFilter) {
      initialFilter.focus();
      if (typeof initialFilter.select === "function") initialFilter.select();
    }
  } catch (e) {}

  if (importButtonEl && importInputEl) {
    importButtonEl.addEventListener("click", (evt) => {
      evt.preventDefault();
      importInputEl.value = "";
      importInputEl.click();
    });
    importInputEl.addEventListener("change", async (evt) => {
      const file = evt.target?.files && evt.target.files[0];
      if (!file) return;
      await handleCsvImportFile(file);
    });
  }

  restoreImportedResultsFromSession();

  const searchBtnEl = document.getElementById("searchButton");
  if (searchBtnEl)
    searchBtnEl.addEventListener("click", async () => {
      // If previous run was permanently stopped, reset flags for a clean new run
      if (stoppedPermanently) {
        stoppedPermanently = false;
        shouldStop = false;
        localStorage.removeItem("tavily_stopped_permanently");
        // Clear any old session data so we don't auto-resume
        localStorage.removeItem("tavily_session");
        localStorage.removeItem("runCount");
        runCount = 0;
        updateCounter(counterEl, 0, 0);
      }
      // Always clear shouldStop at the beginning of a brand new run
      shouldStop = false;
      ensureNewestFirstOrdering();
      const searchBtn = document.getElementById("searchButton");
      const spinnerEl = document.getElementById("spinner");
      const downloadBtn = document.getElementById("downloadCSVButton");
      const clearBtn = document.getElementById("clearResultsButton");
      const pauseBtn = document.getElementById("pauseResumeButton");
      const stopBtn = document.getElementById("stopButton");
      const progressContainer = document.getElementById("progressContainer");
      const progressBar = document.getElementById("progressBar");
      const progressText = document.getElementById("progressText");
      // Disable button and show spinner
      if (searchBtn) searchBtn.disabled = true;
      // reveal spinner & pause button early
      show(spinnerEl, "flex");
      const pauseResumeBtn = document.getElementById("pauseResumeButton");
      show(pauseResumeBtn, "inline-flex");
      if (stopBtn) show(stopBtn, "inline-flex");
      const progressContainerEl = document.getElementById("progressContainer");
      show(progressContainerEl);
      const fileInput = document.getElementById("fileInput");
      if (!fileInput || fileInput.files.length === 0) {
        if (Toasts && Toasts.error)
          Toasts.error("Vui lòng chọn một file Excel!");
        else if (Toasts)
          Toasts.show("Vui lòng chọn một file Excel!", {
            type: "error",
            title: "Lỗi",
          });
        else alert("Vui lòng chọn một file Excel!");
        if (searchBtn) searchBtn.disabled = false;
        hide(spinnerEl);
        hide(pauseResumeBtn);
        hide(stopBtn);
        return;
      }
      const file = fileInput.files[0];
      const reader = new FileReader();
      reader.onload = async (e) => {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: "array" });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        let jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        jsonData = jsonData.filter((row) =>
          row.some((cell) => cell !== undefined && cell !== null && cell !== "")
        );
        jsonData.shift();
        console.log(jsonData.length);
        // detect saved session and decide startIndex
        let startIndex = 0;
        try {
          const saved = JSON.parse(
            localStorage.getItem("tavily_session") || "null"
          );
          if (
            saved &&
            typeof saved.nextIndex === "number" &&
            saved.nextIndex > 0 &&
            Array.isArray(saved.allRows)
          ) {
            const n = Math.min(saved.nextIndex, jsonData.length);
            // compare first n rows crudely to ensure same file/order
            let match = true;
            for (let i = 0; i < n; i++) {
              try {
                if (
                  JSON.stringify(saved.allRows[i]) !==
                  JSON.stringify(jsonData[i])
                ) {
                  match = false;
                  break;
                }
              } catch (e) {
                match = false;
                break;
              }
            }
            if (match) {
              startIndex = saved.nextIndex;
              // restore previous results into window and table
              window.currentResults = saved.results || [];
              showResultsSection();
              clearResultsTable();
              sortTable(currentSort, false);
              // restore runCount from saved results length
              runCount =
                saved.results && saved.results.length
                  ? saved.results.length
                  : runCount;
              updateCounter(counterEl, runCount, jsonData.length);
              // After restoring, recompute fuzzy for rows that were not persisted (older code didn't persist)
              recomputeMissingFuzzy();
            } else {
              // different file -- overwrite session later
              startIndex = 0;
            }
          }
        } catch (e) {
          startIndex = 0;
        }

        // save allRows into session so resume can continue without re-upload (update allRows and maxRuns)
        try {
          const sess = JSON.parse(
            localStorage.getItem("tavily_session") || "{}"
          );
          sess.allRows = jsonData;
          sess.maxRuns = jsonData.length;
          // if we didn't restore results above, ensure sess.results is at least empty array
          sess.results = sess.results || [];
          localStorage.setItem("tavily_session", JSON.stringify(sess));
        } catch (e) {
          /* ignore */
        }

        // show results area immediately when starting a run
        showResultsSection();
        // start processing from the decided index
        await processRows(jsonData, startIndex);
      };

      reader.readAsArrayBuffer(file);
    });

  // Pagination helpers
  function totalPages() {
    const results = window.currentResults || [];
    return Math.max(1, Math.ceil(results.length / pageSize));
  }

  function goToPage(n) {
    const tp = totalPages();
    if (n < 1) n = 1;
    if (n > tp) n = tp;
    currentPage = n;
    renderResultsPage();
    updatePaginationControls();
  }

  function changePageSize(size) {
    pageSize = size;
    localStorage.setItem("tavily_pageSize", String(pageSize));
    currentPage = 1;
    renderResultsPage();
    updatePaginationControls();
  }

  function ensureOrderVisible(order, opts = {}) {
    const results = window.currentResults || [];
    const targetOrder = Number(order);
    if (!Number.isFinite(targetOrder)) return null;
    const idx = results.findIndex((r) => Number(r?.order) === targetOrder);
    if (idx === -1) return null;
    const targetPage = Math.floor(idx / pageSize) + 1;
    if (targetPage !== currentPage) {
      goToPage(targetPage);
    }
    const body = document.getElementById("resultsBody");
    if (!body) return null;
    const rowEl = body.querySelector(`tr[data-order="${targetOrder}"]`);
    if (!rowEl) return null;
    const prev = document.querySelector("tr.selected-row");
    if (prev && prev !== rowEl) prev.classList.remove("selected-row");
    rowEl.classList.add("selected-row");
    if (opts.scroll !== false) {
      try {
        rowEl.scrollIntoView({ behavior: "smooth", block: "center" });
      } catch (e) {}
    }
    return rowEl;
  }

  resultDetailState.ensureVisible = ensureOrderVisible;
  window.showResultDetail = (order, opts) => openResultDetailModal(order, opts);
  window.closeResultDetailModal = closeResultDetailModal;

  function renderResultsPage() {
    const body = document.getElementById("resultsBody");
    if (!body) return;
    body.innerHTML = "";
    const results = window.currentResults || [];
    const start = (currentPage - 1) * pageSize;
    const pageRows = results.slice(start, start + pageSize);
    for (const r of pageRows) {
      // reuse appendResultRow but it appends directly; instead create a temporary container
      appendResultRow(r, {
        skipFilterRefresh: true,
      });
    }
    if (lastFilterQueryRaw) {
      applyFilterToResults(lastFilterQueryRaw, {
        preserveSelection: true,
        scrollToFirst: false,
      });
    } else {
      updateResultsCountDisplay();
    }
  }

  function updatePaginationControls() {
    const pageInfo = document.getElementById("pageInfo");
    const prevBtn = document.getElementById("pagePrev");
    const nextBtn = document.getElementById("pageNext");
    if (!pageInfo || !prevBtn || !nextBtn) return;
    pageInfo.textContent = `Trang ${currentPage}/${totalPages()}`;
    prevBtn.disabled = currentPage <= 1;
    nextBtn.disabled = currentPage >= totalPages();
  }

  // Process rows helper used for both fresh runs and resume
  async function processRows(jsonData, startIndex = 0) {
    const searchBtn = document.getElementById("searchButton");
    const spinnerEl = document.getElementById("spinner");
    const downloadBtn = document.getElementById("downloadCSVButton");
    const clearBtn = document.getElementById("clearResultsButton");
    const pauseBtn = document.getElementById("pauseResumeButton");
    const stopBtn = document.getElementById("stopButton");
    const progressContainer = document.getElementById("progressContainer");
    const progressBar = document.getElementById("progressBar");
    const progressText = document.getElementById("progressText");
    const resumeBadge = document.getElementById("resumeBadge");

    const results =
      window.currentResults && window.currentResults.length
        ? window.currentResults
        : [];
    // Ensure pause button is visible when a run starts
    const pauseBtnEl = document.getElementById("pauseResumeButton");
    if (pauseBtnEl) {
      show(pauseBtnEl, "inline-flex");
      pauseBtnEl.textContent = "Tạm dừng";
    }
    const existingMaxOrder = results.reduce((max, r) => {
      const value = typeof r?.order === "number" ? r.order : Number(r?.order);
      return Number.isFinite(value) && value > max ? value : max;
    }, 0);
    let order = existingMaxOrder + 1;
    let currentIndex = results.length || 0;
    MAX_RUNS = jsonData.length;
    updateCounter(counterEl, runCount, MAX_RUNS);
    // If starting fresh, clear table
    if (startIndex === 0) clearResultsTable();

    const startTime = Date.now();
    for (let rowIndex = startIndex; rowIndex < jsonData.length; rowIndex++) {
      while (isPaused) {
        await new Promise((r) => setTimeout(r, 200));
      }
      if (shouldStop) break;
      const row = jsonData[rowIndex];
      isProcessingRow = true;
      let [hotelNo, hotelName, hotelAddress, hotelUrlType] = row;
      if (!hotelName || !hotelAddress) {
        isProcessingRow = false;
        continue;
      }

      hotelName = hotelName.replace(/[^\x00-\x7F]/g, "");
      const hotelNameArray = hotelName
        .split(" ")
        .map((part) =>
          part.replace(",", "").replace("(", "").replace(")", "").toLowerCase()
        );
      let query =
        hotelUrlType == "CTrip SuperAgg"
          ? `${hotelName} ${hotelAddress} trip`
          : `${hotelName} ${hotelAddress}`;

      let searchURL =
        window.location.hostname === "localhost"
          ? `http://localhost:3000/searchApiTavily?q=${encodeURIComponent(
              query
            )}`
          : `/searchApiTavily?q=${encodeURIComponent(query)}`;

      let matchedLink = [];
        try {
            await sleep(2000);
			console.log("2s trên 1 request");
        const response = await axios.get(searchURL);
        const data = response.data;
        const resultsFromBrave = data.results;
        if (resultsFromBrave && resultsFromBrave.length > 0) {
          let resultsFromBraveArray = [];
          for (let result of resultsFromBrave) {
            const pageTitle = (result.title || "").toLowerCase();
            const pageUrl = result.url || "";
            const pageContent = (
              result.content ||
              result.rawContent ||
              ""
            ).toLowerCase();
            const apiScore =
              typeof result.score === "number" ? result.score : 0;
            const isMatch = isHotelNameInPage(
              hotelNameArray,
              pageTitle,
              pageUrl,
              pageContent,
              apiScore
            );
            if (isMatch.status && pageUrl.includes(".com")) {
              resultsFromBraveArray.push({
                percentage: isMatch.percentage,
                matchedLink: pageUrl,
                title: result.title || "",
              });
            }
          }
          const maxPercentageResult = resultsFromBraveArray.reduce(
            (max, item) => (item.percentage > max.percentage ? item : max),
            { percentage: -Infinity }
          );
          resultsFromBraveArray = resultsFromBraveArray
            .filter(
              (row) =>
                row.percentage == maxPercentageResult.percentage &&
                !row.matchedLink.includes("tripadvisor") &&
                !row.matchedLink.includes("makemytrip")
            )
            .sort((a, b) => {
              const getPriority = (link) => {
                if (link.includes("agoda")) return 2;
                if (link.includes("booking")) return 3;
                return 18;
              };
              return getPriority(a.matchedLink) - getPriority(b.matchedLink);
            });
          matchedLink = resultsFromBraveArray.map(
            ({ percentage, matchedLink, title }) => ({
              url: matchedLink,
              percentage,
              title,
            })
          );
        }
      } catch (error) {
        console.log("Lỗi khi tìm kiếm:", error);
      }

      const maxPct =
        matchedLink && matchedLink.length
          ? Math.max(...matchedLink.map((m) => m.percentage || 0))
          : 0;
      const statusLabel =
        matchedLink && matchedLink.length ? "Matched" : "No match";
      results.push({
        order: order++,
        hotelNo,
        hotelName,
        hotelAddress,
        matchedLinks: matchedLink
          ? matchedLink.map((m) => ({
              url: m.url,
              percentage: m.percentage,
              title: m.title || "",
            }))
          : [],
        percentage: Math.round(maxPct),
        status: statusLabel,
        fuzzy: null,
      });
      const newRowOrder = results[results.length - 1]?.order;
      window.currentResults = results;
      // sort lại theo trạng thái hiện tại
      sortTable(currentSort, false);
      // save session: full rows + nextIndex
      try {
        const session = JSON.parse(
          localStorage.getItem("tavily_session") || "{}"
        );
        session.results = window.currentResults;
        session.nextIndex = rowIndex + 1;
        session.allRows = jsonData;
        session.maxRuns = MAX_RUNS;
        localStorage.setItem("tavily_session", JSON.stringify(session));
      } catch (e) {
        console.warn("Could not save session:", e);
      }

      runCount++;
      localStorage.setItem("runCount", runCount);
      updateCounter(counterEl, runCount, MAX_RUNS);
      if (typeof newRowOrder === "number") {
        const newIndex = results.findIndex((r) => r.order === newRowOrder);
        if (newIndex !== -1) {
          const startIndex = (currentPage - 1) * pageSize;
          const endIndex = startIndex + pageSize - 1;
          if (newIndex >= startIndex && newIndex <= endIndex) {
            const body = document.getElementById("resultsBody");
            const rowEl = body
              ? body.querySelector(`tr[data-order="${newRowOrder}"]`)
              : null;
            const newRowObj = results[newIndex];
            if (rowEl && fuzzyEnabled && fuzzyWorker) {
              try {
                const candidates = (newRowObj.matchedLinks || []).map((l) => ({
                  title: l.title || l.url,
                  url: l.url,
                }));
                if (!candidates.length) {
                  const c = rowEl.querySelector('[data-col="fuzzy"]');
                  if (c) c.textContent = "-";
                } else {
                  pendingFuzzyQueue.push({
                    rowRef: rowEl,
                    resultObj: newRowObj,
                    expected: candidates.length,
                    candidates,
                  });
                  fuzzyWorker.postMessage({
                    type: "score",
                    query: newRowObj.hotelName || "",
                    candidates,
                    opts: { titleOnly: true },
                  });
                }
              } catch (e) {}
            }
          }
        }
      }
      currentIndex++;
      const pct = Math.round((currentIndex / MAX_RUNS) * 100);
      if (progressBar) progressBar.style.width = pct + "%";
      if (progressText) {
        const elapsed = Date.now() - startTime; // ms
        const avg = currentIndex ? elapsed / currentIndex : 0;
        const remaining = MAX_RUNS - currentIndex;
        const etaMs = Math.round(remaining * avg);
        const fmt = (ms) => {
          if (!isFinite(ms) || ms <= 0) return "0s";
          const s = Math.round(ms / 1000);
          const m = Math.floor(s / 60);
          const rs = s % 60;
          return m ? `${m}m${rs ? rs + "s" : ""}` : `${rs}s`;
        };
        progressText.textContent = `${pct}% (${currentIndex}/${MAX_RUNS}) • ETA ${fmt(
          etaMs
        )}`;
      }
      if (progressBar) {
        progressBar.setAttribute("aria-valuenow", String(pct));
        progressBar.setAttribute(
          "aria-valuetext",
          `${pct} phần trăm (${currentIndex}/${MAX_RUNS})`
        );
      }
      console.log("Dong thu:", currentIndex, "hoan thanh.");
      isProcessingRow = false;
    }

    if (results.length > 0) {
      window.currentResults = results;
      showResultsSection();
      // Do NOT remove tavily_session on completion — keep session to allow later resume
      try {
        localStorage.setItem("runCount", runCount);
        updateCounter(counterEl, runCount, MAX_RUNS);
      } catch (e) {}
      setupDownloadButton(results);
      if (clearBtn) enableClearButton();
    } else {
      if (Toasts)
        Toasts.show("Không tìm thấy kết quả nào phù hợp", {
          type: "error",
          title: "Không có kết quả",
        });
    }

    if (searchBtn) searchBtn.disabled = false;
    hide(spinnerEl);
    hide(pauseBtn);
    hide(progressContainer);
    if (stopBtn) hide(stopBtn);
    if (resumeBadge) hide(resumeBadge);
    if (shouldStop) {
      // mark permanent stop so auto-resume after F5 will not run
      // snapshot current results for possible restore (not auto-run)
      try {
        const snap = {
          results: (window.currentResults || []).slice(),
          runCount: runCount,
          maxRuns: MAX_RUNS,
          stoppedAt: Date.now(),
        };
        localStorage.setItem("tavily_stop_snapshot", JSON.stringify(snap));
        // include any session rows for continue
        let allRowsForStop = null;
        try {
          const sess = JSON.parse(
            localStorage.getItem("tavily_session") || "null"
          );
          if (sess && Array.isArray(sess.allRows))
            allRowsForStop = sess.allRows;
        } catch (e) {}
        addSnapshot("Stop", {
          results: snap.results,
          runCount: snap.runCount,
          maxRuns: snap.maxRuns,
          allRows: allRowsForStop,
        });
      } catch (e) {
        /* ignore */
      }
      localStorage.setItem("tavily_stopped_permanently", "1");
      stoppedPermanently = true;
      try {
        localStorage.removeItem("tavily_session");
      } catch (e) {}
      if (Toasts) {
        Toasts.show("Đã dừng. Bạn có thể Hoàn tác để xem lại kết quả.", {
          type: "warning",
          title: "Dừng",
          actions: [
            {
              label: "Hoàn tác",
              onClick: () => {
                try {
                  const raw = localStorage.getItem("tavily_stop_snapshot");
                  if (!raw) return;
                  const snap = JSON.parse(raw);
                  window.currentResults = snap.results || [];
                  runCount =
                    snap.runCount || (window.currentResults || []).length;
                  MAX_RUNS = snap.maxRuns || runCount;
                  updateCounter(counterEl, runCount, MAX_RUNS);
                  showResultsSection();
                  clearResultsTable();
                  sortTable(currentSort, false);
                } catch (e) {}
              },
            },
          ],
          timeout: 8000,
        });
      }
      // inline undo button below if container exists
      try {
        const undoInline = document.getElementById("undoInlineContainer");
        if (undoInline) {
          undoInline.innerHTML = "";
          const btn = document.createElement("button");
          btn.className = "btn btn-outline btn-small";
          btn.innerHTML =
            '<i class="fa-solid fa-rotate-left"></i><span>Hoàn tác dừng</span>';
          btn.addEventListener("click", () => {
            try {
              const raw = localStorage.getItem("tavily_stop_snapshot");
              if (!raw) return;
              const snap = JSON.parse(raw);
              window.currentResults = snap.results || [];
              runCount = snap.runCount || (window.currentResults || []).length;
              MAX_RUNS = snap.maxRuns || runCount;
              updateCounter(counterEl, runCount, MAX_RUNS);
              showResultsSection();
              clearResultsTable();
              sortTable(currentSort, false);
              undoInline.innerHTML = "";
              hide(undoInline);
            } catch (e) {}
          });
          undoInline.appendChild(btn);
          show(undoInline, "block");
          setTimeout(() => {
            if (undoInline && undoInline.firstChild) {
              undoInline.innerHTML = "";
              hide(undoInline);
            }
          }, 20000);
        }
      } catch (e) {}
    }
  }

  // Pause/Resume handling
  const pauseBtnGlobal = document.getElementById("pauseResumeButton");
  if (pauseBtnGlobal) {
    pauseBtnGlobal.addEventListener("click", () => {
      isPaused = !isPaused;
      // If we just paused, trigger a download of current partial results
      if (isPaused) {
        pauseBtnGlobal.textContent = "Tiếp tục";
        const spinnerEl = document.getElementById("spinner");
        if (spinnerEl) spinnerEl.style.opacity = "0.6";
        // wait until current processing row finishes (or timeout after ~5s)
        const waitStart = Date.now();
        const waitTimeout = 5000;
        (async function waitForFinish() {
          while (isProcessingRow && Date.now() - waitStart < waitTimeout) {
            await new Promise((r) => setTimeout(r, 100));
          }
          // ensure download button is visible
          const downloadBtnEl = document.getElementById("downloadCSVButton");
          if (downloadBtnEl) show(downloadBtnEl, "inline-flex");
          // prepare filename containing timestamp and current count
          const now = new Date();
          const ts = now.toISOString().replace(/[:\.]/g, "-");
          const count = (window.currentResults || []).length || 0;
          const filename = `hotel_search_partial_${count}_${ts}.csv`;
          try {
            // capture a snapshot of current results so manual download gets the paused set
            const resultsToSave = JSON.parse(
              JSON.stringify(window.currentResults || [])
            );
            if (resultsToSave.length > 0) {
              const downloadBtnEl =
                document.getElementById("downloadCSVButton");
              if (downloadBtnEl) {
                show(downloadBtnEl, "inline-flex");
                // bind a one-time click handler to download this snapshot with the filename
                downloadBtnEl.onclick = () =>
                  downloadCSV(resultsToSave, filename);
                // also store filename in dataset for visibility/debug
                downloadBtnEl.dataset.lastFilename = filename;
              }
            }
          } catch (e) {
            console.error("Lỗi khi chuẩn bị partial CSV:", e);
          }
        })();
      } else {
        // resumed
        pauseBtnGlobal.textContent = "Tạm dừng";
        const spinnerEl = document.getElementById("spinner");
        if (spinnerEl) spinnerEl.style.opacity = "1";
      }
    });
  }
  const stopBtnGlobal = document.getElementById("stopButton");
  if (stopBtnGlobal) {
    stopBtnGlobal.addEventListener("click", () => {
      if (shouldStop) return;
      shouldStop = true;
      stopBtnGlobal.disabled = true;
      stopBtnGlobal.innerHTML =
        '<i class="fa-solid fa-circle-stop"></i><span>Đang dừng...</span>';
      if (Toasts)
        Toasts.show("Đang chờ dòng hiện tại hoàn tất...", {
          type: "info",
          title: "Dừng",
        });
    });
  }
  // Auto-resume if a saved session with allRows exists
  try {
    const saved = JSON.parse(localStorage.getItem("tavily_session") || "null");
    if (
      !stoppedPermanently &&
      saved &&
      Array.isArray(saved.allRows) &&
      typeof saved.nextIndex === "number" &&
      saved.nextIndex > 0
    ) {
      // restore previous results into window and table
      window.currentResults = saved.results || [];
      clearResultsTable();
      sortTable(currentSort, false);
      runCount =
        saved.results && saved.results.length ? saved.results.length : runCount;
      MAX_RUNS = saved.maxRuns || (saved.allRows && saved.allRows.length) || 0;
      updateCounter(counterEl, runCount, MAX_RUNS);

      // Hiển thị bảng kết quả live khi resume hoặc reload
      showResultsSection();

      // Recompute any missing fuzzy scores (from previous session without persistence or rows not on current page)
      recomputeMissingFuzzy();

      // prepare UI for running
      const searchBtn = document.getElementById("searchButton");
      const spinnerEl = document.getElementById("spinner");
      const pauseBtn = document.getElementById("pauseResumeButton");
      const stopBtn = document.getElementById("stopButton");
      if (searchBtn) searchBtn.disabled = true;
      show(spinnerEl, "flex");
      if (pauseBtn) {
        show(pauseBtn, "inline-flex");
        pauseBtn.textContent = "Tạm dừng";
      }
      // Hiển thị nút Dừng khi auto-resume
      if (stopBtn) {
        show(stopBtn, "inline-flex");
        stopBtn.disabled = false;
        stopBtn.innerHTML = '<i class="fa-solid fa-circle-stop"></i><span>Dừng</span>';
      }

      // Restore progress bar state on resume
      const progressContainerResume =
        document.getElementById("progressContainer");
      const progressBarResume = document.getElementById("progressBar");
      const progressTextResume = document.getElementById("progressText");
      if (progressContainerResume) show(progressContainerResume);
      if (progressBarResume && MAX_RUNS > 0) {
        const done = runCount; // runCount reflects saved.results length
        const pct = Math.min(100, Math.round((done / MAX_RUNS) * 100));
        progressBarResume.style.width = pct + "%";
        progressBarResume.setAttribute("aria-valuenow", String(pct));
        progressBarResume.setAttribute(
          "aria-valuetext",
          `${pct} phần trăm (${done}/${MAX_RUNS})`
        );
        if (progressTextResume) {
          progressTextResume.textContent = `${pct}% (${done}/${MAX_RUNS})`;
        }
      }
      const resumeBadge = document.getElementById("resumeBadge");
      if (resumeBadge) show(resumeBadge, "inline-flex");

      // start processing automatically from saved.nextIndex
      (async () => {
        try {
          await processRows(saved.allRows, saved.nextIndex);
        } catch (e) {
          console.error("Auto-resume failed", e);
        }
        const resumeBadge = document.getElementById("resumeBadge");
        if (resumeBadge) hide(resumeBadge);
      })();
    }
  } catch (e) {
    /* ignore */
  }

  // pagination control wiring
  try {
    const prev = document.getElementById("pagePrev");
    const next = document.getElementById("pageNext");
    const sizeSel = document.getElementById("pageSizeSelect");
    if (prev) prev.addEventListener("click", () => goToPage(currentPage - 1));
    if (next) next.addEventListener("click", () => goToPage(currentPage + 1));
    if (sizeSel) {
      sizeSel.value = String(pageSize);
      sizeSel.addEventListener("change", (e) =>
        changePageSize(parseInt(e.target.value || "2000"))
      );
    }
    // initial render if there are restored results
    if (window.currentResults && window.currentResults.length) {
      renderResultsPage();
      updatePaginationControls();
    }
  } catch (e) {}

  // small helper to stop if needed in future
  window.stopSearch = () => {
    shouldStop = true;
  };

  // ===== Snapshot Archive UI =====
  (function initSnapshotArchive() {
    const btn = document.getElementById("snapshotArchiveButton");
    const modal = document.getElementById("snapshotArchiveModal");
    const listEl = document.getElementById("snapshotArchiveList");
    const searchInput = document.getElementById("snapshotArchiveSearch");
    const searchClear = document.getElementById("snapshotArchiveSearchClear");
    let currentFilter = "";
    const closeEls = [
      document.getElementById("snapshotArchiveClose"),
      document.getElementById("snapshotArchiveCloseFooter"),
    ];
    const delAll = document.getElementById("snapshotArchiveDeleteAll");
    const exportAll = document.getElementById("snapshotArchiveExportAll");
    function filteredSnapshots() {
      let arr = loadArchivedSnapshots();
      if (currentFilter) {
        const q = currentFilter.toLowerCase();
        arr = arr.filter((s) => (s.label || "").toLowerCase().includes(q));
      }
      return arr;
    }
    function refreshList() {
      if (!listEl) return;
      const arr = filteredSnapshots();
      if (!arr.length) {
        listEl.innerHTML =
          '<div class="text-tertiary">(Chưa có snapshot)</div>';
        return;
      }
      listEl.innerHTML = arr
        .map((s) => {
          const pct = s.maxRuns
            ? Math.round((s.runCount / s.maxRuns) * 100)
            : s.runCount
            ? 100
            : 0;
          const canContinue =
            s.allRows &&
            Array.isArray(s.allRows) &&
            s.allRows.length > s.runCount;
          return `<div class=\"glass-card\" data-id=\"${
            s.id
          }\" style=\"padding:8px;display:flex;gap:8px;align-items:center\">
          <div class=\"snap-meta\" style=\"flex:1;min-width:160px;cursor:text\" data-act=\"rename\" data-id=\"${
            s.id
          }\" title=\"Double-click để đổi tên\">
            <div class=\"snap-label\" style=\"font-weight:600;font-size:.75rem;word-break:break-word\">${
              s.label
            }</div>
            <div style=\"font-size:.6rem;color:var(--text-tertiary)\">${new Date(
              s.ts
            ).toLocaleString()} • ${s.runCount}/${s.maxRuns} • ${pct}%</div>
          </div>
          <div class=\"flex gap-xs\">
            <button class=\"btn btn-outline btn-small\" data-act=\"restore\" data-id=\"${
              s.id
            }\"><i class=\"fa-solid fa-rotate-left\"></i><span>Xem</span></button>
            <button class=\"btn btn-outline btn-small\" data-act=\"csv\" data-id=\"${
              s.id
            }\"><i class=\"fa-solid fa-file-csv\"></i></button>
            ${
              canContinue
                ? `<button class=\"btn btn-outline btn-small\" data-act=\"continue\" data-id=\"${s.id}\"><i class=\"fa-solid fa-play\"></i></button>`
                : ""
            }
            <button class=\"btn btn-outline btn-small\" data-act=\"delete\" data-id=\"${
              s.id
            }\" style=\"--btn-accent:#c0392b\"><i class=\"fa-solid fa-xmark\"></i></button>
          </div>
        </div>`;
        })
        .join("");
    }
    function openModal() {
      if (!modal) return;
      refreshList();
      show(modal, "flex");
    }
    function closeModal() {
      if (modal) hide(modal);
    }
    if (btn) {
      if (loadArchivedSnapshots().length) btn.classList.remove("hidden");
      btn.addEventListener("click", openModal);
    }
    closeEls.forEach((el) => el && el.addEventListener("click", closeModal));
    if (modal)
      modal.addEventListener("click", (e) => {
        if (e.target === modal) closeModal();
      });
    if (listEl) {
      listEl.addEventListener("click", (e) => {
        const t = e.target.closest("button[data-act]");
        if (!t) return;
        const id = t.getAttribute("data-id");
        const act = t.getAttribute("data-act");
        let arr = loadArchivedSnapshots();
        const idx = arr.findIndex((s) => s.id === id);
        if (idx === -1) return;
        const snap = arr[idx];
        if (act === "restore") {
          window.currentResults = (snap.results || []).slice();
          runCount = snap.runCount || (window.currentResults || []).length;
          MAX_RUNS = snap.maxRuns || runCount;
          updateCounter(counterEl, runCount, MAX_RUNS);
          showResultsSection();
          clearResultsTable();
          sortTable(currentSort, false);
          if (Toasts)
            Toasts.show("Đã khôi phục snapshot", {
              type: "success",
              title: "Khôi phục",
            });
        } else if (act === "csv") {
          downloadCSV(
            snap.results || [],
            `snapshot_${snap.label}_${snap.id}.csv`
          );
        } else if (act === "delete") {
          arr.splice(idx, 1);
          saveArchivedSnapshots(arr);
          refreshList();
          if (!arr.length && btn) btn.classList.add("hidden");
        } else if (act === "continue") {
          if (!snap.allRows || !Array.isArray(snap.allRows)) {
            if (Toasts)
              Toasts.show("Snapshot không có dữ liệu nguồn để chạy tiếp", {
                type: "error",
                title: "Không thể tiếp tục",
              });
            return;
          }
          // Prepare session and auto-resume from snap.runCount
          try {
            const sess = {
              allRows: snap.allRows,
              results: (snap.results || []).slice(),
              nextIndex: snap.runCount,
              maxRuns: snap.maxRuns,
            };
            localStorage.setItem("tavily_session", JSON.stringify(sess));
            localStorage.removeItem("tavily_stopped_permanently");
            localStorage.setItem("runCount", String(snap.runCount || 0));
            // reset stop flags & start processing immediately
            shouldStop = false;
            stoppedPermanently = false;
            window.currentResults = (snap.results || []).slice();
            runCount = snap.runCount || window.currentResults.length;
            MAX_RUNS =
              snap.maxRuns || (snap.allRows ? snap.allRows.length : runCount);
            updateCounter(counterEl, runCount, MAX_RUNS);
            showResultsSection();
            clearResultsTable();
            sortTable(currentSort, false);
            // show progress bar early
            const progressContainer =
              document.getElementById("progressContainer");
            if (progressContainer) show(progressContainer);
            const progressBar = document.getElementById("progressBar");
            const pct = MAX_RUNS ? Math.round((runCount / MAX_RUNS) * 100) : 0;
            if (progressBar) {
              progressBar.style.width = pct + "%";
              progressBar.setAttribute("aria-valuenow", String(pct));
              progressBar.setAttribute(
                "aria-valuetext",
                `${pct} phần trăm (${runCount}/${MAX_RUNS})`
              );
            }
            if (Toasts)
              Toasts.show("Đang tiếp tục từ snapshot...", {
                type: "info",
                title: "Tiếp tục",
              });
            // Trigger processing of remaining rows asynchronously
            setTimeout(() => {
              try {
                processRows(snap.allRows, snap.runRate || 0);
              } catch (e) {}
            }, 100);
          } catch (e) {
            if (Toasts)
              Toasts.show("Lỗi tiếp tục snapshot", {
                type: "error",
                title: "Lỗi",
              });
          }
        }
      });
    }
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        currentFilter = searchInput.value.trim();
        refreshList();
      });
    }
    if (searchClear) {
      searchClear.addEventListener("click", () => {
        currentFilter = "";
        if (searchInput) searchInput.value = "";
        refreshList();
      });
    }
    if (delAll)
      delAll.addEventListener("click", () => {
        saveArchivedSnapshots([]);
        refreshList();
        const b = document.getElementById("snapshotArchiveButton");
        if (b) b.classList.add("hidden");
      });
    if (exportAll)
      exportAll.addEventListener("click", () => {
        const arr = loadArchivedSnapshots();
        arr.forEach((s) =>
          downloadCSV(s.results || [], `snapshot_${s.label}_${s.id}.csv`)
        );
      });
  })();

  function ensureNewestFirstOrdering() {
    currentSort = "order";
    orderSortAsc = false;
    sortTable("order", false);
  }

  // Hàm sort cho từng cột
  function sortTable(col, toggle = true) {
    // Chỉ đảo chiều khi click icon, không đảo chiều khi thêm dòng mới
    if (toggle) {
      currentSort = col;
      switch (col) {
        case "order":
          orderSortAsc = !orderSortAsc;
          break;
        case "no":
          noSortAsc = !noSortAsc;
          break;
        case "pct":
          pctSortAsc = !pctSortAsc;
          break;
        case "status":
          statusSortAsc = !statusSortAsc;
          break;
        case "name":
          nameSortAsc = !nameSortAsc;
          break;
        case "links":
          linksSortAsc = !linksSortAsc;
          break;
      }
    }
    // Lấy chiều sort hiện tại
    let asc = true;
    switch (col) {
      case "order":
        asc = orderSortAsc;
        break;
      case "no":
        asc = noSortAsc;
        break;
      case "pct":
        asc = pctSortAsc;
        break;
      case "status":
        asc = statusSortAsc;
        break;
      case "name":
        asc = nameSortAsc;
        break;
      case "links":
        asc = linksSortAsc;
        break;
    }
    const results = window.currentResults || [];
    results.sort((a, b) => {
      switch (col) {
        case "order":
          return asc ? a.order - b.order : b.order - a.order;
        case "no":
          return asc
            ? Number(a.hotelNo) - Number(b.hotelNo)
            : Number(b.hotelNo) - Number(a.hotelNo);
        case "pct":
          return asc
            ? a.percentage - b.percentage
            : b.percentage - a.percentage;
        case "status":
          return asc
            ? String(a.status).localeCompare(String(b.status))
            : String(b.status).localeCompare(String(a.status));
        case "name":
          return asc
            ? String(a.hotelName).localeCompare(String(b.hotelName))
            : String(b.hotelName).localeCompare(String(a.hotelName));
        case "links":
          return asc
            ? (a.matchedLinks?.length || 0) - (b.matchedLinks?.length || 0)
            : (b.matchedLinks?.length || 0) - (a.matchedLinks?.length || 0);
        default:
          return 0;
      }
    });
    window.currentResults = results;
    currentPage = 1;
    renderResultsPage();
    updatePaginationControls();
    updateSortIcons();
  }

  // Đổi icon sort cho từng cột
  function updateSortIcons() {
    const icons = {
      order: document.getElementById("orderSortIcon"),
      no: document.getElementById("noSortIcon"),
      pct: document.getElementById("pctSortIcon"),
      status: document.getElementById("statusSortIcon"),
      name: document.getElementById("nameSortIcon"),
      links: document.getElementById("linksSortIcon"),
    };
    Object.entries(icons).forEach(([col, el]) => {
      if (!el) return;
      el.textContent =
        currentSort === col
          ? {
              order: orderSortAsc,
              no: noSortAsc,
              pct: pctSortAsc,
              status: statusSortAsc,
              name: nameSortAsc,
              links: linksSortAsc,
            }[col]
            ? "▲"
            : "▼"
          : "▲";
    });
  }

  // Gán sự kiện cho icon sort các cột
  try {
    document
      .getElementById("orderSortIcon")
      ?.addEventListener("click", () => sortTable("order", true));
    document
      .getElementById("noSortIcon")
      ?.addEventListener("click", () => sortTable("no", true));
    document
      .getElementById("pctSortIcon")
      ?.addEventListener("click", () => sortTable("pct", true));
    document
      .getElementById("statusSortIcon")
      ?.addEventListener("click", () => sortTable("status", true));
    document
      .getElementById("nameSortIcon")
      ?.addEventListener("click", () => sortTable("name", true));
    document
      .getElementById("linksSortIcon")
      ?.addEventListener("click", () => sortTable("links", true));
    updateSortIcons();
  } catch (e) {}

  // Biến lưu trạng thái sort hiện tại cho cột Order

  // Sort Order column (tăng/giảm)
  // function sortOrder(toggle = false) {
  //   if (toggle) orderSortAsc = !orderSortAsc;
  //   const results = window.currentResults || [];
  //   results.sort((a, b) =>
  //     orderSortAsc ? a.order - b.order : b.order - a.order
  //   );
  //   window.currentResults = results;
  //   currentPage = 1;
  //   renderResultsPage();
  //   updatePaginationControls();
  //   // Đổi icon
  //   const icon = document.getElementById("orderSortIcon");
  //   if (icon) icon.textContent = orderSortAsc ? "▲" : "▼";
  // }

  // // Gán sự kiện cho icon sort Order
  // try {
  //   const icon = document.getElementById("orderSortIcon");
  //   if (icon) icon.addEventListener("click", () => sortOrder(true));
  //   // Khởi tạo icon đúng trạng thái khi load
  //   icon.textContent = orderSortAsc ? "▲" : "▼";
  // } catch (e) {}
});

function updateCounter(counterEl, runCount, MAX_RUNS) {
  if (counterEl) {
    counterEl.textContent = `${runCount}/${MAX_RUNS} lượt tìm kiếm đã chạy`;
  }
}

// Thêm nút tải xuống CSV sau khi có dữ liệu
function setupDownloadButton(results) {
  const downloadButton = document.getElementById("downloadCSVButton");
  // ensure the button becomes visible (remove .hidden)
  if (downloadButton) downloadButton.classList.remove("hidden");
  downloadButton.onclick = () => downloadCSV(results); // Khi nhấn mới tải
}
// Hàm xuất ra file CSV
function downloadCSV(results, filename = "hotel_search_results.csv") {
  const maxMatchedLinks = Math.max(
    ...results.map((row) => (row.matchedLinks || []).length)
  );

  const header =
    "Order,No,Percentage,Type,Hotel Name,Hotel Address," +
    Array.from(
      { length: maxMatchedLinks },
      (_, i) => `Matched Link ${i + 1}`
    ).join(",") +
    "\n";

  const csvContent =
    header +
    results
      .map((row) => {
        const links = (row.matchedLinks || []).map(
          (linkObj) => `"${linkObj.url || linkObj}"`
        );
        while (links.length < maxMatchedLinks) {
          links.push('""');
        }
        return `"${row.order}","${row.hotelNo}","${row.percentage}",Child,"${
          row.hotelName
        }","${row.hotelAddress}",${links.join(",")}`;
      })
      .join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename || "hotel_search_results.csv";
  link.style.display = "none";

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// --- Live table helpers ---
function clearResultsTable() {
  const detailEls = getResultDetailElements();
  if (detailEls && !detailEls.modal.classList.contains("hidden")) {
    closeResultDetailModal();
  }
  const body = document.getElementById("resultsBody");
  if (body) body.innerHTML = "";
  if (lastFilterQueryRaw) {
    applyFilterToResults(lastFilterQueryRaw, {
      scrollToFirst: false,
      preserveSelection: true,
    });
  } else {
    updateResultsCountDisplay();
  }
}

function updateResultsCountDisplay() {
  if (lastFilterQueryRaw && lastFilterQueryRaw.trim() !== "") return;
  const body = document.getElementById("resultsBody");
  const resultsCountEl = document.getElementById("resultsCount");
  if (!body || !resultsCountEl) return;
  const total = Array.from(body.children).filter(
    (r) => !r.classList.contains("detail-row")
  ).length;
  resultsCountEl.textContent = String(total);
}

function escapeHtml(str) {
  if (!str && str !== 0) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function appendResultRow(row, options = {}) {
  const {
    prepend = false,
    skipFilterRefresh = false,
    preserveSelection = true,
    scrollToFirst = false,
  } = options;
  const body = document.getElementById("resultsBody");
  if (!body) return;

  const tr = document.createElement("tr");
  if (row && row.order != null) {
    tr.dataset.order = String(row.order);
  }
  const links = (row.matchedLinks || []).map((l) =>
    typeof l === "string" ? { url: l, percentage: 0 } : l
  );

  const linksHtml = links
    .map(
      (l) =>
        `<a class="link-chip" href="${escapeHtml(
          l.url
        )}" target="_blank">${escapeHtml(
          shortenUrl(l.url)
        )} <small style="margin-left:6px;color:#136">${Math.round(
          l.percentage || 0
        )}%</small></a>`
    )
    .join("");

  const pct = row.percentage || 0;
  const status = row.status || "No match";
  const matchedLinksCount = row.matchedLinks ? row.matchedLinks.length : 0;

  tr.innerHTML = `
    <td>${escapeHtml(row.order)}</td>
    <td>${escapeHtml(row.hotelNo)}</td>
    <td>${escapeHtml(pct)}</td>
    <td data-col="fuzzy" style="font-size:.6rem;color:var(--text-tertiary)">${
      row.fuzzy != null ? escapeHtml(row.fuzzy.toFixed(3)) : "-"
    }</td>
    <td><span style="padding:6px 8px;border-radius:8px;background:${
      status === "Matched" ? "#e6f7ef" : "#fff3f2"
    };color:${
    status === "Matched" ? "#0b7a53" : "#a33"
  };font-weight:600">${escapeHtml(status)}</span></td>
    <td class="copy-hotel" data-field="hotelName" title="${escapeHtml(
      row.hotelName
    )}">${escapeHtml(row.hotelName)}</td>
    <td class="copy-hotel" data-field="hotelAddress" title="${escapeHtml(
      row.hotelAddress
    )}">${escapeHtml(row.hotelAddress)}</td>
    <td class="matched-cell">${linksHtml}</td>
    <td>${matchedLinksCount}</td>
    <td>
      <button class="btn btn-sm btn-outline-custom" data-action="open-all">Mở tất cả</button>
    </td>
  `;

  // attach actions
  const openAllBtn = tr.querySelector('button[data-action="open-all"]');
  // determine available URLs for this row (strings), dedupe and trim
  const urlsRaw = links
    .map((l) => (typeof l === "string" ? l : l.url || ""))
    .filter(Boolean)
    .map((u) => String(u).trim());
  const uniqueUrls = Array.from(new Set(urlsRaw));
  // UI hints: hide/disable open-all when there are 0 or 1 links
  if (openAllBtn) {
    if (uniqueUrls.length <= 0) {
      openAllBtn.style.display = "none";
      openAllBtn.disabled = true;
      openAllBtn.setAttribute("aria-hidden", "true");
    } else {
      openAllBtn.style.display = "";
      openAllBtn.disabled = false;
      openAllBtn.title = `Mở tất cả ${uniqueUrls.length} liên kết`;
      openAllBtn.removeAttribute("aria-hidden");
    }
    openAllBtn.addEventListener("click", () => {
      openUrlsWithDelay(uniqueUrls);
    });
  }
  // Note: per-row inline "Sao chép" has been removed; per-link copy is available in the ⋯ menu

  const insertBeforeNode = prepend ? body.firstChild : null;
  body.insertBefore(tr, insertBeforeNode);

  // make row focusable and selectable for keyboard shortcuts
  tr.tabIndex = 0;
  tr.style.cursor = "pointer";
  tr.addEventListener("click", (evt) => {
    const prev = document.querySelector("tr.selected-row");
    if (prev && prev !== tr) prev.classList.remove("selected-row");
    tr.classList.add("selected-row");
    const interactiveTarget = evt.target.closest("button, a");
    const inCopyCell = evt.target.closest("td.copy-hotel");
    if (interactiveTarget || inCopyCell) return;
    if (typeof window.showResultDetail === "function") {
      window.showResultDetail(row?.order, { scroll: false });
    }
  });

  // add expandable detail row immediately after
  const detailTr = document.createElement("tr");
  detailTr.className = "detail-row";
  detailTr.style.display = "none";
  detailTr.dataset.open = "false";
  if (row && row.order != null)
    detailTr.dataset.parentOrder = String(row.order);
  detailTr.innerHTML = `<td colspan="8" style="background:#fbffff;padding:10px">${links
    .map(
      (l) =>
        `<div style="margin-bottom:6px"><a href="${escapeHtml(
          l.url
        )}" target="_blank">${escapeHtml(
          l.url
        )}</a> <small style="color:#888;margin-left:8px">${Math.round(
          l.percentage || 0
        )}%</small></div>`
    )
    .join("")}</td>`;
  body.insertBefore(detailTr, insertBeforeNode);

  // wire toggle to show/hide detail tr
  const toggleBtn = tr.querySelector('button[data-action="toggle"]');
  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      if (detailTr.style.display === "none") {
        detailTr.style.display = "";
        detailTr.dataset.open = "true";
        toggleBtn.textContent = "Ẩn";
      } else {
        detailTr.style.display = "none";
        detailTr.dataset.open = "false";
        toggleBtn.textContent = "Xem";
      }
    });
  }

  // per-row menu removed: individual link actions are not shown inline

  // refresh filter view or counts so streaming respects current query
  if (!skipFilterRefresh) {
    if (lastFilterQueryRaw) {
      applyFilterToResults(lastFilterQueryRaw, {
        preserveSelection,
        scrollToFirst,
      });
    } else {
      updateResultsCountDisplay();
    }
  }

  // keep filter input focused so keyboard shortcuts and typing work while results stream in
  try {
    const filterEl = document.getElementById("filterInput");
    if (filterEl) filterEl.focus();
  } catch (e) {}

  // Re-evaluate fuzzy cell color if fuzzy data present and feature toggled
  if (fuzzyEnabled && row.fuzzy != null) {
    const cell = tr.querySelector('[data-col="fuzzy"]');
    if (cell) {
      const val = Number(row.fuzzy) || 0;
      cell.innerHTML = `<span class="badge" style="background:${
        val >= fuzzyThreshold
          ? "rgba(46,204,113,0.18)"
          : "rgba(255,255,255,0.08)"
      };color:${
        val >= fuzzyThreshold ? "#27ae60" : "var(--text-tertiary)"
      }">${val.toFixed(3)}</span>`;
    }
  }

  // add click-to-copy on hotel name and address cells separately
  (function addCopyOnClickSeparate() {
    const cells = tr.querySelectorAll("td.copy-hotel");
    const nameCell = cells[0];
    const addressCell = cells[1];

    const copyText = async (text, cell) => {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          const ta = document.createElement("textarea");
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
        }
        // visual feedback: flash background on the clicked cell
        if (cell) {
          const orig = cell.style.backgroundColor || "";
          cell.style.transition = "background-color 180ms ease";
          cell.style.backgroundColor = "#fff8d6";
          setTimeout(() => (cell.style.backgroundColor = orig), 700);
        }
      } catch (e) {
        console.error("Copy failed", e);
      }
    };

    if (nameCell)
      nameCell.addEventListener("click", () =>
        copyText(row.hotelName || "", nameCell)
      );
    if (addressCell)
      addressCell.addEventListener("click", () =>
        copyText(row.hotelAddress || "", addressCell)
      );

    // New: double-click either cell to copy both Hotel Name and Hotel Address
    const copyBoth = async () => {
      const text = `${row.hotelName || ""} - ${row.hotelAddress || ""}`.trim();
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          const ta = document.createElement("textarea");
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
        }
        // flash both cells for feedback
        const flash = (cell) => {
          if (!cell) return;
          const orig = cell.style.backgroundColor || "";
          cell.style.transition = "background-color 180ms ease";
          cell.style.backgroundColor = "#dff0d8";
          setTimeout(() => (cell.style.backgroundColor = orig), 700);
        };
        flash(nameCell);
        flash(addressCell);
      } catch (e) {
        console.error("Copy both failed", e);
      }
    };

    if (nameCell) nameCell.addEventListener("dblclick", copyBoth);
    if (addressCell) addressCell.addEventListener("dblclick", copyBoth);
  })();

  return { row: tr, detailRow: detailTr };
}

function applyFilterToResults(rawQuery, opts = {}) {
  const body = document.getElementById("resultsBody");
  const resultsCountEl = document.getElementById("resultsCount");
  lastFilterQueryRaw = rawQuery != null ? String(rawQuery) : "";
  if (!body) return;

  const query = lastFilterQueryRaw.trim().toLowerCase();
  const preserveSelection = !!opts.preserveSelection;
  const shouldScroll = opts.scrollToFirst !== false;
  const rows = Array.from(body.children);
  const currentlySelected = document.querySelector("tr.selected-row");
  const selectionStillVisible =
    preserveSelection &&
    currentlySelected &&
    body.contains(currentlySelected) &&
    currentlySelected.style.display !== "none";

  let visible = 0;
  let firstVisible = null;

  for (let i = 0; i < rows.length; i++) {
    const tr = rows[i];
    if (!tr || tr.nodeType !== 1) continue;

    if (tr.classList.contains("detail-row")) {
      // detail rows mirror their parent row's visibility
      continue;
    }

    const detailRow = rows[i + 1];
    const nameTd = tr.querySelector('td[data-field="hotelName"]');
    const addressTd = tr.querySelector('td[data-field="hotelAddress"]');
    const name = nameTd ? nameTd.textContent.trim().toLowerCase() : "";
    const address = addressTd ? addressTd.textContent.trim().toLowerCase() : "";
    const match = !query || name.includes(query) || address.includes(query);

    if (match) {
      tr.style.display = "";
      if (detailRow && detailRow.classList.contains("detail-row")) {
        detailRow.style.display =
          detailRow.dataset.open === "true" ? "" : "none";
      }
      if (!firstVisible) firstVisible = tr;
      visible++;
    } else {
      tr.style.display = "none";
      if (detailRow && detailRow.classList.contains("detail-row")) {
        detailRow.style.display = "none";
      }
      if (tr.classList.contains("selected-row")) {
        tr.classList.remove("selected-row");
      }
    }
  }

  if (query) {
    if (resultsCountEl) resultsCountEl.textContent = String(visible);
  } else {
    updateResultsCountDisplay();
  }

  if (!firstVisible) {
    if (!query && currentlySelected) {
      currentlySelected.classList.remove("selected-row");
    }
    return;
  }

  if (selectionStillVisible) {
    return;
  }

  if (currentlySelected && currentlySelected !== firstVisible) {
    currentlySelected.classList.remove("selected-row");
  }

  firstVisible.classList.add("selected-row");
  if (shouldScroll) {
    try {
      firstVisible.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (e) {}
  }
}

function shortenUrl(url) {
  try {
    const u = new URL(url);
    return (
      u.hostname.replace("www.", "") +
      u.pathname.slice(0, 20) +
      (u.pathname.length > 20 ? "..." : "")
    );
  } catch (e) {
    return url.slice(0, 30) + (url.length > 30 ? "..." : "");
  }
}

// Filter input handling
const filterInput = document.getElementById("filterInput");
if (filterInput) {
  filterInput.addEventListener("input", (e) => {
    applyFilterToResults(e.target.value || "", {
      preserveSelection: false,
    });
  });
  if (filterInput.value) {
    applyFilterToResults(filterInput.value, {
      preserveSelection: false,
      scrollToFirst: false,
    });
  }
}

// Hàm kiểm tra tên khách sạn có nằm trong tiêu đề trang hay không
function isHotelNameInPage(
  hotelNameArray,
  pageTitle,
  pageUrl = "",
  pageContent = "",
  apiScore = 0
) {
  // Title-only scoring: percentage = (number of title tokens matched) / total tokens * 100
  const tokens = (hotelNameArray || [])
    .filter(Boolean)
    .map((t) => normalizeToken(t))
    .filter(Boolean);
  if (tokens.length === 0) return { status: false, percentage: 0 };
  let tokenMatches = 0;
  for (const t of tokens) {
    if (pageTitle.includes(t)) tokenMatches++;
  }
  let percentage = Math.round((tokenMatches / tokens.length) * 100);
  if (percentage > 100) percentage = 100;
  const status = percentage >= 30; // vẫn giữ ngưỡng 30
  return { status, percentage };
}

function normalizeToken(s) {
  if (!s) return "";
  // remove diacritics
  const t = s.normalize ? s.normalize("NFD").replace(/\p{Diacritic}/gu, "") : s;
  return String(t)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gi, "")
    .trim();
}

// Legacy multi-page navigation removed as layout now uses tabs only.

// Global keyboard shortcuts
document.addEventListener("keydown", (e) => {
  const detailEls = resultDetailState.elements;
  const modalOpen =
    detailEls &&
    detailEls.modal &&
    !detailEls.modal.classList.contains("hidden");
  if (modalOpen) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeResultDetailModal();
      return;
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      navigateResultDetail(1);
      return;
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      navigateResultDetail(-1);
      return;
    }
  }
  // Alt+S: focus the filter input (#filterInput). If missing, fallback to starting the search.
  if (e.altKey && (e.key === "s" || e.key === "S")) {
    const filterEl = document.getElementById("filterInput");
    if (filterEl) {
      e.preventDefault();
      filterEl.focus();
      if (typeof filterEl.select === "function") filterEl.select();
    } else {
      const searchBtn = document.getElementById("searchButton");
      if (searchBtn && !searchBtn.disabled) {
        e.preventDefault();
        searchBtn.click();
      }
    }
  }
  // Alt+O to open-all for selected row
  if (e.altKey && (e.key === "a" || e.key === "A")) {
    const sel = document.querySelector("tr.selected-row");
    if (sel) {
      const openAll = sel.querySelector('button[data-action="open-all"]');
      if (openAll && openAll.style.display !== "none" && !openAll.disabled) {
        e.preventDefault();
        openAll.click();
      }
    }
  }
});

// Fuzzy UI bindings outside DOMContentLoaded because inputs exist already (after script load they may not yet); ensure after load
window.addEventListener("load", () => {
  const enableEl = document.getElementById("fuzzyEnable");
  const thrEl = document.getElementById("fuzzyThreshold");
  const infoBtn = document.getElementById("fuzzyInfoBtn");
  if (enableEl) {
    // load saved state
    try {
      const saved = JSON.parse(
        localStorage.getItem("tavily_fuzzy_cfg") || "null"
      );
      if (saved) {
        enableEl.checked = !!saved.enabled;
        if (thrEl && typeof saved.threshold === "number") {
          thrEl.value = saved.threshold.toFixed(2);
          fuzzyThreshold = saved.threshold;
        }
        fuzzyEnabled = !!saved.enabled;
      }
    } catch (e) {}
    enableEl.addEventListener("change", () => {
      fuzzyEnabled = enableEl.checked;
      persistFuzzyCfg();
    });
  }
  if (thrEl) {
    thrEl.addEventListener("input", () => {
      const v = parseFloat(thrEl.value);
      if (!isNaN(v) && v >= 0 && v <= 1) {
        fuzzyThreshold = v;
        persistFuzzyCfg();
        recolorFuzzyCells();
      }
    });
  }
  if (infoBtn) {
    infoBtn.addEventListener("click", () => {
      if (!window.Toasts && !Toasts) {
        alert(
          "Fuzzy = đo độ giống tên khách sạn (Levenshtein + Jaro-Winkler + Domain). Ngưỡng 0.80-0.85 thường tốt."
        );
        return;
      }
      const html = `<div style=\"text-align:left;line-height:1.45;font-size:.7rem;max-height:55vh;overflow:auto\">
  <strong>Fuzzy Score (Phiên bản Title-Only)</strong><br/>
  Đo mức độ giống giữa <em>Tên khách sạn trong file</em> và <em>Tiêu đề trang</em> của từng link tìm được.<br/><br/>
  <strong>1. Thành phần cơ bản</strong><br/>
  • <u>Levenshtein</u>: Số bước chỉnh ký tự tối thiểu để biến A→B. Ít bước = giống hơn.<br/>
  • <u>Jaro‑Winkler</u>: Ưu tiên ký tự trùng và phần đầu (prefix) giống nhau.<br/>
  • Hệ thống trộn 2 giá trị: <code>nameSim = (Levenshtein + JaroWinkler)/2</code> rồi dùng trực tiếp làm điểm (0..1) ở chế độ Title Only.<br/>
  • Domain / path hiện <em>không cộng vào</em> vì đang chạy Title Only (hostPathScore = 0).<br/><br/>
  <strong>2. Override (đẩy điểm lên 1.000)</strong><br/>
  Nếu thỏa bất kỳ điều kiện sau, điểm = 1.000 và thêm flag tương ứng:<br/>
  • <b>TITLE_PREFIX_MATCH</b>: Tiêu đề (sau khi bỏ “- Agoda”) trùng hoặc bắt đầu bằng tên khách sạn.<br/>
  • <b>TOKEN_SEQUENCE_MATCH</b>: Toàn bộ token tên khách sạn xuất hiện tuần tự trong tiêu đề (có thể xen thêm từ phụ).<br/>
  • <b>TOKEN_PERMUTATION_MATCH</b>: Tập token tên khách sạn (bỏ các từ chung: hotel, resort, the...) đều xuất hiện trong tiêu đề, thứ tự bất kỳ, cho phép dư token phụ.<br/><br/>
  <strong>3. Các cờ (Flags) khác</strong><br/>
  • OFFICIAL: Domain chứa ≥2 token mạnh từ tên (loại bỏ từ chung) → gợi ý trang chính thức.<br/>
  • AGGREGATOR: Thuộc site trung gian (booking, agoda...).<br/>
  • AGG_BONUS: Trang aggregator có path khớp tốt (áp dụng khi không ở title-only).<br/>
  • GEO_MISMATCH: Thiếu token địa lý quan trọng xuất hiện trong tên.<br/><br/>
  <strong>4. Màu và Ngưỡng</strong><br/>
  • Badge Xanh: ≥ ngưỡng bạn đặt (ví dụ 0.78).<br/>
  • Badge Xám: Dưới ngưỡng → kiểm tra thủ công nếu nghi ngờ.<br/>
  Gợi ý nhanh: 0.85–0.90 (rất chặt) · 0.78 (cân bằng) · 0.72–0.75 (nới, cần soát).<br/><br/>
  <strong>5. Chiến lược rà soát</strong><br/>
  1) Chạy với ngưỡng 0.78. 2) Lọc/nhìn các dòng 0.70–0.78: nếu đa số vẫn đúng → hạ 0.75; nếu nhiều sai → tăng 0.82–0.85. 3) Giữ cố định một ngưỡng cho các batch để so sánh nhất quán.<br/><br/>
  <strong>6. Ví dụ</strong><br/>
  • "Executive Helena Hotels # Haven" ↔ tiêu đề giống hệt (sau khi bỏ “- Booking.com”) → 1.000 (TITLE_PREFIX_MATCH).<br/>
  • "Imperial Hotel Da Nang" ↔ "Imperial Da Nang Hotel" → 1.000 (TOKEN_PERMUTATION_MATCH).<br/>
  • "Intercontinetal Danag" (sai chính tả) ↔ "InterContinental Danang Sun Peninsula" ≈ ~0.74 (vì lỗi ký tự + thêm token).<br/>
  • "Moonlight Boutique Saigon" ↔ "Moonlight Cruise Ha Long" ≈ ~0.5 (khác địa danh).<br/><br/>
  <strong>7. Khi nào điểm thấp?</strong><br/>
  • Sai chính tả nặng / thiếu nhiều token. • Tiêu đề chứa tên khác. • Địa danh không trùng. • Bị thêm brand dài làm lệch chuỗi (trước khi chuẩn hóa).<br/><br/>
  <em>Lưu ý:</em> Hệ thống hiện không tự động loại bỏ link điểm thấp – chỉ hỗ trợ highlight. Có thể bổ sung bộ lọc sau.<br/>
  <em>Tip:</em> Mở console (F12) để xem breakdown chi tiết mỗi dòng: lev, jw, flags.
  </div>`;
      Toasts.show(html, {
        title: "Hướng dẫn Fuzzy",
        type: "info",
        timeout: 0,
        html: true,
      });
    });
  }
  function persistFuzzyCfg() {
    try {
      localStorage.setItem(
        "tavily_fuzzy_cfg",
        JSON.stringify({ enabled: fuzzyEnabled, threshold: fuzzyThreshold })
      );
    } catch (e) {}
  }
  function recolorFuzzyCells() {
    if (!fuzzyEnabled) return;
    const rows = document.querySelectorAll("#resultsBody tr");
    rows.forEach((tr) => {
      const cell = tr.querySelector('[data-col="fuzzy"]');
      if (!cell) return;
      const valText = cell.textContent.trim();
      const v = parseFloat(valText);
      if (isNaN(v)) return;
      cell.innerHTML = `<span class=\"badge\" style=\"background:${
        v >= fuzzyThreshold ? "rgba(46,204,113,0.18)" : "rgba(255,255,255,0.08)"
      };color:${
        v >= fuzzyThreshold ? "#27ae60" : "var(--text-tertiary)"
      }\">${v.toFixed(3)}</span>`;
    });
  }



});

function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}
