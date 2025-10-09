// Đảm bảo rằng script chỉ chạy khi DOM đã tải xong
document.addEventListener("DOMContentLoaded", function () {
  document
    .getElementById("searchButton")
    .addEventListener("click", async () => {
      const apiKey = document.getElementById("apiKeyInput").value.trim();
      if (!apiKey) {
        alert("Vui lòng nhập API Key!");
        return;
      }

      const fileInput = document.getElementById("fileInput");
      if (fileInput.files.length === 0) {
        alert("Vui lòng chọn một file Excel!");
        return;
      }

      const file = fileInput.files[0];
      const reader = new FileReader();

      // Google Custom Search API config
      const cx = "567cdcb3b3b5643cb"; // Thay bằng Search Engine ID thật

      reader.onload = async (e) => {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: "array" });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        let jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });

        jsonData = jsonData.filter((row) =>
          row.some((cell) => cell !== undefined && cell !== null && cell !== "")
        );
        jsonData.shift(); // Remove header

        const results = [];
        let order = 1;
        let currentIndex = 0;

        for (let row of jsonData) {
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

          let query =
            hotelUrlType === "CTrip SuperAgg"
              ? `${hotelName} ${hotelAddress} trip`
              : `${hotelName} ${hotelAddress}`;

          console.log("Query:", query);

          const searchURL = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(
            query
          )}`;

          let matchedLink = [];

          try {
            const response = await fetch(searchURL);
            const data = await response.json();

            const items = data.items || [];
            let resultsFromGoogleArray = [];

            for (let item of items) {
              const pageTitle = item.title.toLowerCase();
              const pageUrl = item.link;
              const isMatch = isHotelNameInPage(hotelNameArray, pageTitle);

              if (isMatch.status && pageUrl.includes(".com")) {
                resultsFromGoogleArray.push({
                  percentage: isMatch.percentage,
                  matchedLink: pageUrl,
                });
              }
            }

            const maxPercentageResult = resultsFromGoogleArray.reduce(
              (max, item) => {
                return item.percentage > max.percentage ? item : max;
              },
              { percentage: -Infinity }
            );

            resultsFromGoogleArray = resultsFromGoogleArray
              .filter(
                (row) =>
                  row.percentage === maxPercentageResult.percentage &&
                  !row.matchedLink.includes("tripadvisor") &&
                  !row.matchedLink.includes("makemytrip")
              )
              .sort((a, b) => {
                const getPriority = (link) => {
                  if (link.includes("agoda")) return 1;
                  if (link.includes("booking")) return 2;
                  if (link.includes("trip")) return 3;
                  if (link.includes("hotels")) return 4;
                  if (link.includes("hotel")) return 5;
                  if (link.includes("trivago")) return 6;
                  if (link.includes("expedia")) return 7;
                  return 99;
                };
                return getPriority(a.matchedLink) - getPriority(b.matchedLink);
              });

            matchedLink = resultsFromGoogleArray.map(
              ({ percentage, ...rest }) => rest["matchedLink"]
            );
          } catch (error) {
            console.error("Lỗi khi tìm kiếm:", error);
          }

          results.push({
            order: order++,
            hotelNo,
            hotelName,
            hotelAddress,
            matchedLinks: [...matchedLink],
          });

          currentIndex++;
          console.log("Đã xử lý dòng:", currentIndex);
        }

        if (results.length > 0) {
          setupDownloadButton(results);
        } else {
          alert("Không tìm thấy kết quả nào.");
        }
      };

      reader.readAsArrayBuffer(file);
    });
});

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
  AZURE_CHILD: ["AZURE_MASTER"],
  AZURE_MASTER: ["AZURE_CHILD"],
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
switchPage("SEARCHGO");
