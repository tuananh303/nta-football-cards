// API slide của banner đầu trang: xem công khai (slide đang bật), quản lý bởi admin.
const multer = require('multer');
const db = require('./db');
const images = require('./images');
const { isAdmin, requireAdmin } = require('./auth');

const router = require('./router')();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: images.MAX_BYTES, files: 1 } });

const KINDS = ['image', 'cards'];
const MAX_CARDS = 3;
const str = (v, max) => String(v ?? '').trim().slice(0, max);
const truthy = (v) => v === true || v === 'true' || v === 1 || v === '1';

// Chỉ nhận liên kết nội bộ (#..., /...) hoặc http(s); chặn javascript: và các giao thức lạ
function cleanLink(v) {
  const link = str(v, 300);
  if (!link) return '';
  if (/^#[\w\-/]*$/.test(link) || /^\/(?!\/)/.test(link) || /^https?:\/\/[^\s]+$/i.test(link)) return link;
  throw new Error('Liên kết của nút phải bắt đầu bằng #, / hoặc http(s)://');
}

// Chuẩn hóa dữ liệu slide từ form
function clean(input) {
  const ids = (Array.isArray(input.card_ids) ? input.card_ids : [])
    .map((x) => Number.parseInt(x, 10)).filter((x) => x > 0);
  const data = {
    kind: KINDS.includes(input.kind) ? input.kind : 'cards',
    title: str(input.title, 160),
    subtitle: str(input.subtitle, 400),
    button_label: str(input.button_label, 60),
    button_link: cleanLink(input.button_link),
    card_ids: JSON.stringify([...new Set(ids)].slice(0, MAX_CARDS)),
    active: input.active === undefined ? 1 : truthy(input.active) ? 1 : 0
  };
  // Slide "Ảnh nền" có thể chỉ là ảnh, không cần chữ; slide "Thẻ xòe" bắt buộc có tiêu đề
  if (!data.title && data.kind === 'cards') throw new Error('Vui lòng nhập tiêu đề slide.');
  if (data.button_label && !data.button_link) throw new Error('Nút bấm cần có liên kết.');
  return data;
}

function toJson(row) {
  let cardIds = [];
  try { cardIds = JSON.parse(row.card_ids || '[]'); } catch {}
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    subtitle: row.subtitle,
    button_label: row.button_label,
    button_link: row.button_link,
    image_url: row.image ? `/uploads/${row.image}` : null,
    image_w: row.image_w,
    image_h: row.image_h,
    card_ids: cardIds,
    sort_order: row.sort_order,
    active: !!row.active
  };
}

async function insertSlide(data, img, sortOrder, createdAt) {
  const now = Date.now();
  const row = {
    ...data,
    image: img ? img.file : null, image_w: img ? img.w : 0, image_h: img ? img.h : 0,
    sort_order: sortOrder, created_at: createdAt || now, updated_at: now
  };
  const cols = Object.keys(row);
  const res = await db.run(`INSERT INTO slides (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, cols.map((c) => row[c]));
  return res.id;
}

async function nextOrder() {
  const r = await db.get('SELECT MAX(sort_order) AS m FROM slides');
  return (Number(r?.m) || 0) + 1;
}

// ---- Công khai: slide đang bật; admin xem tất cả ----
router.get('/slides', async (req, res) => {
  const admin = isAdmin(req);
  const rows = await db.all(`SELECT * FROM slides ${admin ? '' : 'WHERE active = 1 '}ORDER BY sort_order, id`);
  res.json({ slides: rows.map(toJson) });
});

// ---- Admin: thêm slide ----
router.post('/slides', requireAdmin, upload.single('image'), async (req, res) => {
  let img = null;
  try {
    const data = clean(JSON.parse(req.body.data || '{}'));
    if (req.file) img = images.save(req.file.buffer);
    if (data.kind === 'image' && !img) throw new Error('Slide kiểu "Ảnh nền" cần có ảnh.');
    const id = await insertSlide(data, img, await nextOrder());
    res.status(201).json(toJson(await db.get('SELECT * FROM slides WHERE id = ?', [id])));
  } catch (err) {
    if (img) images.remove(img.file);
    res.status(400).json({ error: err.message });
  }
});

// ---- Admin: sửa slide (có thể thay ảnh) ----
router.put('/slides/:id', requireAdmin, upload.single('image'), async (req, res) => {
  const old = await db.get('SELECT * FROM slides WHERE id = ?', [req.params.id]);
  if (!old) return res.status(404).json({ error: 'Không tìm thấy slide.' });
  let img = null;
  try {
    const data = clean(JSON.parse(req.body.data || '{}'));
    if (req.file) {
      img = images.save(req.file.buffer);
      Object.assign(data, { image: img.file, image_w: img.w, image_h: img.h });
    }
    if (data.kind === 'image' && !img && !old.image) throw new Error('Slide kiểu "Ảnh nền" cần có ảnh.');
    data.updated_at = Date.now();
    const cols = Object.keys(data);
    await db.run(`UPDATE slides SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [...cols.map((c) => data[c]), old.id]);
    if (img && old.image) images.remove(old.image);
    res.json(toJson(await db.get('SELECT * FROM slides WHERE id = ?', [old.id])));
  } catch (err) {
    if (img) images.remove(img.file);
    res.status(400).json({ error: err.message });
  }
});

// ---- Admin: bật / tắt ----
router.patch('/slides/:id/active', requireAdmin, require('express').json(), async (req, res) => {
  const active = req.body?.active ? 1 : 0;
  const r = await db.run('UPDATE slides SET active = ?, updated_at = ? WHERE id = ?', [active, Date.now(), req.params.id]);
  if (!r.changes) return res.status(404).json({ error: 'Không tìm thấy slide.' });
  res.json({ ok: true, active: !!active });
});

// ---- Admin: sắp xếp lại thứ tự (gửi danh sách id theo thứ tự mới) ----
router.post('/slides/order', requireAdmin, require('express').json(), async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter((x) => x > 0) : [];
  for (const [i, id] of ids.entries()) {
    await db.run('UPDATE slides SET sort_order = ? WHERE id = ?', [i + 1, id]);
  }
  res.json({ ok: true });
});

// ---- Admin: xóa ----
router.delete('/slides/:id', requireAdmin, async (req, res) => {
  const old = await db.get('SELECT * FROM slides WHERE id = ?', [req.params.id]);
  if (!old) return res.status(404).json({ error: 'Không tìm thấy slide.' });
  await db.run('DELETE FROM slides WHERE id = ?', [old.id]);
  images.remove(old.image);
  res.json({ ok: true });
});

// ---- Dùng cho sao lưu / khôi phục ----
async function exportSlides() {
  const rows = await db.all('SELECT * FROM slides ORDER BY sort_order, id');
  return rows.map((r) => {
    const s = toJson(r);
    const buf = images.read(r.image);
    delete s.id; delete s.image_url; delete s.image_w; delete s.image_h;
    return { ...s, image: buf ? buf.toString('base64') : null };
  });
}

// idMap: id thẻ trong file sao lưu -> id thẻ mới sau khi nhập
async function importSlides(list, idMap, replace) {
  if (replace) {
    const old = await db.all('SELECT image FROM slides');
    await db.run('DELETE FROM slides');
    old.forEach((r) => images.remove(r.image));
  }
  let added = 0;
  const skipped = [];
  let order = await nextOrder();
  for (const [i, s] of (list || []).entries()) {
    let img = null;
    try {
      const data = clean({ ...s, card_ids: (s.card_ids || []).map((id) => idMap.get(Number(id))).filter(Boolean) });
      if (s.image) img = images.save(Buffer.from(s.image, 'base64'));
      if (data.kind === 'image' && !img) throw new Error('thiếu ảnh');
      await insertSlide(data, img, order++);
      added++;
    } catch (err) {
      if (img) images.remove(img.file);
      skipped.push(`Slide #${i + 1}${s.title ? ` (${s.title})` : ''}: ${err.message}`);
    }
  }
  return { added, skipped };
}

module.exports = { router, exportSlides, importSlides };
