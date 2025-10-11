import axios from "https://cdn.jsdelivr.net/npm/axios@1.6.8/dist/esm/axios.min.js";

// Đảm bảo rằng script chỉ chạy khi DOM đã tải xong
document.addEventListener("DOMContentLoaded", function () {
  localStorage.removeItem("runCount");
  let MAX_RUNS = 0;
  let runCount = parseInt(localStorage.getItem("runCount") || "0");
  const counterEl = document.getElementById("counter");
  // Cập nhật giao diện ban đầu
  updateCounter(counterEl, runCount, MAX_RUNS);

  document
    .getElementById("searchButton")
    .addEventListener("click", async () => {
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
        for (let row of jsonData) {
          // await new Promise((resolve) => setTimeout(resolve, 10000)); // Delay 15s mỗi lần
          let [hotelNo, hotelName, hotelAddress, hotelUrlType] = row;
          if (!hotelName || !hotelAddress) continue;

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

            // Nếu không có lỗi và có data:
            runCount++;
            localStorage.setItem("runCount", runCount);
            updateCounter(counterEl, runCount, MAX_RUNS);

            // Lấy kết quả từ Brave Search API
            const resultsFromBrave = data.results;

            if (resultsFromBrave && resultsFromBrave.length > 0) {
              let resultsFromBraveArray = [];
              for (let result of resultsFromBrave) {
                const pageTitle = result.title.toLowerCase();
                const pageUrl = result.url;
                const isMatch = isHotelNameInPage(hotelNameArray, pageTitle);

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

              matchedLink = resultsFromBraveArray.map(
                ({ percentage, ...rest }) => rest["matchedLink"]
              );
            }
          } catch (error) {
            console.log("Lỗi khi tìm kiếm:", error);
          }

          results.push({
            order: order++,
            hotelNo,
            hotelName,
            hotelAddress,
            matchedLinks: [...matchedLink],
          });
          currentIndex++;
          console.log("Dong thu:", currentIndex, "hoan thanh.");
        }

        if (results.length > 0) {
          setupDownloadButton(results); // Hiển thị nút tải khi có kết quả
        } else {
          alert("Không tìm thấy kết quả nào khớp với tên khách sạn.");
        }
      };

      reader.readAsArrayBuffer(file);
    });
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
function downloadCSV(results) {
  const maxMatchedLinks = Math.max(
    ...results.map((row) => row.matchedLinks.length)
  );

  const header =
    "Order,No, Type, Hotel Name,Hotel Address," +
    Array.from(
      { length: maxMatchedLinks },
      (_, i) => `Matched Link ${i + 1}`
    ).join(",") +
    "\n";

  const csvContent =
    header +
    results
      .map((row) => {
        const links = row.matchedLinks.map((link) => `"${link}"`);
        while (links.length < maxMatchedLinks) {
          links.push('""');
        }
        return `"${row.order}","${row.hotelNo}", Child,"${row.hotelName}","${
          row.hotelAddress
        }",${links.join(",")}`;
      })
      .join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "hotel_search_results.csv";
  link.style.display = "none";

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Hàm kiểm tra tên khách sạn có nằm trong tiêu đề trang hay không
function isHotelNameInPage(hotelNameArray, pageTitle) {
  let matchCount = 0;

  for (let i = 0; i < hotelNameArray.length; i++) {
    const part = hotelNameArray[i];
    if (pageTitle.includes(part)) {
      matchCount++;
    }
  }

  const matchPercentage = (matchCount / hotelNameArray.length) * 100;

  return {
    status: true,
    percentage: matchPercentage,
  };
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
