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
      // const endpoint = "http://localhost:8080/search";
      const endpoint = "/api/search";
      // const endpoint = "https://searxng.hweeren.com/";

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
          "tripadvisor",
        ];

        const results = [];
        let order = 1;
        let currentIndex = 0;

        for (let row of jsonData) {
          // await new Promise((resolve) => setTimeout(resolve, 3000)); // Delay 15s mỗi lần
          let [hotelNo, hotelName, hotelCountry, hotelCity, hotelUrlType] = row;
          if (!hotelName || !hotelCountry || !hotelCity) continue;

          hotelName = hotelName.replace(/[^\x00-\x7F]/g, "");
          const hotelNameArray = hotelName
            .split(" ")
            .map((part) => part.replace(/[(),]/g, "").toLowerCase());
          let query = `${hotelName} ${hotelCountry} ${hotelCity}`;
          let requireTripDomainOnly = false;

          if (
            hotelUrlType &&
            hotelUrlType.trim().toLowerCase() === "ctrip superagg"
          ) {
            query += " trip";
            requireTripDomainOnly = true;
          }

          console.log("Đang tìm:", query);
          const searchURL = `${endpoint}?q=${encodeURIComponent(
            query
          )}&format=json`;

          let matchedLink = [];
          try {
            const options = {
              method: "GET",
              mode: "cors",
              credentials: "include", // Chỉ dùng nếu cần cookie
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
              },
            };
            const response = await fetch(searchURL, options);
            // const url = `https://searx-search-api.p.rapidapi.com/search?q=${encodeURIComponent(
            //   query
            // )}&format=json`;
            // const options = {
            //   method: "GET",
            //   headers: {
            //     "x-rapidapi-key":
            //       "e92a84b2e8msh4a75fb8d7498c48p1f34e4jsn9b18ebfa368f",
            //     "x-rapidapi-host": "searx-search-api.p.rapidapi.com",
            //   },
            // };
            // const response = await fetch(url, options);
            const data = await response.json();
            console.log(data);

            const resultsFromBrave = data.results;
            if (resultsFromBrave && resultsFromBrave.length > 0) {
              let resultsFromBraveArray = [];
              let officialSite = null;

              for (let result of resultsFromBrave) {
                const pageTitle = result.title.toLowerCase();
                const pageUrl = result.url;
                const urlObj = new URL(pageUrl);
                const parsed = tldts.parse(urlObj.hostname);
                const fullHostname = parsed.hostname || ""; // full hostname, ví dụ: sub.wellcommhotels.com
                const rootDomain = parsed.domain || ""; // root domain, ví dụ: wellcommhotels.com
                if (
                  !excludedDomains.some((domain) => pageUrl.includes(domain)) &&
                  (!requireTripDomainOnly || pageUrl.includes("trip")) &&
                  (requireTripDomainOnly ||
                    hotelNameArray.some((part) => rootDomain.includes(part)))
                ) {
                  officialSite = pageUrl;
                  // console.log("Đường dẫn tìm được: ", pageUrl);
                  // console.log("Domain chính tìm được: ", rootDomain);

                  // Check if this link's hostname includes a part of the hotel name

                  const isMatch = isHotelNameInPage(hotelNameArray, pageTitle);

                  if (isMatch.status) {
                    const matchScore = countHotelNameMatches(
                      hotelNameArray,
                      rootDomain
                    );
                    resultsFromBraveArray.push({
                      percentage: isMatch.percentage,
                      matchedLink: pageUrl,
                      rootDomain,
                      matchScore,
                    });
                  }
                }
              }

              const maxPercentageResult = resultsFromBraveArray.reduce(
                (max, item) => (item.percentage > max.percentage ? item : max),
                { percentage: -Infinity }
              );

              // 👉 Sắp xếp theo matchScore cao nhất, sau đó đến phần trăm khớp tên
              resultsFromBraveArray.sort((a, b) => {
                if (b.matchScore !== a.matchScore) {
                  return b.matchScore - a.matchScore;
                }
                return b.percentage - a.percentage;
              });

              console.log(
                "Kết quả cuối cùng:\n" +
                  resultsFromBraveArray.map((e) => e.matchedLink).join("\n")
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
          console.log("Dong thu:", currentIndex, "hoan thanh.\n");
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
    "Order, No, Type, Hotel Name, Hotel Country, Hotel City, " +
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

function countHotelNameMatches(hotelNameArray, hostname) {
  let count = 0;
  for (const part of hotelNameArray) {
    if (hostname.includes(part)) count++;
  }
  return count;
}

function getRootDomain(hostname) {
  const parts = hostname.split(".").reverse();
  if (parts.length >= 2) {
    return `${parts[1]}.${parts[0]}`;
  }
  return hostname;
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
