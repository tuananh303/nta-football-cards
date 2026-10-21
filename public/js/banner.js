// Tab "Banner" trong trang quản trị: xem trước, thêm/sửa/xóa, sắp xếp, bật/tắt slide đầu trang.
import { icon } from './icons.js';
import { esc, api, toast, mediaHTML, norm, category } from './util.js';
import { compress, prepareOriginal, openEditor } from './editor.js';

const $ = (sel, root = document) => root.querySelector(sel);
const BANNER_EDGE = 1920;                 // ảnh nền banner lưu tối đa 1920px
const BANNER_RATIO = 10 / 3;              // tỉ lệ khung banner trên máy tính
const BANNER_ASPECTS = [
  { key: 'banner', label: 'Banner 10:3', value: BANNER_RATIO },
  { key: 'wide', label: 'Rộng 16:9', value: 16 / 9 },
  { key: 'free', label: 'Tự do', value: NaN }
];
const MAX_CARDS = 3;
const KIND_LABEL = { cards: 'Thẻ xòe', image: 'Ảnh nền' };

let app, confirmBox, handleAuthError;

export function setupBanner(appRef, helpers) {
  app = appRef;
  ({ confirmBox, handleAuthError } = helpers);
  app.hooks.renderBanner = renderTab;
}

// Tên hiển thị của slide (slide ảnh nền có thể không có tiêu đề)
const slideName = (s) => s.title || 'Ảnh nền không tiêu đề';

const fail = (err) => { if (!handleAuthError(err)) toast(err.message, 'error'); };

// Ảnh nhỏ đại diện cho slide trong danh sách
function thumbHTML(s) {
  if (s.kind === 'image' && s.image_url) return `<img src="${esc(s.image_url)}" alt="" loading="lazy">`;
  const cards = s.card_ids.map((id) => app.state.cards.find((c) => c.id === id)).filter(Boolean);
  if (!cards.length) return `<span class="slide-thumb-auto">3 món nổi bật</span>`;
  return `<span class="slide-thumb-cards">${cards.map((c) => `<img src="${esc(c.front_url)}" alt="" loading="lazy">`).join('')}</span>`;
}

// ================== Danh sách slide ==================
function renderTab(main) {
  const slides = app.state.slides;
  const active = slides.filter((s) => s.active);
  main.innerHTML = `<div class="page">
    <div class="page-head">
      <div>
        <h1 class="page-title">Banner</h1>
        <p class="page-sub">Các slide chạy ở đầu trang Bộ sưu tập. Đang hiện ${active.length} / ${slides.length} slide.</p>
      </div>
      <button class="btn primary" type="button" data-slide-new>${icon('plus')} Thêm slide</button>
    </div>

    <h2 class="form-section">Xem trước</h2>
    ${active.length ? '' : `<p class="page-sub" style="margin:-6px 0 12px">Chưa có slide nào đang bật nên trang đang hiện banner mặc định.</p>`}
    <div class="banner-preview">${app.heroHTML(active)}</div>

    <h2 class="form-section" style="margin-top:32px">Danh sách slide</h2>
    ${slides.length ? `<ol class="slide-list">
      ${slides.map((s, i) => `<li class="slide-row${s.active ? '' : ' is-off'}">
        <div class="slide-thumb">${thumbHTML(s)}</div>
        <div class="slide-info">
          <div class="slide-name">${esc(slideName(s))}</div>
          <div class="slide-meta">
            <span class="badge">${KIND_LABEL[s.kind]}</span>
            <span class="slide-state">${s.active ? 'Đang hiện' : 'Đang ẩn'}</span>
          </div>
        </div>
        <div class="slide-actions">
          <button class="btn sm icon-only" type="button" data-move="${s.id}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Đưa “${esc(slideName(s))}” lên trước" title="Lên trước">${icon('chevronU', 18)}</button>
          <button class="btn sm icon-only" type="button" data-move="${s.id}" data-dir="1" ${i === slides.length - 1 ? 'disabled' : ''} aria-label="Đưa “${esc(slideName(s))}” ra sau" title="Ra sau">${icon('chevronD', 18)}</button>
          <button class="btn sm" type="button" data-toggle="${s.id}" aria-pressed="${s.active}">${icon(s.active ? 'eye' : 'eyeOff', 16)} ${s.active ? 'Ẩn' : 'Hiện'}</button>
          <button class="btn sm" type="button" data-slide-edit="${s.id}">${icon('edit', 16)} Sửa</button>
          <button class="btn sm icon-only danger" type="button" data-slide-del="${s.id}" aria-label="Xóa slide “${esc(slideName(s))}”" title="Xóa">${icon('trash', 16)}</button>
        </div>
      </li>`).join('')}
    </ol>` : `<section class="empty">
      <div class="empty-art">${icon('slides', 36)}</div>
      <h2>Chưa có slide nào</h2>
      <p>Tạo slide "Thẻ xòe" để khoe vài thẻ đẹp nhất, hoặc slide "Ảnh nền" với ảnh chụp cả bộ sưu tập.</p>
      <button class="btn primary" type="button" data-slide-new>${icon('plus')} Thêm slide đầu tiên</button>
    </section>`}
  </div>`;

  app.initCarousel(main.querySelector('.banner-preview .carousel'));
  // Trong xem trước, nút trên slide không chuyển trang
  main.querySelectorAll('.banner-preview .hero-btn').forEach((a) => a.addEventListener('click', (e) => e.preventDefault()));
  main.onclick = onListClick;
}

async function reloadSlides() {
  app.state.slides = (await api('/api/slides')).slides;
  renderTab($('#main'));
}

async function onListClick(e) {
  const t = e.target.closest('button');
  if (!t) return;
  const find = (id) => app.state.slides.find((s) => s.id === Number(id));
  try {
    if (t.hasAttribute('data-slide-new')) return openSlideForm(null);
    if (t.dataset.slideEdit) return openSlideForm(find(t.dataset.slideEdit));
    if (t.dataset.toggle) {
      const s = find(t.dataset.toggle);
      await api(`/api/slides/${s.id}/active`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !s.active }) });
      await reloadSlides();
      toast(s.active ? `Đã ẩn slide “${slideName(s)}”.` : `Đã hiện slide “${slideName(s)}”.`);
      return $(`[data-toggle="${s.id}"]`)?.focus();
    }
    if (t.dataset.move) {
      const ids = app.state.slides.map((s) => s.id);
      const i = ids.indexOf(Number(t.dataset.move));
      const j = i + Number(t.dataset.dir);
      if (j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      await api('/api/slides/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) });
      await reloadSlides();
      // Giữ focus trên nút vừa bấm (nếu còn bấm được) để bấm tiếp bằng bàn phím
      return ($(`[data-move="${ids[j]}"][data-dir="${t.dataset.dir}"]:not([disabled])`) || $(`[data-move="${ids[j]}"]:not([disabled])`))?.focus();
    }
    if (t.dataset.slideDel) {
      const s = find(t.dataset.slideDel);
      const ok = await confirmBox({ title: 'Xóa slide này?', message: `Slide “${slideName(s)}” sẽ bị xóa vĩnh viễn. Các thẻ trong album không bị ảnh hưởng.`, okLabel: 'Xóa slide' });
      if (!ok) return;
      await api(`/api/slides/${s.id}`, { method: 'DELETE' });
      await reloadSlides();
      toast(`Đã xóa slide “${slideName(s)}”.`);
    }
  } catch (err) { fail(err); }
}

// ================== Form thêm / sửa slide ==================
function openSlideForm(slide) {
  const d = $('#slideDialog');
  const isEdit = !!slide;
  const s = slide || { kind: 'cards', title: '', subtitle: '', button_label: '', button_link: '', card_ids: [], active: true };
  const img = { url: s.image_url, w: s.image_w, h: s.image_h, blob: null, original: null, settings: null, blobUrl: null };
  const picked = new Set(s.card_ids);
  let dirty = false;
  let q = '';

  d.innerHTML = `<form id="slideForm" novalidate>
    <div class="sheet-head">
      <h2 id="slideTitle">${isEdit ? 'Sửa slide' : 'Thêm slide'}</h2>
      <button class="btn icon-only ghost" type="button" data-act="close" aria-label="Đóng">${icon('x')}</button>
    </div>
    <div class="sheet-body">
      <fieldset class="fgroup">
        <legend class="lbl-row">Kiểu slide</legend>
        <div class="kind-pick">
          <label class="kind-opt"><input type="radio" name="kind" value="cards" ${s.kind === 'cards' ? 'checked' : ''}>
            <span><strong>Thẻ xòe</strong><small>Chữ bên trái, tối đa 3 thẻ xòe bên phải</small></span></label>
          <label class="kind-opt"><input type="radio" name="kind" value="image" ${s.kind === 'image' ? 'checked' : ''}>
            <span><strong>Ảnh nền</strong><small>Ảnh lớn phủ cả banner, chữ nằm trên ảnh</small></span></label>
        </div>
      </fieldset>

      <div class="form-grid" style="margin-top:18px">
        <div class="wide">
          <label class="lbl-row" for="sTitle">Tiêu đề <span class="req" id="sTitleReq">*</span><span class="hint" id="sTitleOpt"> (không bắt buộc với slide ảnh nền)</span></label>
          <input class="field" id="sTitle" name="title" maxlength="160" value="${esc(s.title)}" aria-describedby="sTitleErr">
          <p class="err" id="sTitleErr" hidden></p>
        </div>
        <div class="wide">
          <label class="lbl-row" for="sSub">Mô tả</label>
          <textarea class="field" id="sSub" name="subtitle" rows="2" maxlength="400">${esc(s.subtitle)}</textarea>
        </div>
        <div>
          <label class="lbl-row" for="sBtn">Chữ trên nút (tùy chọn)</label>
          <input class="field" id="sBtn" name="button_label" maxlength="60" placeholder="VD: Xem thẻ" value="${esc(s.button_label)}">
        </div>
        <div>
          <label class="lbl-row" for="sLink">Nút dẫn tới</label>
          <input class="field" id="sLink" name="button_link" maxlength="300" list="sLinks" placeholder="VD: #thong-ke" value="${esc(s.button_link)}" aria-describedby="sLinkHint sLinkErr">
          <p class="hint" id="sLinkHint">Gõ #thong-ke (trang Thống kê), #the-số (mở một thẻ) hoặc địa chỉ https://…</p>
          <p class="err" id="sLinkErr" hidden></p>
          <datalist id="sLinks">
            <option value="#thong-ke">Trang Thống kê</option>
            ${app.state.cards.map((c) => `<option value="#the-${c.id}">Thẻ ${esc(c.player_name)}</option>`).join('')}
          </datalist>
        </div>
      </div>

      <section class="kind-panel" data-panel="image">
        <h3 class="form-section" style="margin-top:22px">Ảnh nền</h3>
        <div class="banner-drop drop" tabindex="0" role="button" id="sDrop"></div>
        <div class="slot-actions" id="sImgActions"></div>
        <p class="err" id="sImgErr" hidden></p>
        <p class="hint">Ảnh được giữ trọn và tự thu vừa khung banner (10:3), phần trống phủ bằng chính ảnh làm mờ. Muốn ảnh phủ kín khung, bấm "Chỉnh sửa" để cắt theo khung 10:3. Ảnh được nén JPEG, tối đa ${BANNER_EDGE}px.</p>
        <input type="file" accept="image/*,.heic,.heif" id="sFile" hidden>
      </section>

      <section class="kind-panel" data-panel="cards">
        <h3 class="form-section" style="margin-top:22px">Món hiển thị <span class="pick-count" id="sCount"></span></h3>
        <p class="hint" style="margin:-6px 0 10px">Chọn tối đa ${MAX_CARDS} món (thẻ, áo, poster, tượng). Không chọn món nào thì slide tự lấy 3 món nổi bật nhất.</p>
        <label class="search" style="max-width:360px;margin-bottom:12px"><span class="sr-only">Tìm món</span>${icon('search')}
          <input id="sQ" type="search" placeholder="Tìm theo tên, CLB, loại…" autocomplete="off"></label>
        <div class="pick-grid" id="sPick" role="group" aria-label="Chọn thẻ cho slide"></div>
      </section>

      <label class="check" style="margin-top:18px"><input type="checkbox" name="active" ${s.active ? 'checked' : ''}> Hiển thị slide này trên banner</label>
    </div>
    <div class="sheet-foot">
      <button class="btn" type="button" data-act="close">Hủy</button>
      <button class="btn primary" type="submit" id="sSave">${icon('check')} ${isEdit ? 'Lưu thay đổi' : 'Thêm slide'}</button>
    </div>
  </form>`;

  const form = $('#slideForm', d);
  const kind = () => form.kind.value;

  const showPanels = () => {
    d.querySelectorAll('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== kind(); });
    $('#sTitleReq', d).hidden = kind() === 'image';
    $('#sTitleOpt', d).hidden = kind() !== 'image';
  };

  // ----- Ảnh nền -----
  function renderImage() {
    const drop = $('#sDrop', d);
    drop.classList.toggle('has', !!img.url);
    drop.setAttribute('aria-label', img.url ? 'Đổi ảnh nền: bấm để chọn ảnh khác' : 'Chọn hoặc kéo thả ảnh nền');
    drop.innerHTML = img.url
      ? `<img src="${esc(img.url)}" alt="Xem trước ảnh nền"><span class="drop-hint">${icon('upload', 18)} Đổi ảnh</span>`
      : `<div>${icon('upload', 26)}<div>Bấm để chọn ảnh hoặc kéo thả vào đây</div></div>`;
    $('#sImgActions', d).innerHTML = img.url
      ? `<button class="btn sm" type="button" data-img-edit>${icon('crop', 16)} Chỉnh sửa</button>
         <button class="btn sm" type="button" data-img-pick>${icon('upload', 16)} Đổi ảnh</button>`
      : '';
  }
  function imgError(msg) {
    const e = $('#sImgErr', d);
    e.hidden = !msg;
    e.innerHTML = msg ? `${icon('alert', 16)} <span>${esc(msg)}</span>` : '';
    if (msg) toast(msg, 'error');
  }
  function setImage(out) {
    if (img.blobUrl) URL.revokeObjectURL(img.blobUrl);
    Object.assign(img, { blob: out.blob, w: out.w, h: out.h });
    img.url = img.blobUrl = URL.createObjectURL(out.blob);
    dirty = true;
    imgError('');
    renderImage();
  }
  async function acceptImage(file) {
    if (!file) return;
    const looksImage = file.type ? file.type.startsWith('image/') : /\.(jpe?g|jfif|png|webp|heic|heif|avif)$/i.test(file.name);
    if (!looksImage) return imgError(`“${file.name}” không phải file ảnh.`);
    $('#sDrop', d).innerHTML = '<div class="spinner" role="img" aria-label="Đang xử lý ảnh"></div>';
    try {
      const original = await prepareOriginal(file);
      // Giữ trọn ảnh (không cắt): banner tự thu ảnh cho vừa khung; muốn cắt thì bấm "Chỉnh sửa"
      img.original = original;
      img.settings = null;
      setImage(await compress(original, BANNER_EDGE));
    } catch (err) {
      console.error('Không xử lý được ảnh', err);
      renderImage();
      imgError(`Không đọc được ảnh “${file.name}”. Hãy thử ảnh JPEG hoặc PNG khác.`);
    }
  }
  async function editImage() {
    try {
      if (!img.original) img.original = await prepareOriginal(await (await fetch(img.url)).blob());
    } catch { return imgError('Không tải được ảnh để chỉnh sửa.'); }
    const out = await openEditor(img.original, img.settings, 'Chỉnh ảnh nền banner', { aspects: BANNER_ASPECTS, maxEdge: BANNER_EDGE });
    if (!out) return;
    img.settings = out.settings;
    setImage(out);
  }

  // ----- Chọn thẻ -----
  function renderPick() {
    const list = app.state.cards.filter((c) => !q || norm(`${c.player_name} ${c.team} ${category(c.category).label}`).includes(norm(q)));
    $('#sCount', d).textContent = `(${picked.size}/${MAX_CARDS})`;
    $('#sPick', d).innerHTML = list.length ? list.map((c) => {
      const on = picked.has(c.id);
      return `<label class="pick${on ? ' on' : ''}">
        <input type="checkbox" value="${c.id}" ${on ? 'checked' : ''} ${!on && picked.size >= MAX_CARDS ? 'disabled' : ''}>
        ${mediaHTML(c.front_url, c.front_w, c.front_h, '')}
        <span class="pick-name">${esc(c.player_name)}</span>
        <span class="pick-cat">${category(c.category).label}</span>
      </label>`;
    }).join('') : '<p class="page-sub">Không có món nào khớp.</p>';
  }

  showPanels();
  renderImage();
  renderPick();

  // ----- Sự kiện -----
  d.onclick = (e) => {
    const t = e.target.closest('button, #sDrop');
    if (!t) return;
    if (t.dataset.act === 'close') return tryClose();
    if (t.id === 'sDrop' || t.hasAttribute('data-img-pick')) return $('#sFile', d).click();
    if (t.hasAttribute('data-img-edit')) return editImage();
  };
  d.onkeydown = (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.id === 'sDrop') { e.preventDefault(); $('#sFile', d).click(); }
  };
  d.onchange = (e) => {
    const t = e.target;
    if (t.id === 'sFile') { acceptImage(t.files[0]); t.value = ''; return; }
    if (t.name === 'kind') { showPanels(); dirty = true; return; }
    if (t.closest('#sPick')) {
      const id = Number(t.value);
      t.checked ? picked.add(id) : picked.delete(id);
      dirty = true;
      renderPick();
      $(`#sPick input[value="${id}"]`, d)?.focus();
    }
  };
  d.oninput = (e) => {
    if (e.target.id === 'sQ') { q = e.target.value; renderPick(); return; }
    dirty = true;
  };
  const drop = $('#sDrop', d);
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); acceptImage(e.dataTransfer.files[0]); };

  async function tryClose() {
    if (dirty && !(await confirmBox({ title: 'Bỏ các thay đổi?', message: 'Nội dung slide bạn vừa nhập sẽ không được lưu.', okLabel: 'Bỏ thay đổi' }))) return;
    d.close();
  }
  d.oncancel = (e) => { e.preventDefault(); tryClose(); };
  d.onclose = () => { if (img.blobUrl) URL.revokeObjectURL(img.blobUrl); };

  // ----- Lưu -----
  form.onsubmit = async (e) => {
    e.preventDefault();
    const data = {
      kind: kind(),
      title: form.title.value.trim(),
      subtitle: form.subtitle.value.trim(),
      button_label: form.button_label.value.trim(),
      button_link: form.button_link.value.trim(),
      card_ids: [...picked],
      active: form.active.checked
    };
    // Kiểm tra, báo lỗi ngay cạnh ô nhập
    const errs = [];
    const setErr = (id, field, msg) => {
      const el = $(id, d);
      el.hidden = !msg; el.textContent = msg || '';
      if (field) field.setAttribute('aria-invalid', msg ? 'true' : 'false');
      if (msg) errs.push(field || $('#sDrop', d));
    };
    setErr('#sTitleErr', form.title, data.title || data.kind === 'image' ? '' : 'Slide "Thẻ xòe" cần có tiêu đề.');
    const linkOk = !data.button_link || /^#[\w\-/]*$/.test(data.button_link) || /^\/(?!\/)/.test(data.button_link) || /^https?:\/\/\S+$/i.test(data.button_link);
    setErr('#sLinkErr', form.button_link,
      !linkOk ? 'Liên kết phải bắt đầu bằng #, / hoặc https://'
        : data.button_label && !data.button_link ? 'Nút bấm cần có liên kết.' : '');
    if (data.kind === 'image' && !img.url) { imgError('Slide "Ảnh nền" cần có ảnh.'); errs.push($('#sDrop', d)); }
    if (errs.length) return errs[0].focus();

    const body = new FormData();
    body.append('data', JSON.stringify(data));
    if (img.blob && data.kind === 'image') body.append('image', img.blob, 'banner.jpg');
    const btn = $('#sSave', d);
    btn.disabled = true; btn.textContent = 'Đang lưu…';
    try {
      await api(isEdit ? `/api/slides/${slide.id}` : '/api/slides', { method: isEdit ? 'PUT' : 'POST', body });
      dirty = false;
      d.close();
      await reloadSlides();
      toast(isEdit ? `Đã lưu slide “${slideName(data)}”.` : `Đã thêm slide “${slideName(data)}”.`);
    } catch (err) {
      fail(err);
      btn.disabled = false; btn.innerHTML = `${icon('check')} ${isEdit ? 'Lưu thay đổi' : 'Thêm slide'}`;
    }
  };

  d.showModal();
  $('#sTitle', d).focus();
}
