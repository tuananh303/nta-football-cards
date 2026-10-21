// Điểm khởi động ứng dụng Album Thẻ Bóng Đá
require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const db = require('./src/db');
const auth = require('./src/auth');
const images = require('./src/images');
const cardsRouter = require('./src/cards');

const app = express();
const PORT = Number(process.env.PORT || 3000);

// Hostinger/Nginx đứng trước ứng dụng: tin header X-Forwarded-* để lấy đúng IP và https
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // wasm-unsafe-eval: chỉ cho phép chạy WebAssembly (bộ giải mã HEIC), không mở eval() của JavaScript
        scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        // Bộ giải mã HEIC chạy trong Web Worker tạo từ blob:
        workerSrc: ["'self'", 'blob:'],
        connectSrc: ["'self'"],
        // Không ép tải tài nguyên qua https: website có thể chạy http trong mạng nội bộ (IIS chưa gắn SSL)
        upgradeInsecureRequests: null
      }
    },
    crossOriginEmbedderPolicy: false
  })
);

app.use(express.json({ limit: '1mb' }));

// Ảnh thẻ: tên file ngẫu nhiên, không bao giờ đổi nội dung -> cache lâu dài
app.use('/uploads', express.static(images.UPLOAD_DIR, { maxAge: '365d', immutable: true, index: false }));
// Thư viện cắt ảnh Cropper.js
app.use('/vendor/cropper', express.static(path.join(__dirname, 'node_modules/cropperjs/dist'), { maxAge: '30d' }));
// Thư viện đọc ảnh HEIC của iPhone (bản dùng được với CSP chặt), chỉ tải khi người dùng chọn ảnh HEIC
app.use('/vendor/heic', express.static(path.join(__dirname, 'node_modules/heic-to/dist/csp'), { maxAge: '30d' }));
// Giao diện: trình duyệt luôn kiểm tra lại (ETag) để nhận bản mới ngay sau mỗi lần deploy
app.use(express.static(path.join(__dirname, 'public'), { maxAge: 0, extensions: ['html'] }));

// API đăng nhập
app.post('/api/auth/login', auth.login);
app.post('/api/auth/logout', auth.logout);
app.get('/api/auth/me', (req, res) => res.json({ admin: auth.isAdmin(req) }));
app.use('/api', cardsRouter);
app.use('/api', require('./src/slides').router);

app.use('/api', (req, res) => res.status(404).json({ error: 'Không tìm thấy API.' }));

// Bắt lỗi chung: lỗi tải file (multer) báo rõ ràng, lỗi khác ghi log
app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File quá lớn.' });
  console.error(err);
  res.status(500).json({ error: 'Máy chủ gặp lỗi, vui lòng thử lại.' });
});

db.init()
  .then(() => {
    if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD_HASH) {
      console.warn('[auth] Chưa cấu hình ADMIN_USERNAME / ADMIN_PASSWORD_HASH: không thể đăng nhập admin.');
    }
    app.listen(PORT, () => console.log(`Bộ Sưu Tập Bóng Đá chạy tại http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error('Không kết nối được cơ sở dữ liệu:', err.message);
    process.exit(1);
  });
