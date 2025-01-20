// Khai báo các gói thư viện
import express from "express"; // Framework dùng để xây dựng ứng dụng web và API
import bodyParser from "body-parser"; // Middleware để xử lý dữ liệu từ body của request(JSON hoặc URL-encoded)
import sql from "mssql"; // Thư viện dùng để kết nối và tương tác với cơ sở dữ liệu MySQL
import axios from "axios"; // Thư viện để thực hiện các yêu cầu HTTP, như gọi API từ Bing
import { JSDOM } from "jsdom";
import { fileURLToPath } from "url"; // Import fileURLToPath
import { dirname } from "path"; // Import dirname
import path from "path";
import session from "express-session"; // To manage sessions
import dotenv from "dotenv"; // To manage sessions
dotenv.config();

// Get the directory name from import.meta.url
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Khởi tạo ứng dụng
const app = express(); // App biến đại diện cho ứng dụng Express
app.use(bodyParser.json()); // Middleware giúp xử lý các request với dữ liệu JSON
app.use(bodyParser.urlencoded({ extended: true })); // Middleware xử lý dữ liệu URL-encoded từ các form HTML
app.use(express.static(path.join(__dirname, "public")));
// Set up express session
app.use(
  session({
    secret: "hotel_search_digi", // A secret key to sign the session ID cookie
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }, // 'secure: false' for non-HTTPS environments
  })
);

const dom = new JSDOM(
  `<!DOCTYPE html><html><body><button id="searchButton">Search</button></body></html>`
);
const document = dom.window.document;

// Cấu hình Azure SQL Database
const dbConfig = {
  user: process.env.DB_USER, // Tên đăng nhập vào Azure SQL Database
  password: process.env.DB_PASSWORD, // Mật khẩu đăng nhập vào Azure SQL Database
  server: process.env.DB_SERVER, // Tên máy chủ của Azure SQL Database
  database: process.env.DB_NAME, // Tên cơ sở dữ liệu cần kết nối
  option: {
    encrypt: true, // Yêu cầu mã hóa kết nối (SSL) khi kết nối tới Azure SQL Database
    trustServerCertificate: false, // Không tin cậy chứng chỉ của máy chủ nếu không sử dụng chứng chỉ SSL đáng tin cậy
  },
};

// Kết nối đến Azure SQL Database
let pool; // Khai báo biến pool để quản lý kết nối cơ sở dữ liệu, giúp tái sử dụng kết nối

// Hàm kết nối tới Azure SQL Database
async function connectToDatabase() {
  try {
    pool = await sql.connect(dbConfig); // Kết nối tới cơ sở dữ liệu với cấu hình đã định nghĩa
    console.log("Đã kết nối đến Azure SQL Database"); // In thông báo khi kết nối thành công
  } catch (error) {
    console.error("Không thể kết nối đến Azure SQL Database:", error); // In thông báo lỗi nếu kết nối không thành công
  }
}

await connectToDatabase(); // Gọi hàm kết nối đến cơ sở dữ liệu

// Middleware to check if the user is logged in
function checkAuthenticated(req, res, next) {
  if (req.session.isAuthenticated) {
    return next();
    // return next(); // If user is authenticated, proceed to the next middleware or route handler
  } else {
    res.redirect("/"); // If not authenticated, redirect to the login page
  }
}

// Định tuyến cho trang đăng nhập
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});
app.get("/AZURE_CHILD", checkAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "hotelSearchChild.html"));
});
app.get("/AZURE_MASTER", checkAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "hotelSearchMaster.html"));
});

// Xử lý yêu cầu đăng nhập
app.post("/login", async (req, res) => {
  const { username, password } = req.body; // Lấy thông tin đăng nhập từ body của yêu cầu

  try {
    // Truy vấn để kiểm tra xem người dùng có tồn tại trong cơ sở dũ liệu với username và password đã nhập
    const query =
      "SELECT * FROM users WHERE username = @username and password = @password"; // Dấu @ để đánh dấu tham số, ví dụ @username và @password là các biến tham số được sử dụng thay thế thay vì giá trị cụ thể
    const result = await pool
      .request() // Tạo yêu cầu SQL
      .input("username", sql.VarChar, username) // Thêm tham số 'username' vào câu lệnh SQL
      .input("password", sql.VarChar, password) // Thêm tham số 'password' vào câu lệnh SQL
      .query(query); // Thực thi câu lệnh SQL

    // Nếu tìm thấy người dùng trong cơ sở dữ liệu
    if (result.recordset.length > 0) {
      req.session.isAuthenticated = true; // Mark user as authenticated
      res.redirect("/AZURE_CHILD");
    } else {
      res.status(401).send("Sai tên đăng nhập hoặc mật khẩu");
    }
  } catch (error) {
    console.error("Lỗi khi truy vấn cơ sở dữ liệu:", error); // In lỗi nếu có sự cố truy vấn cơ sở dữ liệu
    res.status(500).send("Lỗi máy chủ."); // Trả về mã lỗi 500 (Internal Server Error) nếu gặp lỗi
  }
});
// Route for logging out (to clear the session)
app.get("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).send("Lỗi khi đăng xuất.");
    }
    res.redirect("/"); // Redirect to login page after logout
  });
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`Server đang chạy tại http://localhost:${process.env.PORT}`);
});
