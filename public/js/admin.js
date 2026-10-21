// Chức năng quản trị: đăng nhập, thêm/sửa/xóa món sưu tập, yêu thích, sao lưu & khôi phục.
import { icon } from './icons.js';
import { RARITY, CONDITION, CATEGORIES, category, esc, api, toast, mediaHTML, ratioOff } from './util.js';
import { compress, prepareOriginal, openEditor } from './editor.js';
import { setupBanner } from './banner.js';

const $ = (sel, root = document) => root.querySelector(sel);
let app;

// ================== Đăng nhập ==================
export function showLogin(appRef, restart) {
  const main = $('#main');
  $('#topbarActions').innerHTML = `<a class="btn ghost" href="/">Về trang công khai</a>`;
  main.innerHTML = `<section class="login">
    <h1>Đăng nhập quản trị</h1>
    <p>Chỉ admin mới thêm, sửa và xóa được món trong bộ sưu tập.</p>
    <form id="loginForm" novalidate>
      <label class="lbl-row" for="lgUser">Tên đăng nhập</label>
      <input class="field" id="lgUser" name="username" autocomplete="username" required>
      <label class="lbl-row" for="lgPass" style="margin-top:14px">Mật khẩu</label>
      <input class="field" id="lgPass" name="password" type="password" autocomplete="current-password" required>
      <p class="err" id="lgErr" role="alert" hidden></p>
      <button class="btn primary" type="submit" style="width:100%;margin-top:20px">Đăng nhập</button>
    </form>
  </section>`;
  $('#lgUser').focus();
  $('#loginForm').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.submitter || $('#loginForm button');
    const err = $('#lgErr');
    const body = { username: $('#lgUser').value.trim(), password: $('#lgPass').value };
    if (!body.username || !body.password) {
      err.hidden = false; err.textContent = 'Nhập tên đăng nhập và mật khẩu.'; return;
    }
    btn.disabled = true; btn.textContent = 'Đang đăng nhập…';
    try {
      await api('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      toast('Đã đăng nhập.');
      restart();
    } catch (ex) {
      err.hidden = false; err.textContent = ex.message;
      btn.disabled = false; btn.textContent = 'Đăng nhập';
      $('#lgPass').select();
    }
  };
}

// Phiên hết hạn giữa chừng: báo và quay lại màn đăng nhập
function handleAuthError(err) {
  if (err.status === 401) {
    toast('Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.', 'error');
    document.querySelectorAll('dialog[open]').forEach((d) => d.close());
    setTimeout(() => location.reload(), 1200);
    return true;
  }
  return false;
}

// ================== Hộp xác nhận ==================
function confirmBox({ title, message, okLabel, danger = true }) {
  const d = $('#confirmDialog');
  d.innerHTML = `
    <div class="sheet-head"><h2 id="confirmTitle">${esc(title)}</h2></div>
    <div class="sheet-body"><p style="margin:0">${esc(message)}</p></div>
    <div class="sheet-foot">
      <button class="btn" type="button" data-v="no">Hủy</button>
      <button class="btn ${danger ? 'danger-solid' : 'primary'}" type="button" data-v="yes">${esc(okLabel)}</button>
    </div>`;
  d.showModal();
  d.querySelector('[data-v="no"]').focus(); // mặc định focus nút an toàn
  return new Promise((resolve) => {
    d.onclick = (e) => {
      const v = e.target.closest('[data-v]')?.dataset.v;
      if (v) { d.close(); resolve(v === 'yes'); }
    };
    d.oncancel = () => resolve(false);
  });
}

// ================== Thiết lập trang admin ==================
export function setup(appRef) {
  app = appRef;
  $('#topbarActions').innerHTML = `
    <button class="btn primary" type="button" id="addBtn">${icon('plus')}<span class="btn-label">Thêm món</span></button>
    <button class="btn icon-only" type="button" id="backupBtn" aria-label="Sao lưu và khôi phục" title="Sao lưu và khôi phục">${icon('archive')}</button>
    <a class="btn icon-only hide-mobile" href="/" aria-label="Xem trang công khai" title="Xem trang công khai">${icon('image')}</a>
    <button class="btn icon-only" type="button" id="logoutBtn" aria-label="Đăng xuất" title="Đăng xuất">${icon('logout')}</button>`;
  $('#addBtn').onclick = () => openForm(null);
  $('#backupBtn').onclick = openBackup;
  $('#logoutBtn').onclick = async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    location.reload();
  };

  app.hooks.emptyAction = () => openForm(null);
  setupBanner(app, { confirmBox, handleAuthError });
  app.hooks.cardFav = toggleFav;
  app.hooks.detailActions = async (btn, card) => {
    if (btn.hasAttribute('data-edit')) openForm(card);
    if (btn.hasAttribute('data-dfav')) toggleFav(card.id);
    if (btn.hasAttribute('data-delete')) deleteCard(card);
  };
}

// ================== Yêu thích ==================
async function toggleFav(id) {
  const card = app.state.cards.find((c) => c.id === id);
  if (!card) return;
  try {
    const r = await api(`/api/cards/${id}/favorite`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ favorite: !card.favorite })
    });
    card.favorite = r.favorite;
    app.renderResults();
    if (app.state.detailId === id) app.openDetail(id);
    toast(card.favorite ? `Đã thêm ${card.player_name} vào yêu thích.` : `Đã bỏ ${card.player_name} khỏi yêu thích.`);
  } catch (err) {
    if (!handleAuthError(err)) toast(err.message, 'error');
  }
}

// ================== Xóa ==================
async function deleteCard(card) {
  const ok = await confirmBox({
    title: 'Xóa món này?',
    message: `${category(card.category).label} “${card.player_name}” cùng toàn bộ ảnh sẽ bị xóa vĩnh viễn. Không thể hoàn tác.`,
    okLabel: 'Xóa vĩnh viễn'
  });
  if (!ok) return;
  try {
    await api(`/api/cards/${card.id}`, { method: 'DELETE' });
    app.closeDetail();
    await app.reload();
    toast(`Đã xóa ${card.player_name}.`);
  } catch (err) {
    if (!handleAuthError(err)) toast(err.message, 'error');
  }
}

// ================== Form thêm / sửa ==================
const options = (list, current) => list.map((o) => `<option value="${o.key}" ${o.key === current ? 'selected' : ''}>${o.label}</option>`).join('');
const datalist = (id, key) =>
  `<datalist id="${id}">${[...new Set(app.state.cards.map((c) => c[key]).filter(Boolean))].map((v) => `<option value="${esc(v)}">`).join('')}</datalist>`;

const MAX_PHOTOS = 6;
// Khung cắt gợi ý trong trình chỉnh ảnh, theo loại
const EDITOR_ASPECTS = {
  card: undefined, // dùng mặc định: thẻ dọc 5:7, thẻ ngang 7:5, tự do
  jersey: [{ key: 'square', label: 'Vuông 1:1', value: 1 }, { key: 'free', label: 'Tự do', value: NaN }],
  poster: [{ key: 'p34', label: 'Dọc 3:4', value: 3 / 4 }, { key: 'p23', label: 'Dọc 2:3', value: 2 / 3 }, { key: 'l43', label: 'Ngang 4:3', value: 4 / 3 }, { key: 'free', label: 'Tự do', value: NaN }],
  figure: [{ key: 'p45', label: 'Dọc 4:5', value: 4 / 5 }, { key: 'free', label: 'Tự do', value: NaN }]
};
const PHOTO_EDGE = { card: 1200, jersey: 1600, poster: 1600, figure: 1600 };
const MAKER_HINT = { card: 'Panini, Topps…', jersey: 'Nike, Adidas, Puma…', poster: 'VD: nhà in, CLB phát hành', figure: 'Kodoatoys, SoccerStarz…' };
const fileOf = (url) => (url ? url.split('/').pop() : null);

function openForm(item) {
  const d = $('#formDialog');
  const c = item || { rarity: 'common', card_condition: 'good', tags: [], extra: {} };
  const x = c.extra || {};
  const isEdit = !!item;
  let cat = item?.category || (app.state.category !== 'all' ? app.state.category : 'card');
  // Danh sách ảnh dùng chung cho mọi loại. Thẻ: [0] = mặt trước, [1] = mặt sau.
  // Mỗi ảnh: { url, w, h, file (ảnh đã có trên server) | blob (ảnh mới), original, settings }
  const fromServer = (url, w, h) => ({ url, w, h, file: fileOf(url), blob: null, original: null, settings: null });
  const photos = !item ? []
    : item.category === 'card'
      ? [fromServer(item.front_url, item.front_w, item.front_h), ...(item.back_url ? [fromServer(item.back_url, item.back_w, item.back_h)] : [])]
      : item.gallery.map((g) => fromServer(g.url, g.w, g.h));
  const blobUrls = [];
  let dirty = false;
  let pickTarget = 'append'; // ô ảnh sẽ nhận file vừa chọn: số thứ tự, hoặc 'append' (thêm vào cuối)

  const only = (cats) => `data-cats="${cats}"`;
  d.innerHTML = `
    <form id="cardForm" novalidate>
      <div class="sheet-head">
        <h2 id="formTitle">${isEdit ? `Sửa ${esc(c.player_name)}` : 'Thêm vào bộ sưu tập'}</h2>
        <button class="btn icon-only ghost" type="button" data-act="close" aria-label="Đóng">${icon('x')}</button>
      </div>
      <div class="sheet-body">
        <fieldset class="fgroup cat-pick-wrap">
          <legend class="lbl-row">Loại món</legend>
          <div class="cat-pick">
            ${CATEGORIES.map((k) => `<label class="cat-opt"><input type="radio" name="category" value="${k.key}" ${k.key === cat ? 'checked' : ''}><span>${k.label}</span></label>`).join('')}
          </div>
        </fieldset>
        <div class="form-layout" style="margin-top:20px">
          <div>
            <h3 class="form-section" id="photoTitle"></h3>
            <div id="photoArea"></div>
            <p class="err" id="photoErr" hidden></p>
            <p class="hint" id="photoHint"></p>
            <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/*,.heic,.heif" id="pFiles" hidden>
            <input type="file" accept="image/*" capture="environment" id="pCamera" hidden>
          </div>
          <div>
            <h3 class="form-section">Thông tin</h3>
            <div class="form-grid">
              <div class="wide">
                <label class="lbl-row" for="fName">Tên cầu thủ / đội bóng <span class="req">*</span></label>
                <input class="field" id="fName" name="player_name" maxlength="160" value="${esc(c.player_name || '')}" required aria-describedby="nameErr">
                <p class="err" id="nameErr" hidden></p>
              </div>
              <div>
                <label class="lbl-row" for="fTeam">Câu lạc bộ / đội tuyển</label>
                <input class="field" id="fTeam" name="team" maxlength="160" list="dlTeam" value="${esc(c.team || '')}">
              </div>
              <div>
                <label class="lbl-row" for="fSeason2">Mùa giải / năm</label>
                <input class="field" id="fSeason2" name="season" maxlength="40" placeholder="VD: 2023/24 hoặc 2018" value="${esc(c.season || '')}">
              </div>
              <div>
                <label class="lbl-row" for="fMaker2" id="fMakerLbl"></label>
                <input class="field" id="fMaker2" name="manufacturer" maxlength="120" list="dlMaker" value="${esc(c.manufacturer || '')}">
              </div>
              <div ${only('card')}>
                <label class="lbl-row" for="fSet">Tên bộ sưu tập</label>
                <input class="field" id="fSet" name="set_name" maxlength="160" list="dlSet" placeholder="VD: Prizm World Cup" value="${esc(c.set_name || '')}">
              </div>
              <div ${only('card')}>
                <label class="lbl-row" for="fNum">Số thẻ trong bộ</label>
                <input class="field" id="fNum" name="card_number" maxlength="40" placeholder="VD: 125/300" value="${esc(c.card_number || '')}">
              </div>
              <div ${only('card')}>
                <label class="lbl-row" for="fRarity">Độ hiếm</label>
                <select class="field" id="fRarity" name="rarity">${options(RARITY, c.rarity)}</select>
              </div>
              <div ${only('poster')}>
                <label class="lbl-row" for="fSize">Kích thước</label>
                <input class="field" id="fSize" maxlength="40" placeholder="VD: 50 × 70 cm" value="${esc(x.size || '')}">
              </div>
              <div ${only('poster')}>
                <label class="lbl-row" for="fSigner">Người ký</label>
                <input class="field" id="fSigner" maxlength="120" placeholder="VD: Cristiano Ronaldo" value="${esc(x.signed_by || '')}">
              </div>
              <div ${only('poster')}>
                <label class="lbl-row" for="fCoa">Giấy chứng nhận (COA)</label>
                <input class="field" id="fCoa" maxlength="120" placeholder="VD: PSA/DNA AB12345" value="${esc(x.coa || '')}">
              </div>
              <div ${only('figure')}>
                <label class="lbl-row" for="fHeight">Chiều cao</label>
                <input class="field" id="fHeight" maxlength="20" placeholder="VD: 15 cm" value="${esc(x.height || '')}">
              </div>
              <div ${only('figure')}>
                <label class="lbl-row" for="fMaterial">Chất liệu</label>
                <input class="field" id="fMaterial" maxlength="60" placeholder="VD: nhựa PVC, resin" value="${esc(x.material || '')}">
              </div>
              <div>
                <label class="lbl-row" for="fCond">Tình trạng</label>
                <select class="field" id="fCond" name="card_condition">${options(CONDITION, c.card_condition)}</select>
              </div>
              <div>
                <label class="lbl-row" for="fDate">Ngày sở hữu</label>
                <input class="field" id="fDate" name="acquired_date" type="date" value="${esc(c.acquired_date || '')}">
              </div>
              <div class="wide" ${only('jersey poster figure')}>
                <label class="check"><input type="checkbox" id="fSigned" ${c.signed ? 'checked' : ''}> Có chữ ký</label>
              </div>
              <div class="wide" ${only('figure')}>
                <label class="check"><input type="checkbox" id="fBoxed" ${x.boxed ? 'checked' : ''}> Còn hộp</label>
              </div>
              <div class="wide">
                <label class="lbl-row" for="fSource">Nguồn có được</label>
                <input class="field" id="fSource" name="source" maxlength="200" placeholder="VD: Mua ở hội chợ, đổi với bạn, quà tặng…" value="${esc(c.source || '')}">
              </div>
              <div class="wide">
                <label class="lbl-row" for="fTags">Tags</label>
                <input class="field" id="fTags" name="tags" maxlength="600" placeholder="VD: world cup, tân binh, tiền đạo" value="${esc((c.tags || []).join(', '))}" aria-describedby="tagsHint">
                <p class="hint" id="tagsHint">Ngăn cách các tag bằng dấu phẩy.</p>
              </div>
              <div class="wide">
                <label class="lbl-row" for="fNotes">Ghi chú</label>
                <textarea class="field" id="fNotes" name="notes" rows="3" maxlength="5000">${esc(c.notes || '')}</textarea>
              </div>
              <div class="wide">
                <label class="check"><input type="checkbox" name="favorite" ${c.favorite ? 'checked' : ''}> Đánh dấu yêu thích</label>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="sheet-foot">
        <button class="btn" type="button" data-act="close">Hủy</button>
        <button class="btn primary" type="submit" id="saveBtn">${icon('check')} ${isEdit ? 'Lưu thay đổi' : 'Thêm vào bộ sưu tập'}</button>
      </div>
      ${datalist('dlTeam', 'team')}${datalist('dlMaker', 'manufacturer')}${datalist('dlSet', 'set_name')}
    </form>`;

  const form = $('#cardForm', d);
  const photoErr = (msg) => {
    const e = $('#photoErr', d);
    e.hidden = !msg;
    e.innerHTML = msg ? `${icon('alert', 16)} <span>${esc(msg)}</span>` : '';
    if (msg) toast(msg, 'error');
  };

  // ----- Ảnh -----
  const photoMedia = (p, alt) => mediaHTML(p.url, p.w, p.h, alt, { lazy: false, ratio: category(cat).ratio });

  function renderPhotos() {
    const area = $('#photoArea', d);
    if (cat === 'card') {
      $('#photoTitle', d).textContent = 'Ảnh thẻ';
      $('#photoHint', d).textContent = 'Kéo thả ảnh vào ô, bấm để chọn file, hoặc dùng nút máy ảnh trên điện thoại.';
      area.innerHTML = `<div class="slots">${[0, 1].map((i) => {
        const p = photos[i];
        const name = i === 0 ? 'mặt trước' : 'mặt sau';
        // Gợi ý cắt khi ảnh lệch xa khung thẻ dọc 5:7 và cả khung ngang 7:5
        const off = p ? Math.min(ratioOff(p.w, p.h), ratioOff(p.h, p.w)) : 0;
        return `<div class="slot">
          <div class="slot-title">${i === 0 ? 'Mặt trước <span class="req">*</span>' : 'Mặt sau (tùy chọn)'}</div>
          <div class="drop${p ? ' has' : ''}" tabindex="0" role="button" data-drop="${i}" aria-label="${p ? `Đổi ảnh ${name}` : `Chọn hoặc kéo thả ảnh ${name}`}">
            ${p ? `${photoMedia(p, `Xem trước ảnh ${name}`)}<span class="drop-hint">${icon('upload', 18)} Đổi ảnh</span>`
              : `<div>${icon('upload', 26)}<div>Bấm để chọn ảnh<br>hoặc kéo thả vào đây</div></div>`}
          </div>
          <div class="slot-actions">
            ${p ? `<button class="btn sm" type="button" data-pedit="${i}">${icon('crop', 16)} Chỉnh sửa</button>
                   <button class="btn sm" type="button" data-ppick="${i}">${icon('upload', 16)} Đổi ảnh</button>
                   <button class="btn sm icon-only" type="button" data-pcam="${i}" aria-label="Chụp ảnh ${name} mới" title="Chụp ảnh mới">${icon('camera', 16)}</button>
                   ${i === 1 ? `<button class="btn sm icon-only danger" type="button" data-premove="1" aria-label="Bỏ ảnh mặt sau" title="Bỏ ảnh mặt sau">${icon('trash', 16)}</button>` : ''}`
              : `<button class="btn sm" type="button" data-pcam="${i}">${icon('camera', 16)} Chụp ảnh</button>`}
          </div>
          ${p && off > 0.06 ? `<p class="ratio-warn">${icon('alert', 16)}<span>Ảnh lệch tỉ lệ thẻ chuẩn nên sẽ có viền nền mờ. <button type="button" class="linklike" data-pedit="${i}">Cắt theo khung thẻ</button></span></p>` : ''}
        </div>`;
      }).join('')}</div>`;
      return;
    }
    // Áo đấu / poster / tượng: bộ ảnh tối đa 6 tấm, ảnh đầu là ảnh bìa
    $('#photoTitle', d).textContent = `Ảnh (${photos.length}/${MAX_PHOTOS})`;
    $('#photoHint', d).textContent = 'Ảnh đầu tiên là ảnh bìa hiện ngoài album. Có thể thêm ảnh mặt sau, cận chữ ký, nhãn mác… Ảnh được giữ trọn và tự thu vừa khung.';
    area.innerHTML = `<div class="pgrid" data-cat="${cat}">
      ${photos.map((p, i) => `<div class="pcell">
        <div class="pthumb">${photoMedia(p, `Ảnh ${i + 1}`)}${i === 0 ? '<span class="pcover">Ảnh bìa</span>' : ''}</div>
        <div class="pcell-actions">
          <button class="btn sm icon-only" type="button" data-pmove="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Đưa ảnh ${i + 1} lên trước" title="Lên trước">${icon('chevronL', 16)}</button>
          <button class="btn sm icon-only" type="button" data-pmove="${i}" data-dir="1" ${i === photos.length - 1 ? 'disabled' : ''} aria-label="Đưa ảnh ${i + 1} ra sau" title="Ra sau">${icon('chevronR', 16)}</button>
          <button class="btn sm icon-only" type="button" data-pedit="${i}" aria-label="Chỉnh sửa ảnh ${i + 1}" title="Chỉnh sửa">${icon('crop', 16)}</button>
          <button class="btn sm icon-only danger" type="button" data-premove="${i}" aria-label="Xóa ảnh ${i + 1}" title="Xóa ảnh">${icon('trash', 16)}</button>
        </div>
      </div>`).join('')}
      ${photos.length < MAX_PHOTOS ? `<div class="pcell">
        <div class="drop padd" tabindex="0" role="button" data-drop="append" aria-label="Thêm ảnh: bấm để chọn hoặc kéo thả nhiều ảnh">
          <div>${icon('plus', 26)}<div>Thêm ảnh</div></div>
        </div>
        <div class="pcell-actions"><button class="btn sm" type="button" data-pcam="append">${icon('camera', 16)} Chụp ảnh</button></div>
      </div>` : ''}
    </div>`;
  }

  // Bật/tắt các trường riêng theo loại
  function applyCategory() {
    d.querySelectorAll('[data-cats]').forEach((el) => { el.hidden = !el.dataset.cats.split(' ').includes(cat); });
    $('#fMakerLbl', d).textContent = category(cat).makerLabel;
    $('#fMaker2', d).placeholder = MAKER_HINT[cat];
    $('#pFiles', d).multiple = cat !== 'card';
    photoErr('');
    renderPhotos();
  }

  async function makePhoto(file) {
    const original = await prepareOriginal(file);
    const out = await compress(original, PHOTO_EDGE[cat]);
    const url = URL.createObjectURL(out.blob);
    blobUrls.push(url);
    return { url, w: out.w, h: out.h, file: null, blob: out.blob, original, settings: null };
  }

  // Nhận file (chọn, chụp, kéo thả). target: số thứ tự ô, hoặc 'append'
  async function acceptFiles(fileList, target) {
    const files = [...fileList];
    if (!files.length) return;
    photoErr('');
    const area = $('#photoArea', d);
    area.setAttribute('aria-busy', 'true');
    for (const file of files) {
      const looksImage = file.type ? file.type.startsWith('image/') : /\.(jpe?g|jfif|png|webp|gif|bmp|heic|heif|avif)$/i.test(file.name);
      if (!looksImage) { photoErr(`“${file.name}” không phải file ảnh. Hãy chọn ảnh JPEG, PNG hoặc WebP.`); continue; }
      if (target === 'append' && photos.length >= MAX_PHOTOS) { photoErr(`Mỗi món tối đa ${MAX_PHOTOS} ảnh.`); break; }
      try {
        const p = await makePhoto(file);
        if (target === 'append') photos.push(p);
        else photos[target] = p;
        dirty = true;
      } catch (err) {
        console.error('Không xử lý được ảnh', file.name, file.type, err);
        const heic = /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
        photoErr(heic
          ? `Không chuyển được ảnh HEIC “${file.name}” sang JPEG. Hãy thử xuất ảnh sang JPEG trên điện thoại rồi chọn lại.`
          : `Không đọc được ảnh “${file.name}”. Hãy thử ảnh JPEG hoặc PNG khác.`);
      }
      if (cat === 'card') break; // ô thẻ chỉ nhận 1 ảnh
    }
    area.removeAttribute('aria-busy');
    const keep = $('#photoErr', d).innerHTML;
    renderPhotos();
    if (keep) $('#photoErr', d).innerHTML = keep;
  }

  async function editPhoto(i) {
    const p = photos[i];
    try {
      // Ảnh đã có trên server: tải về làm ảnh gốc để chỉnh
      if (!p.original) p.original = await prepareOriginal(await (await fetch(p.url)).blob());
    } catch {
      return photoErr('Không tải được ảnh để chỉnh sửa.');
    }
    const result = await openEditor(p.original, p.settings, 'Chỉnh sửa ảnh', { aspects: EDITOR_ASPECTS[cat], maxEdge: PHOTO_EDGE[cat] });
    if (!result) return;
    const url = URL.createObjectURL(result.blob);
    blobUrls.push(url);
    photos[i] = { ...p, url, w: result.w, h: result.h, file: null, blob: result.blob, settings: result.settings };
    dirty = true;
    renderPhotos();
  }

  applyCategory();

  // ----- Sự kiện -----
  const openPicker = (target, camera = false) => { pickTarget = target; $(camera ? '#pCamera' : '#pFiles', d).click(); };
  d.onclick = (e) => {
    const t = e.target.closest('button, [data-drop]');
    if (!t) return;
    if (t.dataset.act === 'close') return tryClose();
    if (t.dataset.drop) return openPicker(t.dataset.drop === 'append' ? 'append' : Number(t.dataset.drop));
    if (t.dataset.ppick) return openPicker(Number(t.dataset.ppick));
    if (t.dataset.pcam) return openPicker(t.dataset.pcam === 'append' ? 'append' : Number(t.dataset.pcam), true);
    if (t.dataset.pedit) return editPhoto(Number(t.dataset.pedit));
    if (t.dataset.premove) {
      photos.splice(Number(t.dataset.premove), 1);
      dirty = true;
      return renderPhotos();
    }
    if (t.dataset.pmove) {
      const i = Number(t.dataset.pmove);
      const j = i + Number(t.dataset.dir);
      [photos[i], photos[j]] = [photos[j], photos[i]];
      dirty = true;
      renderPhotos();
      return ($(`[data-pmove="${j}"][data-dir="${t.dataset.dir}"]:not([disabled])`, d) || $(`[data-pmove="${j}"]:not([disabled])`, d))?.focus();
    }
  };
  d.onkeydown = (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.dataset?.drop) {
      e.preventDefault();
      openPicker(e.target.dataset.drop === 'append' ? 'append' : Number(e.target.dataset.drop));
    }
  };
  d.onchange = (e) => {
    const t = e.target;
    if (t.id === 'pFiles' || t.id === 'pCamera') { acceptFiles(t.files, pickTarget); t.value = ''; return; }
    if (t.name === 'category') {
      cat = t.value;
      // Thẻ chỉ có 2 ô ảnh (trước, sau): các ảnh thừa bị bỏ khi chuyển sang Thẻ
      if (cat === 'card' && photos.length > 2) photos.length = 2;
      dirty = true;
      applyCategory();
    }
  };
  form.oninput = () => { dirty = true; };
  // Kéo thả ảnh vào ô
  d.ondragover = (e) => { const z = e.target.closest('[data-drop]'); if (z) { e.preventDefault(); z.classList.add('over'); } };
  d.ondragleave = (e) => e.target.closest?.('[data-drop]')?.classList.remove('over');
  d.ondrop = (e) => {
    const z = e.target.closest('[data-drop]');
    if (!z) return;
    e.preventDefault();
    z.classList.remove('over');
    acceptFiles(e.dataTransfer.files, z.dataset.drop === 'append' ? 'append' : Number(z.dataset.drop));
  };
  async function tryClose() {
    if (dirty && !(await confirmBox({ title: 'Bỏ các thay đổi?', message: 'Thông tin và ảnh bạn vừa nhập sẽ không được lưu.', okLabel: 'Bỏ thay đổi' }))) return;
    d.close();
  }
  d.oncancel = (e) => { e.preventDefault(); tryClose(); };
  d.onclose = () => blobUrls.forEach((u) => URL.revokeObjectURL(u));

  // Lấy dữ liệu ảnh để gửi: ảnh mới dùng blob; ảnh cũ mà đổi vị trí (VD: chuyển loại) thì tải về gửi lại
  const blobOf = async (p) => p.blob || (await (await fetch(p.url)).blob());

  // ----- Lưu -----
  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const data = Object.fromEntries(fd.entries());
    data.category = cat;
    data.favorite = form.favorite.checked;
    data.signed = $('#fSigned', d).checked;
    data.tags = String(data.tags || '').split(',').map((t) => t.trim()).filter(Boolean);
    data.extra = cat === 'poster' ? { size: $('#fSize', d).value, signed_by: $('#fSigner', d).value, coa: $('#fCoa', d).value }
      : cat === 'figure' ? { height: $('#fHeight', d).value, material: $('#fMaterial', d).value, boxed: $('#fBoxed', d).checked }
        : {};

    // Kiểm tra dữ liệu, báo lỗi ngay cạnh ô nhập
    let firstInvalid = null;
    const nameErr = $('#nameErr', d);
    if (!data.player_name.trim()) {
      nameErr.hidden = false; nameErr.textContent = 'Vui lòng nhập tên cầu thủ hoặc đội bóng.';
      $('#fName', d).setAttribute('aria-invalid', 'true'); firstInvalid = $('#fName', d);
    } else { nameErr.hidden = true; $('#fName', d).removeAttribute('aria-invalid'); }
    if (!photos[0]) {
      photoErr(cat === 'card' ? 'Thẻ cần có ảnh mặt trước.' : 'Cần ít nhất một ảnh.');
      firstInvalid = firstInvalid || $('#photoArea [data-drop]', d);
    }
    if (firstInvalid) return firstInvalid.focus();

    const btn = $('#saveBtn', d);
    btn.disabled = true; btn.textContent = 'Đang lưu…';
    try {
      const body = new FormData();
      if (cat === 'card') {
        const [front, back] = photos;
        const oldFront = isEdit ? fileOf(item.front_url) : null;
        const oldBack = isEdit && item.category === 'card' ? fileOf(item.back_url) : null;
        if (front.blob || front.file !== oldFront) body.append('front', await blobOf(front), 'front.jpg');
        if (back && (back.blob || back.file !== oldBack)) body.append('back', await blobOf(back), 'back.jpg');
        if (!back && isEdit && item.back_url) data.remove_back = true;
      } else {
        let k = 0;
        data.layout = [];
        for (const p of photos) {
          if (p.blob) { data.layout.push(`new:${k++}`); body.append('images', p.blob, `anh-${k}.jpg`); }
          else data.layout.push(`keep:${p.file}`);
        }
      }
      body.append('data', JSON.stringify(data));
      const saved = await api(isEdit ? `/api/cards/${item.id}` : '/api/cards', { method: isEdit ? 'PUT' : 'POST', body });
      dirty = false;
      d.close();
      await app.reload();
      toast(isEdit ? `Đã lưu thay đổi cho ${saved.player_name}.` : `Đã thêm ${saved.player_name} vào bộ sưu tập.`);
    } catch (err) {
      if (handleAuthError(err)) return;
      toast(err.message, 'error');
      btn.disabled = false; btn.innerHTML = `${icon('check')} ${isEdit ? 'Lưu thay đổi' : 'Thêm vào bộ sưu tập'}`;
    }
  };

  d.showModal();
  $('#fName', d).focus();
}


// ================== Sao lưu & khôi phục ==================
function openBackup() {
  const d = $('#backupDialog');
  d.innerHTML = `
    <div class="sheet-head">
      <h2 id="backupTitle">Sao lưu và khôi phục</h2>
      <button class="btn icon-only ghost" type="button" data-act="close" aria-label="Đóng">${icon('x')}</button>
    </div>
    <div class="sheet-body">
      <h3 class="form-section">Xuất dữ liệu</h3>
      <p class="page-sub" style="margin:0 0 12px">Tải về một file JSON chứa toàn bộ ${app.state.cards.length} món kèm ảnh và các slide banner.</p>
      <a class="btn" href="/api/backup" download>${icon('download')} Tải file sao lưu</a>

      <h3 class="form-section" style="margin-top:28px">Nhập từ file</h3>
      <form id="importForm">
        <label class="lbl-row" for="impFile">File sao lưu (.json)</label>
        <input class="field" id="impFile" type="file" accept="application/json,.json" required>
        <fieldset class="fgroup" style="margin-top:14px">
          <legend>Cách nhập</legend>
          <label class="check"><input type="radio" name="mode" value="merge" checked> Thêm vào album hiện có</label><br>
          <label class="check"><input type="radio" name="mode" value="replace"> Thay thế toàn bộ album</label>
        </fieldset>
        <p class="err" id="impMsg" role="alert" hidden></p>
        <button class="btn primary" type="submit" style="margin-top:12px">${icon('upload')} Nhập dữ liệu</button>
      </form>
    </div>`;
  d.showModal();
  d.onclick = (e) => { if (e.target.closest('[data-act="close"]')) d.close(); };
  $('#importForm', d).onsubmit = async (e) => {
    e.preventDefault();
    const file = $('#impFile', d).files[0];
    const msg = $('#impMsg', d);
    if (!file) { msg.hidden = false; msg.textContent = 'Hãy chọn file sao lưu.'; return; }
    const mode = new FormData(e.target).get('mode');
    if (mode === 'replace' && !(await confirmBox({
      title: 'Thay thế toàn bộ album?',
      message: `Toàn bộ ${app.state.cards.length} món hiện tại sẽ bị xóa và thay bằng dữ liệu trong file. Không thể hoàn tác.`,
      okLabel: 'Thay thế album'
    }))) return;
    const btn = e.submitter;
    btn.disabled = true; btn.textContent = 'Đang nhập…';
    const body = new FormData();
    body.append('mode', mode);
    body.append('file', file);
    try {
      const r = await api('/api/backup/import', { method: 'POST', body });
      await app.reload();
      toast(`Đã nhập ${r.added} món${r.slides_added ? ` và ${r.slides_added} slide` : ""}.`);
      if (r.skipped.length) {
        msg.hidden = false;
        msg.textContent = `Bỏ qua ${r.skipped.length} mục lỗi: ${r.skipped.slice(0, 5).join('; ')}${r.skipped.length > 5 ? '…' : ''}`;
      } else d.close();
    } catch (err) {
      if (handleAuthError(err)) return;
      msg.hidden = false; msg.textContent = err.message;
    } finally {
      btn.disabled = false; btn.innerHTML = `${icon('upload')} Nhập dữ liệu`;
    }
  };
}
