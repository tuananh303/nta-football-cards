// Lưu/xóa ảnh thẻ trong thư mục UPLOAD_DIR và đọc kích thước ảnh từ phần đầu file
// (không cần thư viện xử lý ảnh; ảnh đã được trình duyệt nén sẵn trước khi gửi lên).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || './uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_BYTES = 8 * 1024 * 1024;

// Nhận dạng định dạng + kích thước. Trả về null nếu không phải JPEG/PNG/WebP hợp lệ.
function probe(buf) {
  if (buf.length < 30) return null;
  // PNG
  if (buf.readUInt32BE(0) === 0x89504e47) {
    return { ext: 'png', w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  // JPEG: tìm marker SOFn
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { ext: 'jpg', h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
    return null;
  }
  // WebP
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const type = buf.toString('ascii', 12, 16);
    if (type === 'VP8X') return { ext: 'webp', w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
    if (type === 'VP8 ') return { ext: 'webp', w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
    if (type === 'VP8L') {
      const b = buf.readUInt32LE(21);
      return { ext: 'webp', w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 };
    }
  }
  return null;
}

// Ghi ảnh ra đĩa với tên ngẫu nhiên, trả về { file, w, h }
function save(buf) {
  if (!buf || buf.length > MAX_BYTES) throw new Error('Ảnh quá lớn (tối đa 8MB).');
  const info = probe(buf);
  if (!info || !info.w || !info.h) throw new Error('File không phải ảnh JPEG, PNG hoặc WebP hợp lệ.');
  const file = `${crypto.randomUUID()}.${info.ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, file), buf);
  return { file, w: info.w, h: info.h };
}

// Chỉ xóa tên file đúng định dạng do hệ thống tạo (tránh xóa nhầm ngoài thư mục)
function remove(file) {
  if (!file || !/^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(file)) return;
  fs.rm(path.join(UPLOAD_DIR, file), { force: true }, () => {});
}

function read(file) {
  if (!file || !/^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(file)) return null;
  try { return fs.readFileSync(path.join(UPLOAD_DIR, file)); } catch { return null; }
}

module.exports = { UPLOAD_DIR, MAX_BYTES, save, remove, read };
