# ? SIMPLE SOLUTION: Ch? dùng sleep() ? frontend

## ?? **M?c tiêu:**
- Lo?i b? rate limiter ph?c t?p ? backend
- Ch? dùng `sleep()` ? frontend ?? control delay
- Fix l?i "excessive requests" t? Tavily

---

## ?? **Cách làm:**

### **1. T?ng delay trong frontend:**

File: `public/hotelSearchTavily.js` (dòng ~1272)

**T?:**
```javascript
try {
  await sleep(1500);  // ? Quá nhanh: 1.5 giây
  const response = await axios.get(searchURL);
```

**??I THÀNH:**
```javascript
try {
  await sleep(12000);  // ? An toàn: 12 giây (cho FREE plan)
  const response = await axios.get(searchURL);
```

**Gi?i thích:**
- FREE plan: 5-10 req/min ? **12 giây/request** an toàn
- BASIC plan ($49/mo): 50 req/min ? 1.2s/request
- PRO plan ($199/mo): 100 req/min ? 0.6s/request

---

### **2. (Tùy ch?n) Simplify backend - Xóa rate limiter:**

File: `index.js`

**T?:**
```javascript
import rateLimiter from './services/rateLimiter.js';

app.get("/searchApiTavily", checkAuthenticated, async (req, res) => {
  const userId = getUserIdentifier(req);
  const { allowed, waitTime, activeUsers } = await rateLimiter.acquireToken(userId);
  
  if (!allowed) {
    return res.status(429).json({
      error: "Rate limit exceeded",
      retryAfter: waitTime,
      activeUsers
    });
  }
  
  // ... call Tavily API
});
```

**??I THÀNH:**
```javascript
// ? Comment out rate limiter
// import rateLimiter from './services/rateLimiter.js';

app.get("/searchApiTavily", checkAuthenticated, async (req, res) => {
  // ? G?i Tavily tr?c ti?p, không check rate limit
  try {
    const query = req.query.q;
    if (!query) {
      return res.status(400).json({ error: "Missing query parameter" });
    }
    
    const results = await tavily.search(query, { max_results: 10 });
    
    res.json({
      results: results.results || [],
      query
    });
  } catch (error) {
    console.error("Tavily API Error:", error.message);
    res.status(500).json({ error: error.message });
  }
});
```

**L?i ích:**
- ? Code ??n gi?n h?n
- ? Không c?n maintain rate limiter
- ? Frontend control delay hoàn toàn
- ? Không có warning "MemoryStore" t? express-session

---

## ?? **Delay khuy?n ngh?:**

| Tavily Plan | Delay/Request | MAX_REQUESTS (n?u dùng) | Throughput |
|-------------|---------------|-------------------------|------------|
| **FREE** | **12 giây** | 5 | 5 req/min |
| BASIC ($49/mo) | 1.2 giây | 50 | 50 req/min |
| PRO ($199/mo) | 0.6 giây | 100 | 100 req/min |

---

## ?? **Processing time ??c tính v?i FREE plan:**

| Hotels | Delay | Time |
|--------|-------|------|
| 10 | 12s | **2 phút** |
| 50 | 12s | **10 phút** |
| 100 | 12s | **20 phút** |
| 200 | 12s | **40 phút** |

**R?T CH?M nh?ng KHÔNG b? block!**

---

## ?? **Alternative: Dùng c? 2 (frontend sleep + backend rate limiter):**

N?u mu?n **defense in depth**:

1. **Frontend sleep:** 12s gi?a các requests
2. **Backend rate limiter:** Backup n?u nhi?u users cùng lúc

**File: `services/rateLimiter.js`**
```javascript
this.MAX_REQUESTS = 5;  // 5 req/min
this.TIME_WINDOW = 60000;  // 60 seconds
```

**Khi nào dùng:**
- Nhi?u users cùng lúc ? Backend rate limiter ?i?u ph?i
- 1 user ? Frontend sleep ??

---

## ?? **Troubleshooting:**

### **Q: V?n b? "excessive requests"?**
**A:** T?ng delay lên 15-20 giây:
```javascript
await sleep(15000);  // 15 giây
```

### **Q: Warning "MemoryStore is not designed for production"?**
**A:** ?ó là c?nh báo t? `express-session`, không ?nh h??ng ch?c n?ng. N?u mu?n t?t:

**Option 1:** Dùng session store khác (Redis, MongoDB)
```javascript
// npm install connect-redis redis
import session from 'express-session';
import RedisStore from 'connect-redis';
import {createClient} from 'redis';

const redisClient = createClient();
await redisClient.connect();

app.use(session({
  store: new RedisStore({ client: redisClient }),
  // ...
}));
```

**Option 2:** Ch?p nh?n warning (không ?nh h??ng)

---

## ? **Checklist:**

- [ ] **S?a `hotelSearchTavily.js`:** `await sleep(12000)`
- [ ] **(Optional) Simplify `index.js`:** Xóa rate limiter logic
- [ ] **Restart server:** `npm start`
- [ ] **Test v?i file nh? (5-10 hotels)**
- [ ] **Verify delay ~12s gi?a requests**
- [ ] **Confirm không còn "excessive requests" error**

---

## ?? **Recommended Approach:**

### **Cho testing/development:**
```javascript
// Frontend only
await sleep(12000);
// Backend: No rate limiter needed
```

### **Cho production:**
```javascript
// Frontend
await sleep(12000);

// Backend (backup)
MAX_REQUESTS = 5;
TIME_WINDOW = 60000;
```

---

## ?? **Summary:**

| Approach | Pros | Cons |
|----------|------|------|
| **Frontend sleep only** | ? ??n gi?n<br>? D? maintain<br>? Không c?n Redis | ? Ch?m (12s/req)<br>? Ch? phù h?p 1 user |
| **Frontend + Backend rate limiter** | ? Multi-user support<br>? Defense in depth | ?? Ph?c t?p h?n<br>?? Có warning MemoryStore |
| **Upgrade Tavily plan** | ? Nhanh h?n 10x<br>? Production-ready | ?? $49-199/month |

**Khuy?n ngh?:** 
- **Ng?n h?n:** Frontend sleep 12s
- **Dài h?n:** Upgrade BASIC plan ($49/mo) + gi?m delay xu?ng 1.2s

---

**?? Sau khi s?a, commit:**
```bash
git add public/hotelSearchTavily.js
git commit -m "fix: Increase delay to 12s for Tavily FREE plan"
git push
```
