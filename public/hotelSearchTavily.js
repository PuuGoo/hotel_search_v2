import axios from "https://cdn.jsdelivr.net/npm/axios@1.6.8/dist/esm/axios.min.js";

// Đảm bảo rằng script chỉ chạy khi DOM đã tải xong
document.addEventListener("DOMContentLoaded", function () {
  localStorage.removeItem("runCount");
  let MAX_RUNS = 0;
  let isPaused = false;
  let isProcessingRow = false;
  let shouldStop = false;
  let runCount = parseInt(localStorage.getItem("runCount") || "0");
  const counterEl = document.getElementById("counter");
  // Cập nhật giao diện ban đầu
  updateCounter(counterEl, runCount, MAX_RUNS);

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
      if (pauseBtn) {
        pauseBtn.style.display = "inline-block";
        pauseBtn.textContent = "Tạm dừng";
      }
      if (progressContainer) progressContainer.style.display = "block";
      const fileInput = document.getElementById("fileInput");
      if (fileInput.files.length === 0) {
        alert("Vui lòng chọn một file Excel!");
        return;
      }

      const file = fileInput.files[0];
      const reader = new FileReader();

      // const subscriptionKey = document.getElementById("subscriptionKey").value;
      // const subscriptionKey = document.getElementById("subscriptionKey").value;

      // Cập nhật endpoint cho Brave Search API
      // const endpoint = "http://127.0.0.1:8080/search";
      // const endpoint = "https://searxng-production-3523.up.railway.app/search";
      const endpoint = "/api/search";

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
        const results = [];
        let order = 1;
        let currentIndex = 0;
        MAX_RUNS = jsonData.length;
        updateCounter(counterEl, runCount, MAX_RUNS);
        // Clear any previous live results
        clearResultsTable();
        for (let rowIndex = 0; rowIndex < jsonData.length; rowIndex++) {
          // Respect pause flag
          while (isPaused) {
            await new Promise((r) => setTimeout(r, 200));
          }
          if (shouldStop) break;
          const row = jsonData[rowIndex];
          // mark processing start for this iteration
          isProcessingRow = true;
          // await new Promise((resolve) => setTimeout(resolve, 10000)); // Delay 15s mỗi lần
          let [hotelNo, hotelName, hotelAddress, hotelUrlType] = row;
          if (!hotelName || !hotelAddress) {
            isProcessingRow = false;
            continue;
          }

          hotelName = hotelName.replace(/[^\x00-\x7F]/g, "");
          const hotelNameArray = hotelName
            .split(" ")
            .map((part) =>
              part
                .replace(",", "")
                .replace("(", "")
                .replace(")", "")
                .toLowerCase()
            );
          let query = "";
          if (hotelUrlType == "CTrip SuperAgg") {
            query = `${hotelName} ${hotelAddress} trip`; // Điều kiện tìm kiếm
          } else {
            query = `${hotelName} ${hotelAddress}`; // Điều kiện tìm kiếm
          }
          console.log(query);

          let searchURL;

          if (window.location.hostname === "localhost") {
            searchURL = `http://localhost:3000/searchApiTavily?q=${encodeURIComponent(
              query
            )}`;
          } else {
            searchURL = `/searchApiTavily?q=${encodeURIComponent(query)}`;
          }

          let matchedLink = [];

          try {
            // Thay thế axios bằng fetch và sử dụng Brave API
            const response = await axios.get(searchURL);

            const data = response.data;
            console.log(data);

            // Nếu không có lỗi và có data: (runCount will be updated after we push the result to ensure UI/download consistency)

            // Lấy kết quả từ Brave Search API
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
                (max, item) => {
                  return item.percentage > max.percentage ? item : max;
                },
                { percentage: -Infinity }
              );

              // resultsFromBingArray = resultsFromBingArray
              //   .filter(
              //     (row) =>
              //       row.percentage == maxPercentageResult.percentage &&
              //       !row.matchedLink.includes("tripadvisor")
              //   )
              //   .sort((a, b) => {
              //     if (
              //       a.matchedLink.includes("agoda") &&
              //       !b.matchedLink.includes("agoda")
              //     )
              //       return -1; // Ưu tiên link a
              //     if (
              //       !a.matchedLink.includes("agoda") &&
              //       b.matchedLink.includes("agoda")
              //     )
              //       return 1; // Ưu tiên link b
              //     return 0; // Giữ nguyên thứ tự link
              //   });

              resultsFromBraveArray = resultsFromBraveArray
                .filter(
                  (row) =>
                    row.percentage == maxPercentageResult.percentage &&
                    !row.matchedLink.includes("tripadvisor") &&
                    !row.matchedLink.includes("makemytrip")
                )
                .sort((a, b) => {
                  const getPriority = (link) => {
                    if (link.includes("trip")) return 1; // Trip ưu tiên thứ 3
                    if (link.includes("agoda")) return 2; // Agoda ưu tiên cao nhất
                    if (link.includes("booking")) return 3; // Booking ưu tiên thứ 2
                    if (link.includes("hotels")) return 4; // Hotels ưu tiên thứ 3
                    if (link.includes("hotel")) return 5; // Hotel ưu tiên thứ 3
                    if (link.includes("trivago")) return 6; // Trivago ưu tiên thứ 3
                    if (link.includes("expedia")) return 7; // Expedia ưu tiên thứ 3
                    if (link.includes("zenhotels")) return 8; // Expedia ưu tiên thứ 3
                    if (link.includes("skyscanner")) return 9; // Expedia ưu tiên thứ 3
                    if (link.includes("airpaz")) return 10; // Expedia ưu tiên thứ 3
                    if (link.includes("readytotrip")) return 11; // Expedia ưu tiên thứ 3
                    if (link.includes("lodging-world")) return 12; // Expedia ưu tiên thứ 3
                    if (link.includes("yatra")) return 13; // Expedia ưu tiên thứ 3
                    if (link.includes("rentbyowner")) return 14; // Expedia ưu tiên thứ 3
                    if (link.includes("goibibo")) return 15; // Expedia ưu tiên thứ 3
                    if (link.includes("laterooms")) return 16; // Expedia ưu tiên thứ 3
                    if (link.includes("tiket")) return 17; // Expedia ưu tiên thứ 3
                    return 18; // Các trang khác ưu tiên thấp hơn
                  };

                  return (
                    getPriority(a.matchedLink) - getPriority(b.matchedLink)
                  );
                });

              // keep matched links along with their percentages
              matchedLink = resultsFromBraveArray.map(
                ({ percentage, matchedLink }) => ({
                  url: matchedLink,
                  percentage,
                })
              );
            }
          } catch (error) {
            console.log("Lỗi khi tìm kiếm:", error);
          }

          // compute percentage for UI convenience: max percentage among matched links
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
                }))
              : [],
            percentage: Math.round(maxPct),
            status: statusLabel,
          });
          // keep a live copy on window so pause handler can download partial results
          window.currentResults = results;
          // Now update runCount so displayed count matches number of pushed results
          runCount++;
          localStorage.setItem("runCount", runCount);
          updateCounter(counterEl, runCount, MAX_RUNS);
          // Append to live table immediately
          appendResultRow(results[results.length - 1]);
          currentIndex++;
          // update progress
          const pct = Math.round((currentIndex / MAX_RUNS) * 100);
          if (progressBar) progressBar.style.width = pct + "%";
          if (progressText)
            progressText.textContent = `${pct}% (${currentIndex}/${MAX_RUNS})`;
          console.log("Dong thu:", currentIndex, "hoan thanh.");
          // mark processing finished for this iteration
          isProcessingRow = false;
        }

        if (results.length > 0) {
          // store on window for download/inspection
          window.currentResults = results;
          setupDownloadButton(results); // Hiển thị nút tải khi có kết quả
          if (clearBtn) {
            clearBtn.style.display = "inline-block";
            clearBtn.onclick = () => {
              clearResultsTable();
              window.currentResults = [];
              clearBtn.style.display = "none";
              downloadBtn.style.display = "none";
            };
          }
        } else {
          alert("Không tìm thấy kết quả nào khớp với tên khách sạn.");
        }

        // Re-enable button and hide spinner
        if (searchBtn) searchBtn.disabled = false;
        if (spinnerEl) spinnerEl.style.display = "none";
        if (pauseBtn) pauseBtn.style.display = "none";
        if (progressContainer) progressContainer.style.display = "none";
      };

      reader.readAsArrayBuffer(file);
    });

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
          // prepare filename containing timestamp and current count
          const now = new Date();
          const ts = now.toISOString().replace(/[:\.]/g, "-");
          const count = (window.currentResults || []).length || 0;
          const filename = `hotel_search_partial_${count}_${ts}.csv`;
          try {
            const resultsToSave = window.currentResults || [];
            if (resultsToSave.length > 0) {
              downloadCSV(resultsToSave, filename);
            }
          } catch (e) {
            console.error("Lỗi khi tải partial CSV:", e);
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
    <td title="${escapeHtml(row.hotelName)}">${escapeHtml(row.hotelName)}</td>
    <td title="${escapeHtml(row.hotelAddress)}">${escapeHtml(
    row.hotelAddress
  )}</td>
    <td class="matched-cell">${linksHtml}</td>
    <td>
      <button class="btn btn-sm btn-outline-custom" data-action="open">Mở</button>
      <button class="btn btn-sm btn-outline-custom" data-action="copy" style="margin-left:6px">Sao chép</button>
      <button class="btn btn-sm btn-outline-custom" data-action="toggle" style="margin-left:6px">Xem</button>
    </td>
  `;

  // attach actions
  const openBtn = tr.querySelector('button[data-action="open"]');
  const copyBtn = tr.querySelector('button[data-action="copy"]');
  // Open first link only to avoid popup blockers
  openBtn &&
    openBtn.addEventListener("click", () => {
      const first = links[0];
      const url = first
        ? typeof first === "string"
          ? first
          : first.url || ""
        : "";
      if (url) window.open(url, "_blank");
    });
  // Copy all links (each on new line)
  copyBtn &&
    copyBtn.addEventListener("click", () => {
      const all = links
        .map((l) => (typeof l === "string" ? l : l.url || ""))
        .filter(Boolean)
        .join("\n");
      if (all) {
        navigator.clipboard && navigator.clipboard.writeText(all);
      }
    });

  body.appendChild(tr);

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

  // create per-row menu for individual link actions (open/copy)
  (function createPerRowMenu() {
    const actionsCell = tr.querySelector("td:last-child");
    if (!actionsCell) return;
    actionsCell.style.position = "relative";
    const menuBtn = document.createElement("button");
    menuBtn.className = "btn btn-sm btn-outline-custom";
    menuBtn.textContent = "⋯";
    menuBtn.style.marginLeft = "6px";
    actionsCell.appendChild(menuBtn);

    const menu = document.createElement("div");
    menu.style.position = "absolute";
    menu.style.right = "0";
    menu.style.top = "calc(100% + 6px)";
    menu.style.background = "#fff";
    menu.style.border = "1px solid rgba(0,0,0,0.08)";
    menu.style.boxShadow = "0 6px 18px rgba(0,0,0,0.08)";
    menu.style.padding = "8px";
    menu.style.borderRadius = "8px";
    menu.style.display = "none";
    menu.style.zIndex = 9999;
    menu.style.minWidth = "260px";

    links.forEach((l, idx) => {
      const url = typeof l === "string" ? l : l.url || "";
      const pct = Math.round(l.percentage || 0);
      const rowDiv = document.createElement("div");
      rowDiv.style.display = "flex";
      rowDiv.style.justifyContent = "space-between";
      rowDiv.style.alignItems = "center";
      rowDiv.style.marginBottom = "6px";

      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.textContent = shortenUrl(url);
      a.style.color = "#036";
      a.style.marginRight = "8px";
      a.style.flex = "1";

      const rightGroup = document.createElement("div");
      rightGroup.style.display = "flex";

      const openSingle = document.createElement("button");
      openSingle.className = "btn btn-sm btn-outline-custom";
      openSingle.textContent = "Mở";
      openSingle.addEventListener("click", (ev) => {
        ev.stopPropagation();
        window.open(url, "_blank");
        menu.style.display = "none";
      });

      const copySingle = document.createElement("button");
      copySingle.className = "btn btn-sm btn-outline-custom";
      copySingle.textContent = "Sao chép";
      copySingle.style.marginLeft = "6px";
      copySingle.addEventListener("click", (ev) => {
        ev.stopPropagation();
        navigator.clipboard && navigator.clipboard.writeText(url);
        menu.style.display = "none";
      });

      const pctSpan = document.createElement("small");
      pctSpan.style.color = "#888";
      pctSpan.style.marginLeft = "8px";
      pctSpan.textContent = pct + "%";

      rightGroup.appendChild(openSingle);
      rightGroup.appendChild(copySingle);
      rowDiv.appendChild(a);
      rowDiv.appendChild(rightGroup);
      menu.appendChild(rowDiv);
    });

    actionsCell.appendChild(menu);
    menuBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      menu.style.display = menu.style.display === "none" ? "block" : "none";
    });
    document.addEventListener("click", () => {
      menu.style.display = "none";
    });
    menu.addEventListener("click", (ev) => ev.stopPropagation());
  })();

  // update results count (count only main rows)
  const resultsCountEl = document.getElementById("resultsCount");
  if (resultsCountEl)
    resultsCountEl.textContent = Array.from(body.children).filter(
      (r) => !r.classList.contains("detail-row")
    ).length;
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
        if (next && next.classList && next.classList.contains("detail-row"))
          next.style.display = "";
        visible++;
      } else {
        tr.style.display = "none";
        const next = rows[i + 1];
        if (next && next.classList && next.classList.contains("detail-row"))
          next.style.display = "none";
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
