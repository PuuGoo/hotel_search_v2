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
      const endpoint = "http://127.0.0.1:8080/search";

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

        const excludedDomains = [
          "agoda",
          "booking",
          "trip",
          "trivago",
          "expedia",
          "zenhotels",
          "skyscanner",
          "airpaz",
          "readytotrip",
          "lodging-world",
          "yatra",
          "rentbyowner",
          "goibibo",
          "laterooms",
          "tiket",
        ];

        const results = [];
        let order = 1;
        let currentIndex = 0;

        for (let row of jsonData) {
          let [hotelNo, hotelName, hotelCountry, hotelCity] = row;
          if (!hotelName || !hotelCountry || !hotelCity) continue;

          hotelName = hotelName.replace(/[^\x00-\x7F]/g, "");
          const hotelNameArray = hotelName
            .split(" ")
            .map((part) => part.replace(/[(),]/g, "").toLowerCase());
          const query = `${hotelName}`;
          const searchURL = `${endpoint}?q=${encodeURIComponent(
            query
          )}&format=json&engine=google`;

          let matchedLink = [];
          try {
            const response = await fetch(searchURL, {
              method: "GET",
              headers: { "Content-Type": "application/json" },
            });
            const data = await response.json();
            console.log(data);

            const resultsFromBrave = data.results;
            if (resultsFromBrave && resultsFromBrave.length > 0) {
              let resultsFromBraveArray = [];
              let officialSite = null;

              for (let result of resultsFromBrave) {
                const pageTitle = result.title.toLowerCase();
                const pageUrl = result.url;

                if (
                  !excludedDomains.some((domain) => pageUrl.includes(domain))
                ) {
                  officialSite = pageUrl;
                  console.log(pageUrl);

                  const isMatch = isHotelNameInPage(hotelNameArray, pageTitle);

                  if (isMatch.status) {
                    resultsFromBraveArray.push({
                      percentage: isMatch.percentage,
                      matchedLink: pageUrl,
                    });
                  }
                }
              }

              const maxPercentageResult = resultsFromBraveArray.reduce(
                (max, item) => (item.percentage > max.percentage ? item : max),
                { percentage: -Infinity }
              );

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
            hotelCountry,
            hotelCity,
            matchedLinks: [...matchedLink],
          });
          currentIndex++;
          console.log("Dong thu:", currentIndex, "hoan thanh.");
        }

        if (results.length > 0) {
          setupDownloadButton(results);
        } else {
          alert("Không tìm thấy kết quả nào khớp với tên khách sạn.");
        }
      };

      reader.readAsArrayBuffer(file);
    });
});

function setupDownloadButton(results) {
  const downloadButton = document.getElementById("downloadCSVButton");
  downloadButton.style.display = "block";
  downloadButton.onclick = () => downloadCSV(results);
}

function downloadCSV(results) {
  const maxMatchedLinks = Math.max(
    ...results.map((row) => row.matchedLinks.length)
  );
  const header =
    "Order, No, Type, Hotel Name, Hotel Country, Hotel City" +
    Array.from(
      { length: maxMatchedLinks },
      (_, i) => `Matched Link ${i + 1}`
    ).join(",") +
    "\n";

  const csvContent =
    header +
    results
      .map((row) => {
        const links = row.matchedLinks.map((link) => `\"${link}\"`);
        while (links.length < maxMatchedLinks) links.push('""');
        return `\"${row.order}\",\"${row.hotelNo}\", Child,\"${
          row.hotelName
        }\",\"${row.hotelCountry}\",\"${row.hotelCity}\",${links.join(",")}`;
      })
      .join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "hotel_search_results.csv";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function isHotelNameInPage(hotelNameArray, pageTitle) {
  let matchCount = 0;
  for (let part of hotelNameArray) if (pageTitle.includes(part)) matchCount++;
  return {
    status: true,
    percentage: (matchCount / hotelNameArray.length) * 100,
  };
}

function getPriority(link) {
  const priorities = [
    "agoda",
    "booking",
    "trip",
    "trivago",
    "expedia",
    "zenhotels",
    "skyscanner",
    "airpaz",
    "readytotrip",
    "lodging-world",
    "yatra",
    "rentbyowner",
    "goibibo",
    "laterooms",
    "tiket",
  ];
  return priorities.findIndex((domain) => link.includes(domain)) + 1 || 18;
}

const pages = { AZURE_CHILD: ["AZURE_MASTER"], AZURE_MASTER: ["AZURE_CHILD"] };
function switchPage(page) {
  document.querySelector("h1").textContent = `Chức năng ${page}`;
  document.querySelectorAll(".page").forEach((p) => (p.style.display = "none"));
  document.getElementById(`page${page}`).style.display = "block";

  const buttonContainer = document.querySelector(".button-container");
  buttonContainer.innerHTML = "";
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

switchPage("ROOMXNG");
