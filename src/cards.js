// API món sưu tập (thẻ, áo đấu, poster, tượng): xem công khai, thêm/sửa/xóa (admin),
// sao lưu & khôi phục (admin). Bảng vẫn tên "cards" để giữ dữ liệu cũ.
const express = require('express');
const multer = require('multer');
const db = require('./db');
const images = require('./images');
const { isAdmin, requireAdmin } = require('./auth');
const { exportSlides, importSlides } = require('./slides');

const router = require('./router')();
const MAX_IMAGES = 6; // áo/poster/tượng: tối đa 6 ảnh mỗi món
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: images.MAX_BYTES, files: MAX_IMAGES + 2 } });
const imageFields = upload.fields([{ name: 'front', maxCount: 1 }, { name: 'back', maxCount: 1 }, { name: 'images', maxCount: MAX_IMAGES }]);
const uploadBackup = multer({ storage: multer.memoryStorage(), limits: { fileSize: 300 * 1024 * 1024, files: 1 } });

const CATEGORIES = ['card', 'jersey', 'poster', 'figure'];
const RARITIES = ['common', 'rare', 'super_rare', 'autograph', 'limited'];
const CONDITIONS = ['new', 'good', 'fair', 'worn'];
// Thông tin riêng của từng loại (lưu trong cột extra dạng JSON): [tên, độ dài tối đa | 'bool']
const EXTRA_FIELDS = {
  card: [],
  jersey: [],
  poster: [['size', 40], ['signed_by', 120], ['coa', 120]],
  figure: [['height', 20], ['material', 60], ['boxed', 'bool']]
};
// Các trường chỉ admin được thấy
const PRIVATE_FIELDS = ['source', 'notes'];

const str = (v, max) => String(v ?? '').trim().slice(0, max);
const truthy = (v) => v === true || v === 'true' || v === 1 || v === '1';
const parseJson = (s, fallback) => { try { return JSON.parse(s) ?? fallback; } catch { return fallback; } };

// Chuẩn hóa dữ liệu form gửi lên, trả về đối tượng an toàn để ghi DB
function clean(input) {
  const category = CATEGORIES.includes(input.category) ? input.category : 'card';
  const isCard = category === 'card';
  const tags = Array.isArray(input.tags) ? input.tags : String(input.tags || '').split(',');
  const season = str(input.season, 40);
  const yearMatch = season.match(/(19|20)\d{2}/);
  const extraIn = input.extra || {};
  const extra = {};
  for (const [key, rule] of EXTRA_FIELDS[category]) {
    const v = rule === 'bool' ? truthy(extraIn[key]) : str(extraIn[key], rule);
    if (v) extra[key] = v;
  }
  const data = {
    category,
    player_name: str(input.player_name, 160),
    team: str(input.team, 160),
    season,
    year: yearMatch ? Number(yearMatch[0]) : null,
    manufacturer: str(input.manufacturer, 120),
    // Bộ sưu tập, số thẻ và độ hiếm chỉ dành cho thẻ
    set_name: isCard ? str(input.set_name, 160) : '',
    card_number: isCard ? str(input.card_number, 40) : '',
    rarity: isCard && RARITIES.includes(input.rarity) ? input.rarity : 'common',
    // Thẻ có độ hiếm "Chữ ký"; các loại khác dùng ô "Có chữ ký"
    signed: !isCard && truthy(input.signed) ? 1 : 0,
    card_condition: CONDITIONS.includes(input.card_condition) ? input.card_condition : 'good',
    // Giá trị ước tính không còn hiện/nhập trên website; giá đã lưu được giữ nguyên
    // (chỉ ghi khi dữ liệu gửi lên có giá, VD: nhập từ file sao lưu)
    ...(input.est_value !== undefined && { est_value: Math.max(0, Math.min(Number.parseInt(input.est_value, 10) || 0, 1e15)) }),
    acquired_date: /^\d{4}-\d{2}-\d{2}$/.test(input.acquired_date || '') ? input.acquired_date : '',
    source: str(input.source, 200),
    notes: str(input.notes, 5000),
    tags: JSON.stringify([...new Set(tags.map((t) => str(t, 40)).filter(Boolean))].slice(0, 30)),
    extra: JSON.stringify(extra),
    favorite: truthy(input.favorite) ? 1 : 0
  };
  if (!data.player_name) throw new Error('Vui lòng nhập tên cầu thủ / đội bóng.');
  return data;
}

// Danh sách ảnh của một món: thẻ = [trước, sau]; loại khác = bộ ảnh (ảnh đầu là ảnh bìa)
function imagesOf(row) {
  if ((row.category || 'card') === 'card') {
    return [
      { file: row.front_image, w: row.front_w, h: row.front_h },
      ...(row.back_image ? [{ file: row.back_image, w: row.back_w, h: row.back_h }] : [])
    ];
  }
  const list = parseJson(row.gallery, []);
  return list.length ? list : [{ file: row.front_image, w: row.front_w, h: row.front_h }];
}

// Chuyển hàng DB thành JSON gửi về trình duyệt
function toJson(row, admin) {
  // on_banner: cột cũ, đã thay bằng slide; est_value: giá không còn hiển thị
  const { on_banner, gallery, extra, est_value, ...rest } = row;
  const item = {
    ...rest,
    category: row.category || 'card',
    favorite: !!row.favorite,
    signed: !!row.signed,
    tags: parseJson(row.tags, []),
    extra: parseJson(extra, {})
  };
  item.front_url = `/uploads/${row.front_image}`;
  item.back_url = row.back_image ? `/uploads/${row.back_image}` : null;
  item.gallery = item.category === 'card' ? [] : imagesOf(row).map((g) => ({ url: `/uploads/${g.file}`, w: g.w, h: g.h }));
  if (!admin) PRIVATE_FIELDS.forEach((f) => delete item[f]);
  return item;
}

// Ghép ảnh theo thứ tự admin gửi lên cho áo/poster/tượng.
// layout: ["keep:<tên file cũ>", "new:<thứ tự file mới>", ...]; ảnh đầu tiên là ảnh bìa.
function buildGallery(layout, newFiles, oldFiles, saved) {
  const allowed = new Set(oldFiles);
  const list = [];
  for (const token of (Array.isArray(layout) ? layout : []).slice(0, MAX_IMAGES)) {
    const [kind, ref] = String(token).split(':');
    if (kind === 'keep' && allowed.has(ref)) {
      list.push(oldFiles.meta.get(ref));
    } else if (kind === 'new' && newFiles[Number(ref)]) {
      const img = images.save(newFiles[Number(ref)].buffer);
      saved.push(img.file);
      list.push(img);
    }
  }
  if (!list.length) throw new Error('Cần ít nhất một ảnh.');
  return list;
}

function galleryFields(list) {
  const [cover] = list;
  return {
    front_image: cover.file, front_w: cover.w, front_h: cover.h,
    back_image: null, back_w: 0, back_h: 0,
    gallery: JSON.stringify(list.map(({ file, w, h }) => ({ file, w, h })))
  };
}

async function insertRow(row, createdAt) {
  const now = Date.now();
  const full = { ...row, created_at: createdAt || now, updated_at: now };
  const cols = Object.keys(full);
  const res = await db.run(`INSERT INTO cards (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, cols.map((c) => full[c]));
  return res.id;
}

const noun = (category) => (category === 'card' ? 'Thẻ' : 'Món này');

// ---- Công khai ----
router.get('/cards', async (req, res) => {
  const admin = isAdmin(req);
  const rows = await db.all('SELECT * FROM cards ORDER BY created_at DESC');
  res.json({ admin, cards: rows.map((r) => toJson(r, admin)) });
});

// ---- Admin: thêm ----
router.post('/cards', requireAdmin, imageFields, async (req, res) => {
  const saved = [];
  try {
    const body = JSON.parse(req.body.data || '{}');
    const data = clean(body);
    let imgs;
    if (data.category === 'card') {
      const frontFile = req.files?.front?.[0];
      if (!frontFile) throw new Error('Thẻ cần có ảnh mặt trước.');
      const front = images.save(frontFile.buffer); saved.push(front.file);
      const backFile = req.files?.back?.[0];
      const back = backFile ? images.save(backFile.buffer) : null;
      if (back) saved.push(back.file);
      imgs = {
        front_image: front.file, front_w: front.w, front_h: front.h,
        back_image: back ? back.file : null, back_w: back ? back.w : 0, back_h: back ? back.h : 0, gallery: null
      };
    } else {
      const empty = Object.assign([], { meta: new Map() });
      imgs = galleryFields(buildGallery(body.layout, req.files?.images || [], empty, saved));
    }
    const id = await insertRow({ ...data, ...imgs });
    res.status(201).json(toJson(await db.get('SELECT * FROM cards WHERE id = ?', [id]), true));
  } catch (err) {
    saved.forEach(images.remove);
    res.status(400).json({ error: err.message });
  }
});

// ---- Admin: sửa (đổi thông tin, thay/xếp lại ảnh, có thể đổi loại) ----
router.put('/cards/:id', requireAdmin, imageFields, async (req, res) => {
  const old = await db.get('SELECT * FROM cards WHERE id = ?', [req.params.id]);
  if (!old) return res.status(404).json({ error: 'Không tìm thấy món này.' });
  const saved = [];
  try {
    const body = JSON.parse(req.body.data || '{}');
    const data = clean(body);
    // Mọi ảnh hiện có của món (kể cả khi đổi loại)
    const oldList = [...imagesOf(old), ...(old.back_image ? [{ file: old.back_image, w: old.back_w, h: old.back_h }] : [])]
      .filter((g, i, a) => g.file && a.findIndex((x) => x.file === g.file) === i);
    let imgs;
    if (data.category === 'card') {
      const frontFile = req.files?.front?.[0];
      const backFile = req.files?.back?.[0];
      const front = frontFile ? images.save(frontFile.buffer) : { file: old.front_image, w: old.front_w, h: old.front_h };
      if (frontFile) saved.push(front.file);
      let back = old.category === 'card' && old.back_image ? { file: old.back_image, w: old.back_w, h: old.back_h } : null;
      if (backFile) { back = images.save(backFile.buffer); saved.push(back.file); }
      else if (body.remove_back) back = null;
      imgs = {
        front_image: front.file, front_w: front.w, front_h: front.h,
        back_image: back ? back.file : null, back_w: back ? back.w : 0, back_h: back ? back.h : 0, gallery: null
      };
    } else {
      const oldFiles = Object.assign(oldList.map((g) => g.file), { meta: new Map(oldList.map((g) => [g.file, g])) });
      imgs = galleryFields(buildGallery(body.layout, req.files?.images || [], oldFiles, saved));
    }
    const row = { ...data, ...imgs, updated_at: Date.now() };
    const cols = Object.keys(row);
    await db.run(`UPDATE cards SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [...cols.map((c) => row[c]), old.id]);
    // Xóa những ảnh cũ không còn dùng
    const keep = new Set([imgs.front_image, imgs.back_image, ...parseJson(imgs.gallery, []).map((g) => g.file)]);
    oldList.filter((g) => !keep.has(g.file)).forEach((g) => images.remove(g.file));
    res.json(toJson(await db.get('SELECT * FROM cards WHERE id = ?', [old.id]), true));
  } catch (err) {
    saved.forEach(images.remove);
    res.status(400).json({ error: err.message });
  }
});

// ---- Admin: bật/tắt yêu thích nhanh ----
router.patch('/cards/:id/favorite', requireAdmin, express.json(), async (req, res) => {
  const fav = req.body?.favorite ? 1 : 0;
  const r = await db.run('UPDATE cards SET favorite = ?, updated_at = ? WHERE id = ?', [fav, Date.now(), req.params.id]);
  if (!r.changes) return res.status(404).json({ error: 'Không tìm thấy món này.' });
  res.json({ ok: true, favorite: !!fav });
});

// ---- Admin: xóa ----
router.delete('/cards/:id', requireAdmin, async (req, res) => {
  const old = await db.get('SELECT * FROM cards WHERE id = ?', [req.params.id]);
  if (!old) return res.status(404).json({ error: 'Không tìm thấy món này.' });
  await db.run('DELETE FROM cards WHERE id = ?', [old.id]);
  [...imagesOf(old).map((g) => g.file), old.front_image, old.back_image].forEach(images.remove);
  res.json({ ok: true });
});

// ---- Admin: xuất toàn bộ dữ liệu kèm ảnh (base64) ----
router.get('/backup', requireAdmin, async (req, res) => {
  const rows = await db.all('SELECT * FROM cards ORDER BY id');
  const encode = (file) => {
    const buf = images.read(file);
    return buf ? buf.toString('base64') : null;
  };
  const cards = rows.map((r) => {
    const { id, front_image, back_image, front_w, front_h, back_w, back_h, year, updated_at, on_banner, gallery, ...rest } = r;
    const base = { ref: id, ...rest, category: r.category || 'card', tags: parseJson(r.tags, []), extra: parseJson(r.extra, {}), favorite: !!r.favorite, signed: !!r.signed, est_value: Number(r.est_value) };
    // ref: id cũ, để slide "Thẻ xòe" trỏ lại đúng món sau khi nhập
    if (base.category === 'card') return { ...base, front: encode(front_image), back: back_image ? encode(back_image) : null };
    return { ...base, images: imagesOf(r).map((g) => encode(g.file)).filter(Boolean) };
  });
  const slides = await exportSlides();
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Disposition', `attachment; filename="bo-suu-tap-bong-da-${stamp}.json"`);
  res.json({ app: 'football-card-album', version: 3, exported_at: new Date().toISOString(), count: cards.length, cards, slides });
});

// ---- Admin: nhập lại từ file sao lưu ----
// mode=merge: thêm vào bộ sưu tập hiện có; mode=replace: xóa hết rồi nhập
router.post('/backup/import', requireAdmin, uploadBackup.single('file'), async (req, res) => {
  let payload;
  try {
    payload = JSON.parse(req.file?.buffer.toString('utf8') || '');
  } catch {
    return res.status(400).json({ error: 'File sao lưu không đọc được (không phải JSON hợp lệ).' });
  }
  if (!payload || payload.app !== 'football-card-album' || !Array.isArray(payload.cards)) {
    return res.status(400).json({ error: 'File này không phải bản sao lưu của bộ sưu tập này.' });
  }
  if (req.body.mode === 'replace') {
    const old = await db.all('SELECT * FROM cards');
    await db.run('DELETE FROM cards');
    old.forEach((r) => [...imagesOf(r).map((g) => g.file), r.front_image, r.back_image].forEach(images.remove));
  }
  let added = 0;
  const skipped = [];
  const idMap = new Map();
  for (const [i, c] of payload.cards.entries()) {
    const saved = [];
    try {
      const data = clean(c);
      let imgs;
      if (data.category === 'card') {
        const front = images.save(Buffer.from(c.front || '', 'base64')); saved.push(front.file);
        const back = c.back ? images.save(Buffer.from(c.back, 'base64')) : null;
        if (back) saved.push(back.file);
        imgs = {
          front_image: front.file, front_w: front.w, front_h: front.h,
          back_image: back ? back.file : null, back_w: back ? back.w : 0, back_h: back ? back.h : 0, gallery: null
        };
      } else {
        const list = (c.images || []).slice(0, MAX_IMAGES).map((b64) => { const g = images.save(Buffer.from(b64, 'base64')); saved.push(g.file); return g; });
        if (!list.length) throw new Error('thiếu ảnh');
        imgs = galleryFields(list);
      }
      const newId = await insertRow({ ...data, ...imgs }, Number(c.created_at) || undefined);
      if (c.ref) idMap.set(Number(c.ref), newId);
      added++;
    } catch (err) {
      saved.forEach(images.remove);
      skipped.push(`${noun(c.category)} #${i + 1}${c.player_name ? ` (${c.player_name})` : ''}: ${err.message}`);
    }
  }
  // Bản sao lưu cũ (version 1) không có slide: giữ nguyên slide hiện tại
  let slides = { added: 0, skipped: [] };
  if (Array.isArray(payload.slides)) slides = await importSlides(payload.slides, idMap, req.body.mode === 'replace');
  res.json({ added, slides_added: slides.added, skipped: [...skipped, ...slides.skipped] });
});

module.exports = router;
