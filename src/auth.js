// Xác thực admin: một tài khoản duy nhất khai báo trong .env.
// Phiên đăng nhập là cookie được ký HMAC (không cần lưu phiên trên server,
// nên khởi động lại server vẫn giữ đăng nhập cho tới khi hết hạn).
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const COOKIE = 'fc_admin';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 ngày

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET phải dài ít nhất 32 ký tự');
  return s;
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verify(token) {
  if (!token || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const expected = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString());
    return data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function isAdmin(req) {
  const data = verify(readCookie(req, COOKIE));
  return !!data && data.u === process.env.ADMIN_USERNAME;
}

// Middleware chặn các API cần quyền admin
function requireAdmin(req, res, next) {
  if (isAdmin(req)) return next();
  res.status(401).json({ error: 'Bạn cần đăng nhập quyền admin.' });
}

// Giới hạn số lần đăng nhập sai theo IP (chống dò mật khẩu)
const attempts = new Map();
function tooManyAttempts(ip) {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now - rec.first > 15 * 60 * 1000) return false;
  return rec.count >= 8;
}
function recordFailure(ip) {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now - rec.first > 15 * 60 * 1000) attempts.set(ip, { first: now, count: 1 });
  else rec.count++;
}

async function login(req, res) {
  const ip = req.ip;
  if (tooManyAttempts(ip)) {
    return res.status(429).json({ error: 'Đăng nhập sai quá nhiều lần. Thử lại sau 15 phút.' });
  }
  const { username, password } = req.body || {};
  const okUser = typeof username === 'string' && username === process.env.ADMIN_USERNAME;
  const hash = process.env.ADMIN_PASSWORD_HASH || '';
  const okPass = typeof password === 'string' && hash && (await bcrypt.compare(password, hash));
  if (!okUser || !okPass) {
    recordFailure(ip);
    return res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không đúng.' });
  }
  attempts.delete(ip);
  const token = sign({ u: username, exp: Date.now() + MAX_AGE_MS });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    // Chỉ gửi cookie qua https khi trang đang chạy https (IIS/Nginx báo qua X-Forwarded-Proto)
    secure: req.secure,
    maxAge: MAX_AGE_MS
  });
  res.json({ ok: true });
}

function logout(req, res) {
  res.clearCookie(COOKIE);
  res.json({ ok: true });
}

module.exports = { isAdmin, requireAdmin, login, logout };
