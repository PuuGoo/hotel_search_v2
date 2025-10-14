/* Web Worker: Advanced Fuzzy scoring (Option C)
   Components:
   - nameSim = blend(Levenshtein, Jaro-Winkler)
   - pathScore/domainScore: heuristic matching tokens in domain or path (aggregator aware)
   - bonuses: official site & good aggregator match
   - penalties: geo mismatch
   Message:
     { type:'score', query, candidates:[{title,url,content}], opts:{ weights } }
   Response per candidate:
     { index, score, nameSim, lev, jw, hostPathScore, domainScore, bonus, penalty, flags:[] }
*/

self.addEventListener("message", (e) => {
  const data = e.data || {};
  if (data.type === "score") {
    const { query = "", candidates = [], opts = {} } = data;
    const normQ = normalize(query);
    const qTokens = normQ.split(" ").filter(Boolean);
    const weights = Object.assign(
      { name: 0.65, hostPath: 0.3, bonus: 0.05 },
      opts.weights || {}
    );
    const titleOnly = !!opts.titleOnly;
    const scores = candidates.map((c, idx) => {
      const url = (c && c.url) || "";
      const originalTitle = (c && c.title) || "";
      // Strip brand/domain suffixes (Agoda, Booking, etc.) so trailing branding không làm giảm điểm
      let cleanedTitle = originalTitle
        .replace(
          /\s*[-|–]\s*(agoda|booking\.com|booking|expedia|hotels\.com|traveloka|tripadvisor|airbnb)(\.com)?$/i,
          ""
        )
        .trim();
      if (!cleanedTitle) cleanedTitle = originalTitle; // fallback if empty
      const normTitle = normalize(cleanedTitle || url);
      let lev = similarityLevenshtein(normQ, normTitle);
      let jw = jaroWinkler(normQ, normTitle);
      let nameSim = (lev + jw) / 2; // internal blend
      const { host, path } = splitUrl(url);
      const domain = host;
      const isAggregator = aggregatorDomains.some((d) => host.endsWith(d));
      const { hostPathScore, domainScore, flagsPartial } = titleOnly
        ? {
            hostPathScore: 0,
            domainScore: 0,
            flagsPartial: isAggregator ? ["AGGREGATOR"] : [],
          }
        : hostPathHeuristic(qTokens, host, path, isAggregator);
      let bonus = 0;
      let penalty = 0;
      const flags = [...flagsPartial];
      // Official site detection: host has >=2 strong tokens (excluding generic words)
      const strongTokens = qTokens.filter((t) => !genericWords.has(t));
      let strongHit = 0;
      for (const t of strongTokens) {
        if (host.includes(t)) strongHit++;
      }
      if (strongHit >= 2 && !isAggregator) {
        bonus += 0.05;
        flags.push("OFFICIAL");
      }
      // Aggregator good path bonus
      if (isAggregator && hostPathScore >= 0.7) {
        bonus += 0.03;
        flags.push("AGG_BONUS");
      }
      // Geo mismatch penalty: if query tokens contain city token not in host/path but another city token appears
      const geoTokens = geoWordList.filter((g) => qTokens.includes(g));
      if (geoTokens.length) {
        geoTokens.forEach((g) => {
          if (!host.includes(g) && !path.includes(g)) penalty += 0.04;
        });
        if (penalty > 0) flags.push("GEO_MISMATCH");
      }
      if (penalty > 0) penalty = Math.min(0.12, penalty); // cap
      // PERFECT MATCH / PREFIX OVERRIDE for titleOnly: nếu tiêu đề (đã loại brand) == query hoặc bắt đầu với query + space => nameSim=1
      if (titleOnly) {
        if (normTitle === normQ || normTitle.startsWith(normQ + " ")) {
          lev = 1;
          jw = 1;
          nameSim = 1;
          flags.push("TITLE_PREFIX_MATCH");
        } else {
          // Sequential token containment (all tokens xuất hiện theo thứ tự) => cũng coi như perfect
          const qTokensLocal = normQ.split(" ").filter(Boolean);
          const tTokens = normTitle.split(" ").filter(Boolean);
          let qi = 0;
          for (
            let ti = 0;
            ti < tTokens.length && qi < qTokensLocal.length;
            ti++
          ) {
            if (tTokens[ti] === qTokensLocal[qi]) qi++;
          }
          if (qi === qTokensLocal.length) {
            lev = 1;
            jw = 1;
            nameSim = 1;
            flags.push("TOKEN_SEQUENCE_MATCH");
          }
          // Order-insensitive full token permutation match: nếu cùng tập token (bỏ trùng & thứ tự) → perfect
          if (nameSim < 1) {
            // Permutation superset match (order-insensitive, allow extra tokens; ignore generic words like hotel/resort)
            const filteredQ = qTokensLocal.filter((t) => !genericWords.has(t));
            const filteredT = tTokens.filter((t) => !genericWords.has(t));
            if (filteredQ.length) {
              const tSet = new Set(filteredT);
              const allContained = filteredQ.every((t) => tSet.has(t));
              if (allContained) {
                lev = 1;
                jw = 1;
                nameSim = 1;
                flags.push("TOKEN_PERMUTATION_MATCH");
              }
            }
          }
        }
      }

      let rawScore;
      if (titleOnly) {
        // In titleOnly mode, dùng trực tiếp nameSim để tận dụng full 0..1 thang điểm
        rawScore = nameSim;
      } else {
        rawScore =
          nameSim * weights.name +
          (titleOnly ? 0 : hostPathScore) * weights.hostPath +
          bonus * weights.bonus -
          penalty * 0.5;
      }
      rawScore = Math.max(0, Math.min(1, rawScore));
      return {
        index: idx,
        score: rawScore,
        nameSim,
        lev,
        jw,
        hostPathScore,
        domainScore,
        bonus,
        penalty,
        flags,
      };
    });
    self.postMessage({ type: "scored", scores });
  }
});

function normalize(s) {
  if (!s) return "";
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitUrl(url) {
  try {
    const u = new URL(url);
    return {
      host: u.hostname.replace(/^www\./, ""),
      path: (u.pathname || "").toLowerCase(),
    };
  } catch (e) {
    return { host: "", path: "" };
  }
}

// Heuristic: +1 if domain tokens overlap query tokens; partial if contains a token substring
function hostPathHeuristic(qTokens, host, path, isAggregator) {
  if (!qTokens.length || !host)
    return { hostPathScore: 0, domainScore: 0, flagsPartial: [] };
  const flags = [];
  const hostParts = host.split(".").filter(Boolean);
  const tokenSet = new Set(qTokens);
  let domainHit = 0;
  for (const part of hostParts) {
    if (tokenSet.has(part)) domainHit += 1;
    else
      for (const qt of tokenSet) {
        if (qt.length > 4 && part.includes(qt)) {
          domainHit += 0.5;
          break;
        }
      }
  }
  const domainScore = Math.min(1, domainHit / Math.max(1, hostParts.length));
  // Aggregator path scoring
  let pathScore = 0;
  if (isAggregator) {
    const rawTokens = path
      .replace(/[^a-z0-9\/\-_.]/g, " ")
      .split(/[\/_\-.]+/)
      .filter(Boolean);
    let match = 0;
    for (const qt of qTokens) {
      if (rawTokens.some((t) => t === qt || (qt.length > 4 && t.includes(qt))))
        match++;
    }
    pathScore = Math.min(1, match / qTokens.length);
  }
  const hostPathScore = isAggregator ? pathScore : domainScore;
  if (isAggregator) flags.push("AGGREGATOR");
  return { hostPathScore, domainScore, flagsPartial: flags };
}

const aggregatorDomains = [
  "booking.com",
  "agoda.com",
  "tripadvisor.com",
  "traveloka.com",
  "expedia.com",
  "hotels.com",
  "kayak.com",
  "ctrip.com",
  "airbnb.com",
  "airbnb.vn",
];
const genericWords = new Set([
  "hotel",
  "resort",
  "the",
  "and",
  "spa",
  "vn",
  "vietnam",
  "group",
  "travel",
  "stay",
  "inn",
]);
const geoWordList = [
  "danang",
  "da",
  "nang",
  "nha",
  "trang",
  "hanoi",
  "saigon",
  "hochiminh",
  "phu",
  "quoc",
  "dalat",
  "quang",
  "nam",
  "halong",
  "sapa",
];

// Levenshtein similarity => 1 - (distance / maxLen)
function similarityLevenshtein(a, b) {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const m = a.length,
    n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  const dist = dp[m][n];
  const maxLen = Math.max(m, n);
  return maxLen ? 1 - dist / maxLen : 1;
}

// Jaro-Winkler
function jaroWinkler(s1, s2) {
  if (!s1 && !s2) return 1;
  if (!s1 || !s2) return 0;
  const m = jaro(s1, s2);
  // common prefix length up to 4
  let l = 0;
  const maxPrefix = 4;
  for (; l < Math.min(maxPrefix, s1.length, s2.length); l++) {
    if (s1[l] !== s2[l]) break;
  }
  return m + l * 0.1 * (1 - m);
}
function jaro(s1, s2) {
  const s1Len = s1.length,
    s2Len = s2.length;
  if (s1Len === 0) return s2Len === 0 ? 1 : 0;
  const matchDistance = Math.floor(Math.max(s1Len, s2Len) / 2) - 1;
  const s1Matches = new Array(s1Len).fill(false);
  const s2Matches = new Array(s2Len).fill(false);
  let matches = 0;
  for (let i = 0; i < s1Len; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, s2Len);
    for (let j = start; j < end; j++) {
      if (s2Matches[j]) continue;
      if (s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let t = 0;
  let k = 0;
  for (let i = 0; i < s1Len; i++)
    if (s1Matches[i]) {
      while (!s2Matches[k]) k++;
      if (s1[i] !== s2[k]) t++;
      k++;
    }
  t = t / 2;
  return (matches / s1Len + matches / s2Len + (matches - t) / matches) / 3;
}
