// Đảm bảo rằng script chỉ chạy khi DOM đã tải xong
document.addEventListener("DOMContentLoaded", function () {
  // Phần Javascript thao tác trên trình duyệt (client-side)
  document
    .getElementById("searchButton")
    .addEventListener("click", async () => {
      // Kiểm tra người dùng có chọn file Excel hay không
      const fileInput = document.getElementById("fileInput");
      if (fileInput.files.length === 0) {
        alert("Vui lòng chọn một file Excel!");
        return;
      }

      // Đọc dữ liệu từ file Excel
      const file = fileInput.files[0];
      const reader = new FileReader(); // Tạo một FileReader để đọc nội dung file Excel.

      // Cài đặt một số thông số từ BING SEARCH
      const subscriptionKey = document.getElementById("subscriptionKey").value;
      console.log(subscriptionKey);

      const endpoint = "https://api.bing.microsoft.com/v7.0/search";

      // Sau khi đọc file Excel hoàn tất ta dùng sự kiện onload xử lý dữ liệu data.
      reader.onload = async (e) => {
        const data = new Uint8Array(e.target.result); // Chuyển dữ liệu file thành mãng nhị phân(Unit8Array).
        const workbook = XLSX.read(data, { type: "array" }); // Đọc toàn bộ file Excel
        const sheetName = workbook.SheetNames[0]; // Lấy tên của sheet đầu tiên trong file Excel
        const sheet = workbook.Sheets[sheetName]; // Đọc dữ liệu của sheet đầu tiên trong file Excel
        const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 }); // Theo mặc định sheet_to_json sẽ lấy dòng đầu tiên và sự dụng giá trị như key cho tất cả các dòng còn lại giống mãng kết hợp. Nếu lựa chọn thuộc tính {header: 1} thì nó sẽ xuất thành một mãng các giá trị theo từng dòng file Excel.

        jsonData.shift(); // Bỏ dòng tiêu đề tức dòng đầu tiên

        const results = []; // Tạo một mãng lưu trữ kết quả tìm kiếm được
        let order = 1; // Biến lưu số thứ tự khách sạn từ file

        // Duyệt qua từng dòng trong file Excel
        for (let row of jsonData) {
          let [hotelName, hotelAddress] = row; // Phá hủy một mãng
          // Nếu dòng dữ liệu trống thì bỏ qua không xử lý
          if (!hotelName || !hotelAddress) {
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
          console.log(hotelNameArray);

          const query = `${hotelName} ${hotelAddress}`; // Điều kiện tìm kiếm
          // const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(
          //   query
          // )}`; //encodeURIComponent mã hóa 1 chuỗi nhằm đảm bảo chuỗi được truyền an toàn qua URL, và mã hóa toàn bộ ký tự đặc biệt &, ?, =, /, :&, ?, =, /, :, bên cạnh đó encodeURI thì không mã hóa các ký tự đặc biệt &, ?, =, /, :
          const searchURL = `${endpoint}?q=${encodeURIComponent(
            query
          )}&textDecorations=true&textFormat=HTML`;

          let matchedLink = "Không tìm thấy link"; // Giá trị mặc định khi không tìm thấy link

          // Thực hiện tìm kiếm qua Algolia
          try {
            const response = await axios.get(searchURL, {
              headers: {
                "Ocp-Apim-Subscription-Key": subscriptionKey, // Thêm API Key vào header, và Ocp-Apim-Subscription-Key: là tham số khóa cố định không đổi tên được
              },
            });
            console.log(response);

            // Lấy kết quả từ Bing API
            let resultsFromBing = response.data.webPages.value;

            if (resultsFromBing && resultsFromBing.length > 0) {
              const resultsFromBingArray = [];
              // Lặp qua các kết quả tìm kiếm từ Bing
              for (let result of resultsFromBing) {
                const pageTitle = result.name.toLowerCase(); // Tiêu đề của trang
                // const pageSnippet = result.snippet.toLowerCase(); // Mô tả ngắn gọn của trang
                const pageUrl = result.url;

                // So sánh tên khách sạn với tiêu đề của trang web
                const isMatch = isHotelNameInPage(hotelNameArray, pageTitle);
                if (isMatch.status) {
                  resultsFromBingArray.push({
                    percentage: isMatch.percentage,
                    matchedLink: pageUrl,
                  });
                }
              }
              console.log(resultsFromBingArray);
              const maxPercentageResult = resultsFromBingArray.reduce(
                (max, item) => {
                  return item.percentage > max.percentage ? item : max;
                },
                { percentage: -Infinity }
              );
              // matchedLink = maxPercentageResult.matchedLink;
              resultsFromBingArray = resultsFromBingArray.filter((row) => row.percentage == maxPercentageResult.percentage);
              resultsFromBingArray = resultsFromBingArray.filter((row) => !row.matchedLink.includes("tripadvisor"));
            matchedLink = resultsFromBingArray.map(({percentage, ...rest}) => rest['matchedLink']);
        console.log(matchedLink);
            }
          } catch (error) {
            console.log("Lỗi khi tìm kiếm:", error);
          }
          console.log(matchedLink);

          // Thêm số thứ tự vào kết quả , nếu không có link thì vẫn trả về kết quả với chữ "Không tìm thấy link"
          results.push({
            order: order++, // Tăng số thứ tự
            hotelName,
            hotelAddress,
            ...matchedLink,
          });
        }

        // Xuất kết quả ra file CSV
        if (results.length > 0) {
          downloadCSV(results);
        } else {
          alert("Không tìm thấy kết quả nào khớp với tên khách sạn.");
        }
      };

      reader.readAsArrayBuffer(file);
    });
  document.getElementById("logoutButton").addEventListener("click", () => {
    window.location.href = "/logout"; // Điều hướng người dùng về trang đăng nhập
  });
});

// Hàm xuất ra file CSV
function downloadCSV(results) {
  // Tạo nội dung cho file CSV, với dòng đầu là tiêu đề, và các dòng còn lại là nội dung
  const csvContent =
    "Order, Hotel Name, Hotel Address, Matched Link\n" +
    results
      .map(
        (row) =>
          `"${row.order}","${row.hotelName}","${row.hotelAddress}","${row.matchedLink}"`
      )
      .join("\n");
  // Tạo file blob
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
  // Tạo một liên kết ẩn để tải file
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "hotel_search_results.csv";
  link.style.display = "none";

  document.body.appendChild(link);
  link.click(); // Kích hoạt tải file tự động
  document.body.removeChild(link);
}
// Hàm kiểm tra tên khách sạn có nằm trong tiêu đề trang hay không
function isHotelNameInPage(hotelNameArray, pageTitle, pageSnippet) {
  let matchCount = 0; // Đếm số phân tử trong hotelNameArray khớp với pageTitle

  // Duyệt qua từng phần tử trong mãng hotelNameArray
  for (let i = 0; i < hotelNameArray.length; i++) {
    const part = hotelNameArray[i];
    // So sánh với tiêu đề trang
    if (pageTitle.includes(part)) {
      matchCount++; // Nếu phần tử khớp tăng biến đếm
    }
  }

  // Kiểm tra nếu số phần tử khớp >= 50% tổng số phần tử trong hotelNameArray
  const matchPercentage = (matchCount / hotelNameArray.length) * 100;
  if (matchPercentage >= 50) {
    return {
      status: true,
      percentage: matchPercentage,
    };
  }
}
