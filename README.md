# Album Thẻ Bóng Đá

Website lưu trữ và quản lý bộ sưu tập thẻ bóng đá kỷ niệm (Football Trading Cards), viết bằng Node.js + Express, dùng SQL Server, giao diện tiếng Việt.

- **Trang công khai** `/`: ai cũng xem được album, tìm kiếm, lọc, xem chi tiết, lật thẻ, phóng to và xem thống kê. Giá trị ước tính, nguồn có được và ghi chú bị ẩn.
- **Trang quản trị** `/admin`: đăng nhập bằng tài khoản admin để thêm, sửa, xóa thẻ, chỉnh ảnh, đánh dấu yêu thích, sao lưu và khôi phục.

## Cấu trúc

```
server.js            Khởi động Express, bảo mật header, phục vụ file tĩnh và API
src/db.js            Kết nối SQL Server (hoặc MySQL / SQLite), tự tạo bảng dbo.cards
src/auth.js          Đăng nhập admin (cookie ký HMAC, chống dò mật khẩu)
src/cards.js         API thẻ, sao lưu / khôi phục
src/images.js        Lưu ảnh vào UPLOAD_DIR, kiểm tra định dạng và kích thước ảnh
public/              Giao diện: index.html (công khai), admin.html (quản trị)
public/js/app.js     Album, bộ lọc, chi tiết, lật 3D, phóng to, thống kê
public/js/admin.js   Đăng nhập, form thêm/sửa, xóa, sao lưu
public/js/editor.js  Cắt, xoay, lật, sáng/tương phản, nén JPEG tối đa 1200px
scripts/hash-password.js  Tạo mã băm mật khẩu admin
```

## Chuẩn bị SQL Server

Thư viện Node.js kết nối SQL Server qua **TCP/IP**, nên cần bật giao thức này cho instance đang dùng:

1. Mở **SQL Server Configuration Manager** → *SQL Server Network Configuration* → *Protocols for TUANANH*.
2. Chuột phải **TCP/IP** → *Enable*.
3. Vào *SQL Server Services*, khởi động lại **SQL Server (TUANANH)**.
4. Dịch vụ **SQL Server Browser** cần đang chạy (để tìm cổng theo tên instance).

Ứng dụng đăng nhập bằng **SQL Server Authentication** (user/mật khẩu), không dùng Windows Authentication. Tài khoản cần quyền tạo bảng trong database `Football card` (lần chạy đầu tự tạo bảng `dbo.cards`). Chữ tiếng Việt được lưu trong cột `NVARCHAR` nên không bị lỗi dấu.

## Chạy trên máy

Yêu cầu Node.js 18 trở lên.

```bash
npm install
cp .env.example .env
npm run hash-password -- "mat-khau-cua-ban"
```

Mở `.env` và điền:

- `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH` (chuỗi vừa in ra, đặt trong dấu nháy đơn).
- `SESSION_SECRET`: chuỗi ngẫu nhiên dài, tạo bằng `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
- `NODE_ENV=development` khi chạy bằng http://localhost.
- `DB_CLIENT=mssql`, `DB_HOST=localhost`, `DB_INSTANCE=TUANANH`, `DB_NAME=Football card`, `DB_USER`, `DB_PASSWORD`.

```bash
npm start
```

Mở http://localhost:3000 và http://localhost:3000/admin.

Muốn thử nhanh mà không cần SQL Server: đặt `DB_CLIENT=sqlite` (cần Node 22.5+), dữ liệu lưu vào `data/dev.sqlite`.

## Đưa lên GitHub

```bash
git init
git add .
git commit -m "Album Thẻ Bóng Đá"
git branch -M main
git remote add origin https://github.com/<tai-khoan>/<ten-repo>.git
git push -u origin main
```

File `.env`, thư mục `uploads/` và `data/` đã nằm trong `.gitignore`, không bị đưa lên GitHub.

## Đưa lên máy chủ

Máy chủ cần: Node.js 18+, kết nối được tới SQL Server qua TCP, và một thư mục cố định để lưu ảnh. Một số lựa chọn:

- **Windows có IIS** (cài SQL Server cùng máy): xem mục [Chạy trên IIS](#chạy-trên-iis-windows) bên dưới.
- **Azure App Service + Azure SQL Database**: đặt các biến môi trường như `.env.example`, thêm `DB_ENCRYPT=true`. Thư mục ảnh đặt trong vùng lưu trữ cố định của App Service (ví dụ `/home/uploads` trên Linux, `D:\home\uploads` trên Windows).
- **Linux VPS**: dùng SQL Server for Linux hoặc SQL Server ở máy chủ khác, cách chạy giống Windows VPS với PM2 + Nginx.

Lưu ý khi triển khai:

- Đặt `NODE_ENV=production` và chạy qua HTTPS (cookie đăng nhập chỉ gửi qua https ở chế độ này).
- Đặt `UPLOAD_DIR` **ngoài thư mục code** để cập nhật code (`git pull`) không làm mất ảnh.
- Reverse proxy cần cho phép request lớn (VD Nginx `client_max_body_size 300M;`, IIS `maxAllowedContentLength`) để nhập file sao lưu.

## Chạy trên IIS (Windows)

IIS không chạy trực tiếp Node.js. Cách làm: Node.js chạy nền như một **dịch vụ Windows** ở `http://127.0.0.1:3000`, còn **IIS làm reverse proxy** (nhận truy cập từ tên miền/cổng 80, 443 rồi chuyển tiếp sang Node). Các bước dưới đây cần quyền Administrator.

**1. Cài hai module cho IIS**

- [URL Rewrite 2.1](https://www.iis.net/downloads/microsoft/url-rewrite)
- [Application Request Routing 3.0](https://www.iis.net/downloads/microsoft/application-request-routing)

Sau khi cài, mở **IIS Manager** → chọn tên máy chủ (cấp cao nhất) → **Application Request Routing Cache** → *Server Proxy Settings* → tick **Enable proxy** → *Apply*.

Vẫn ở cấp máy chủ → **URL Rewrite** → *View Server Variables* → *Add* biến `HTTP_X_FORWARDED_PROTO` (để Node biết trang đang chạy https).

**2. Chạy Node.js thành dịch vụ Windows** (tự khởi động cùng máy) bằng [NSSM](https://nssm.cc/download). Mở PowerShell (Administrator):

```powershell
New-Item -ItemType Directory -Force "E:\Football card\logs"
nssm install AlbumTheBongDa "C:\Program Files\nodejs\node.exe" "server.js"
nssm set AlbumTheBongDa AppDirectory "E:\Football card"
nssm set AlbumTheBongDa AppStdout "E:\Football card\logs\album.log"
nssm set AlbumTheBongDa AppStderr "E:\Football card\logs\album.log"
nssm start AlbumTheBongDa
```

Mở http://127.0.0.1:3000 để kiểm tra Node đã chạy. Sau mỗi lần cập nhật code: `nssm restart AlbumTheBongDa`.

**3. Tạo website trong IIS**

1. Tạo thư mục, ví dụ `C:\inetpub\album`, chép file [deploy/iis/web.config](deploy/iis/web.config) vào đó.
2. IIS Manager → *Sites* → **Add Website**: *Site name* `Album`, *Physical path* `C:\inetpub\album`, *Binding* cổng 80 (và tên miền nếu có).
3. Mở trình duyệt vào địa chỉ của website. Trang admin ở `/admin`.

**4. HTTPS** (khi đưa ra Internet): thêm binding https với chứng chỉ SSL, ví dụ chứng chỉ miễn phí từ [win-acme](https://www.win-acme.com/). Cookie đăng nhập tự bật chế độ `Secure` khi trang chạy https.

Lưu ý:

- Trong `.env` đặt `NODE_ENV=production` và `UPLOAD_DIR` ra ngoài thư mục code, ví dụ `D:\album-uploads`. Tài khoản chạy dịch vụ (mặc định *Local System*) cần quyền ghi vào thư mục đó.
- `web.config` cho phép tải lên tới 300MB để nhập file sao lưu.
- Muốn máy khác trong mạng nội bộ truy cập, mở cổng 80 (và 443) trên Windows Firewall.

## Sao lưu và chuyển dữ liệu

Vào `/admin` → nút sao lưu (biểu tượng hộp) → **Tải file sao lưu**. File JSON chứa toàn bộ thông tin thẻ và ảnh (mã hóa base64). Dùng file này để chuyển album từ máy bạn lên máy chủ: nhập lại ở trang admin của máy chủ, chọn *thêm vào album hiện có* hoặc *thay thế toàn bộ*. File sao lưu không phụ thuộc loại cơ sở dữ liệu.

## Ghi chú kỹ thuật

- Ảnh được trình duyệt xoay đúng chiều, thu nhỏ tối đa 1200px và nén JPEG trước khi tải lên; server kiểm tra lại định dạng và đọc kích thước thật của ảnh.
- Khung ảnh luôn theo tỉ lệ thẻ chuẩn 5:7 (63×88mm). Ảnh gần đúng tỉ lệ thì phủ kín khung; ảnh lệch nhiều (thẻ ngang, ảnh chụp dư nền) hiển thị trọn vẹn trên nền mờ của chính ảnh, và form gợi ý cắt lại theo khung.
- Sắp xếp theo giá trị chỉ có ở trang quản trị vì giá trị bị ẩn với khách.
