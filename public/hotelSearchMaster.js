// Đảm bảo rằng script chỉ chạy khi DOM đã tải xong
document.addEventListener("DOMContentLoaded", function () {
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
      const subscriptionKey = "BSACjTF0z775aTu2a7O4XbDo2N8Ta-7";

      // Cập nhật endpoint cho Brave Search API
      const endpoint = "https://api.search.brave.com/res/v1/web/search";

      reader.onload = async (e) => {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: "array" });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });

        jsonData.shift();

        const results = [];
        let order = 1;

        for (let row of jsonData) {
          let [hotelNo, hotelName, hotelAddress] = row;
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

          const query = `${hotelName} ${hotelAddress}`;
          const searchURL = `${endpoint}?q=${encodeURIComponent(query)}`;

          let matchedLink = [];

          try {
            // Thay thế axios bằng fetch và sử dụng Brave API
            const response = await fetch(searchURL, {
              method: "GET",
              headers: {
                "Access-Control-Allow-Origin": "*",
                "X-Subscription-Token": subscriptionKey, // Sử dụng Bearer token cho Brave API,
              },
            });

            const data = await response.json();
            console.log(data);

            // Lấy kết quả từ Brave Search API
            const resultsFromBrave = data.webPages.value;

            if (resultsFromBrave && resultsFromBrave.length > 0) {
              let resultsFromBraveArray = [];
              for (let result of resultsFromBrave) {
                const pageTitle = result.name.toLowerCase();
                const pageUrl = result.url;
                const isMatch = isHotelNameInPage(hotelNameArray, pageTitle);

                if (isMatch.status) {
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

              resultsFromBraveArray = resultsFromBraveArray
                .filter(
                  (row) =>
                    row.percentage == maxPercentageResult.percentage &&
                    !row.matchedLink.includes("tripadvisor")
                )
                .sort((a, b) => {
                  if (
                    a.matchedLink.includes("agoda") &&
                    !b.matchedLink.includes("agoda")
                  )
                    return -1;
                  if (
                    !a.matchedLink.includes("agoda") &&
                    b.matchedLink.includes("agoda")
                  )
                    return 1;
                  return 0;
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
        }

        if (results.length > 0) {
          downloadCSV(results);
        } else {
          alert("Không tìm thấy kết quả nào khớp với tên khách sạn.");
        }
      };

      reader.readAsArrayBuffer(file);
    });
});

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
switchPage("AZURE_MASTER");
