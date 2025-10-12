import axios from "https://cdn.jsdelivr.net/npm/axios@1.6.8/dist/esm/axios.min.js";

// Đảm bảo rằng script chỉ chạy khi DOM đã tải xong
document.addEventListener("DOMContentLoaded", function () {
  // keep runCount but allow resume sessions
  // localStorage.removeItem("runCount");
  let MAX_RUNS = 0;
  let isPaused = false;
  let isProcessingRow = false;
  let shouldStop = false;
  let runCount = parseInt(localStorage.getItem("runCount") || "0");
  // Pagination settings
  const PAGE_SIZES = [50, 100, 200];
  let pageSize = parseInt(localStorage.getItem("tavily_pageSize") || "25");
  if (!PAGE_SIZES.includes(pageSize)) pageSize = 25;
  let currentPage = 1; // 1-based
  const counterEl = document.getElementById("counter");
  const resultsSection = document.getElementById("resultsSection");
  function showResultsSection() {
    if (resultsSection) resultsSection.style.display = "";
  }
  function hideResultsSection() {
    if (resultsSection) resultsSection.style.display = "none";
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

  document
    .getElementById("searchButton")
    .addEventListener("click", async () => {
      const searchBtn = document.getElementById("searchButton");
      const spinnerEl = document.getElementById("spinner");
      const downloadBtn = document.getElementById("downloadCSVButton");
      const clearBtn = document.getElementById("clearResultsButton");
      const pauseBtn = document.getElementById("pauseResumeButton");
      const progressContainer = document.getElementById("progressContainer");
      const progressBar = document.getElementById("progressBar");
      const progressText = document.getElementById("progressText");
      // Disable button and show spinner
      if (searchBtn) searchBtn.disabled = true;
      if (spinnerEl) spinnerEl.style.display = "flex";
      const fileInput = document.getElementById("fileInput");
      if (!fileInput || fileInput.files.length === 0) {
        alert("Vui lòng chọn một file Excel!");
        if (searchBtn) searchBtn.disabled = false;
        if (spinnerEl) spinnerEl.style.display = "none";
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
              (window.currentResults || []).forEach((r) => appendResultRow(r));
              // restore runCount from saved results length
              runCount =
                saved.results && saved.results.length
                  ? saved.results.length
                  : runCount;
              updateCounter(counterEl, runCount, jsonData.length);
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

  function renderResultsPage() {
    const body = document.getElementById("resultsBody");
    if (!body) return;
    body.innerHTML = "";
    const results = window.currentResults || [];
    const start = (currentPage - 1) * pageSize;
    const pageRows = results.slice(start, start + pageSize);
    for (const r of pageRows) {
      // reuse appendResultRow but it appends directly; instead create a temporary container
      appendResultRow(r);
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
    const progressContainer = document.getElementById("progressContainer");
    const progressBar = document.getElementById("progressBar");
    const progressText = document.getElementById("progressText");

    const results =
      window.currentResults && window.currentResults.length
        ? window.currentResults
        : [];
    // Ensure pause button is visible when a run starts
    const pauseBtnEl = document.getElementById("pauseResumeButton");
    if (pauseBtnEl) {
      pauseBtnEl.style.display = "inline-block";
      pauseBtnEl.textContent = "Tạm dừng";
    }
    let order = results.length ? results[results.length - 1].order + 1 : 1;
    let currentIndex = results.length || 0;
    MAX_RUNS = jsonData.length;
    updateCounter(counterEl, runCount, MAX_RUNS);
    // If starting fresh, clear table
    if (startIndex === 0) clearResultsTable();

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
            ({ percentage, matchedLink }) => ({ url: matchedLink, percentage })
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
          ? matchedLink.map((m) => ({ url: m.url, percentage: m.percentage }))
          : [],
        percentage: Math.round(maxPct),
        status: statusLabel,
      });
      window.currentResults = results;
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
      // Append to DOM only if the new row is within the current page range
      const newIndex = results.length - 1; // 0-based in results
      const start = (currentPage - 1) * pageSize;
      const end = start + pageSize - 1;
      if (newIndex >= start && newIndex <= end) {
        appendResultRow(results[results.length - 1]);
      }
      currentIndex++;
      const pct = Math.round((currentIndex / MAX_RUNS) * 100);
      if (progressBar) progressBar.style.width = pct + "%";
      if (progressText)
        progressText.textContent = `${pct}% (${currentIndex}/${MAX_RUNS})`;
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
      if (clearBtn) {
        clearBtn.style.display = "inline-block";
        clearBtn.onclick = () => {
          // show modal
          const modal = document.getElementById("confirmModal");
          const input = document.getElementById("confirmInput");
          const ok = document.getElementById("confirmOk");
          const cancel = document.getElementById("confirmCancel");
          if (!modal || !input || !ok || !cancel) return;
          input.value = "";
          modal.style.display = "flex";
          input.focus();
          const cleanup = () => {
            modal.style.display = "none";
            ok.onclick = null;
            cancel.onclick = null;
          };
          cancel.onclick = () => {
            cleanup();
          };
          ok.onclick = () => {
            if (input.value === "Đồng Ý Xóa") {
              clearResultsTable();
              window.currentResults = [];
              hideResultsSection();
              clearBtn.style.display = "none";
              downloadBtn.style.display = "none";
              try {
                localStorage.removeItem("tavily_session");
                localStorage.removeItem("runCount");
                runCount = 0;
                updateCounter(counterEl, 0, 0);
                const resumeBtn = document.getElementById(
                  "resumeSessionButton"
                );
                if (resumeBtn) resumeBtn.style.display = "none";
              } catch (e) {}
              cleanup();
            } else {
              alert(
                'Xóa đã bị hủy. Bạn phải gõ đúng "Đồng Ý Xóa" để xác nhận.'
              );
              input.focus();
            }
          };
        };
      }
    } else {
      alert("Không tìm thấy kết quả nào khớp với tên khách sạn.");
    }

    if (searchBtn) searchBtn.disabled = false;
    if (spinnerEl) spinnerEl.style.display = "none";
    if (pauseBtn) pauseBtn.style.display = "none";
    if (progressContainer) progressContainer.style.display = "none";
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
          if (downloadBtnEl) downloadBtnEl.style.display = "inline-block";
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
                downloadBtnEl.style.display = "inline-block";
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
  // Auto-resume if a saved session with allRows exists
  try {
    const saved = JSON.parse(localStorage.getItem("tavily_session") || "null");
    if (
      saved &&
      Array.isArray(saved.allRows) &&
      typeof saved.nextIndex === "number" &&
      saved.nextIndex > 0
    ) {
      // restore previous results into window and table
      window.currentResults = saved.results || [];
      clearResultsTable();
      (window.currentResults || []).forEach((r) => appendResultRow(r));
      runCount =
        saved.results && saved.results.length ? saved.results.length : runCount;
      MAX_RUNS = saved.maxRuns || (saved.allRows && saved.allRows.length) || 0;
      updateCounter(counterEl, runCount, MAX_RUNS);

      // prepare UI for running
      const searchBtn = document.getElementById("searchButton");
      const spinnerEl = document.getElementById("spinner");
      const pauseBtn = document.getElementById("pauseResumeButton");
      if (searchBtn) searchBtn.disabled = true;
      if (spinnerEl) spinnerEl.style.display = "flex";
      if (pauseBtn) {
        pauseBtn.style.display = "inline-block";
        pauseBtn.textContent = "Tạm dừng";
      }

      // start processing automatically from saved.nextIndex
      (async () => {
        try {
          await processRows(saved.allRows, saved.nextIndex);
        } catch (e) {
          console.error("Auto-resume failed", e);
        }
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
        changePageSize(parseInt(e.target.value || "25"))
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
});

function updateCounter(counterEl, runCount, MAX_RUNS) {
  if (counterEl) {
    counterEl.textContent = `${runCount}/${MAX_RUNS} lượt tìm kiếm đã chạy`;
  }
}

// Thêm nút tải xuống CSV sau khi có dữ liệu
function setupDownloadButton(results) {
  const downloadButton = document.getElementById("downloadCSVButton");
  downloadButton.style.display = "block"; // Hiển thị nút
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
  const body = document.getElementById("resultsBody");
  if (body) body.innerHTML = "";
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

function appendResultRow(row) {
  const body = document.getElementById("resultsBody");
  if (!body) return;

  const tr = document.createElement("tr");
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

  tr.innerHTML = `
    <td>${escapeHtml(row.order)}</td>
    <td>${escapeHtml(row.hotelNo)}</td>
    <td>${escapeHtml(pct)}</td>
    <td><span style="padding:6px 8px;border-radius:8px;background:${
      status === "Matched" ? "#e6f7ef" : "#fff3f2"
    };color:${
    status === "Matched" ? "#0b7a53" : "#a33"
  };font-weight:600">${escapeHtml(status)}</span></td>
    <td class="copy-hotel" title="${escapeHtml(row.hotelName)}">${escapeHtml(
    row.hotelName
  )}</td>
    <td class="copy-hotel" title="${escapeHtml(row.hotelAddress)}">${escapeHtml(
    row.hotelAddress
  )}</td>
    <td class="matched-cell">${linksHtml}</td>
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
    if (uniqueUrls.length <= 1) {
      openAllBtn.style.display = "none";
      openAllBtn.disabled = true;
      openAllBtn.setAttribute("aria-hidden", "true");
    } else {
      openAllBtn.style.display = "";
      openAllBtn.disabled = false;
      openAllBtn.title = `Mở tất cả ${uniqueUrls.length} liên kết`;
      openAllBtn.removeAttribute("aria-hidden");
    }
    // Open all links: staggered to reduce popup blocking
    openAllBtn.addEventListener("click", () => {
      if (!uniqueUrls.length) return;
      const delay = 180; // ms between opens
      uniqueUrls.forEach((u, i) => {
        try {
          setTimeout(() => window.open(u, "_blank"), i * delay);
        } catch (e) {
          console.error("Open all failed for", u, e);
        }
      });
    });
  }
  // Note: per-row inline "Sao chép" has been removed; per-link copy is available in the ⋯ menu

  body.appendChild(tr);

  // make row focusable and selectable for keyboard shortcuts
  tr.tabIndex = 0;
  tr.style.cursor = "pointer";
  tr.addEventListener("click", () => {
    // remove previous selection
    const prev = document.querySelector("tr.selected-row");
    if (prev && prev !== tr) prev.classList.remove("selected-row");
    tr.classList.add("selected-row");
  });

  // add expandable detail row immediately after
  const detailTr = document.createElement("tr");
  detailTr.className = "detail-row";
  detailTr.style.display = "none";
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
  body.appendChild(detailTr);

  // wire toggle to show/hide detail tr
  const toggleBtn = tr.querySelector('button[data-action="toggle"]');
  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      if (detailTr.style.display === "none") {
        detailTr.style.display = "";
        toggleBtn.textContent = "Ẩn";
      } else {
        detailTr.style.display = "none";
        toggleBtn.textContent = "Xem";
      }
    });
  }

  // per-row menu removed: individual link actions are not shown inline

  // update results count (count only main rows)
  const resultsCountEl = document.getElementById("resultsCount");
  if (resultsCountEl)
    resultsCountEl.textContent = Array.from(body.children).filter(
      (r) => !r.classList.contains("detail-row")
    ).length;

  // keep filter input focused so keyboard shortcuts and typing work while results stream in
  try {
    const filterEl = document.getElementById("filterInput");
    if (filterEl) filterEl.focus();
  } catch (e) {}

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
    const q = e.target.value.trim().toLowerCase();
    const body = document.getElementById("resultsBody");
    if (!body) return;
    let visible = 0;
    const rows = Array.from(body.children);
    for (let i = 0; i < rows.length; i++) {
      const tr = rows[i];
      // skip detail rows
      if (tr.classList && tr.classList.contains("detail-row")) {
        tr.style.display = "none";
        continue;
      }
      const nameTd = tr.children[4];
      const name = nameTd ? nameTd.textContent.trim().toLowerCase() : "";
      if (!q || name.includes(q)) {
        tr.style.display = ""; // show detail row as well
        const next = rows[i + 1];
        if (next && next.classList && next.classList.contains("detail-row")) {
          next.style.display = "";
        }
        // if this is the first visible match, select it and scroll into view
        if (visible === 0) {
          // remove previous selection
          const prev = document.querySelector("tr.selected-row");
          if (prev) prev.classList.remove("selected-row");
          tr.classList.add("selected-row");
          try {
            tr.scrollIntoView({ behavior: "smooth", block: "center" });
          } catch (e) {}
        }
        visible++;
      } else {
        tr.style.display = "none";
        const next = rows[i + 1];
        if (next && next.classList && next.classList.contains("detail-row"))
          next.style.display = "none";
        // if this row was selected previously, remove selection
        if (tr.classList && tr.classList.contains("selected-row"))
          tr.classList.remove("selected-row");
      }
    }
    const resultsCountEl = document.getElementById("resultsCount");
    if (resultsCountEl) resultsCountEl.textContent = visible;
  });
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

// Cấu hình các trang và các nút liên quan
const pages = {
  SEARCHTAVILY: ["SEARCHGO"],
};

// Hàm thay đổi nội dung và hiển thị nút
function switchPage(page) {
  // Cập nhật tiêu đề trang
  document.querySelector("h1").textContent = `Chức năng ${page}`;

  // Ẩn tất cả các trang
  document.querySelectorAll(".page").forEach((p) => (p.style.display = "none"));

  // Hiển thị trang hiện tại
  document.getElementById(`page${page}`).style.display = "block";

  // Cập nhật các nút chức năng
  const buttonContainer = document.querySelector(".button-container");
  buttonContainer.innerHTML = ""; // Xóa các nút hiện tại
  pages[page].forEach((p) => {
    const a = document.createElement("a");
    a.href = p;
    const button = document.createElement("button");
    button.textContent = `Chức năng ${p}`;
    button.onclick = () => switchPage(p);
    a.appendChild(button);
    buttonContainer.appendChild(a);
  });
}

// Khởi tạo mặc định là trang A
switchPage("SEARCHTAVILY");

// Global keyboard shortcuts
document.addEventListener("keydown", (e) => {
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
  if (e.altKey && (e.key === "o" || e.key === "O")) {
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
