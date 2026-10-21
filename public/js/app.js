// Ứng dụng chính: tải danh sách thẻ, tìm kiếm/lọc/sắp xếp, hiển thị lưới/danh sách,
// xem chi tiết (lật 3D, phóng to) và trang thống kê. Trang /admin nạp thêm admin.js.
import { icon } from './icons.js';
import { RARITY, CONDITION, CATEGORIES, category, rarityLabel, conditionLabel, esc, norm, fmtDate, api, toast, mediaHTML, store } from './util.js';

const IS_ADMIN_PAGE = document.body.dataset.page === 'admin';
const main = document.getElementById('main');
const detailDialog = document.getElementById('detailDialog');
const zoomDialog = document.getElementById('zoomDialog');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

const state = {
  cards: [],
  slides: [],
  admin: false,
  view: 'collection',
  layout: store.get('fc.layout', 'grid'),
  sort: store.get('fc.sort', 'created_desc'),
  q: '',
  // Bộ lọc cột trái: mỗi nhóm là tập giá trị được tick
  // Loại đang xem: 'all' hoặc card | jersey | poster | figure
  category: 'all',
  filters: { rarity: new Set(), condition: new Set(), team: new Set(), manufacturer: new Set(), feature: new Set() },
  expanded: { team: false, manufacturer: false },
  // Máy tính: hiện cột lọc sẵn; điện thoại: cột lọc mở dạng ngăn kéo khi bấm nút
  showFilters: matchMedia('(min-width: 1024px)').matches,
  detailId: null
};

// Các hàm admin.js gắn vào (khi ở trang quản trị)
// renderBanner: vẽ tab "Banner" (chỉ có ở trang quản trị)
const hooks = { topbar: null, detailActions: null, emptyAction: null, cardFav: null, renderBanner: null };

// ================== Tải dữ liệu ==================
async function loadCards() {
  const [data, slides] = await Promise.all([api('/api/cards'), api('/api/slides')]);
  state.cards = data.cards;
  state.admin = data.admin;
  state.slides = slides.slides;
}

// ================== Lọc + sắp xếp ==================
const SORTS = [
  { key: 'created_desc', label: 'Mới thêm gần đây' },
  { key: 'created_asc', label: 'Thêm lâu nhất' },
  { key: 'name_asc', label: 'Tên A–Z' },
  { key: 'name_desc', label: 'Tên Z–A' },
  { key: 'year_desc', label: 'Năm phát hành mới nhất' },
  { key: 'year_asc', label: 'Năm phát hành cũ nhất' }
];

function activeFilterCount() {
  const f = state.filters;
  return f.rarity.size + f.condition.size + f.team.size + f.manufacturer.size + f.feature.size;
}

// Có chữ ký: thẻ thuộc độ hiếm "Chữ ký", các loại khác có đánh dấu "Có chữ ký"
const isSigned = (c) => (c.category === 'card' ? c.rarity === 'autograph' : c.signed);
const inCategory = (c) => state.category === 'all' || c.category === state.category;
const itemsInView = () => state.cards.filter(inCategory);

// Khóa lọc ứng với từng nhóm (team/manufacturer trống được gom vào nhóm "Chưa rõ")
const FILTER_FIELD = { rarity: 'rarity', condition: 'card_condition', team: 'team', manufacturer: 'manufacturer' };

function visibleCards() {
  const f = state.filters;
  const q = norm(state.q);
  let list = itemsInView().filter((c) => {
    // Độ hiếm chỉ áp dụng cho thẻ
    if (f.rarity.size && (c.category !== 'card' || !f.rarity.has(c.rarity))) return false;
    if (f.feature.has('signed') && !isSigned(c)) return false;
    if (f.condition.size && !f.condition.has(c.card_condition)) return false;
    if (f.team.size && !f.team.has(c.team || '')) return false;
    if (f.manufacturer.size && !f.manufacturer.has(c.manufacturer || '')) return false;
    if (q) {
      const hay = norm([c.player_name, c.team, c.set_name, c.manufacturer, category(c.category).label, c.extra?.signed_by, ...(c.tags || [])].join(' '));
      if (!q.split(/\s+/).every((word) => hay.includes(word))) return false;
    }
    return true;
  });
  const byName = (a, b) => a.player_name.localeCompare(b.player_name, 'vi');
  const sorters = {
    created_desc: (a, b) => b.created_at - a.created_at,
    created_asc: (a, b) => a.created_at - b.created_at,
    name_asc: byName,
    name_desc: (a, b) => byName(b, a),
    // Thẻ không có năm luôn xếp cuối
    year_desc: (a, b) => (b.year ?? -1) - (a.year ?? -1) || byName(a, b),
    year_asc: (a, b) => (a.year ?? 9999) - (b.year ?? 9999) || byName(a, b)
  };
  return list.sort(sorters[state.sort] || sorters.created_desc);
}

// Đếm số thẻ cho từng lựa chọn trong một nhóm lọc, sắp theo số lượng giảm dần
function facet(group) {
  const map = new Map();
  if (group === 'feature') {
    map.set('signed', itemsInView().filter(isSigned).length);
    return map;
  }
  const field = FILTER_FIELD[group];
  itemsInView()
    .filter((c) => group !== 'rarity' || c.category === 'card')
    .forEach((c) => { const k = c[field] || ''; map.set(k, (map.get(k) || 0) + 1); });
  return map;
}

// ================== Hiển thị thẻ ==================
// Ô thẻ dạng "kệ trưng bày": nền panel, nhãn độ hiếm góc trên, số thẻ giới hạn dạng viên nhỏ,
// tên + CLB/mùa giải ở dưới và nút "Xem chi tiết"
function cardHTML(c) {
  const fav = state.admin
    ? `<button class="tc-fav" type="button" data-fav="${c.id}" aria-pressed="${c.favorite}" aria-label="${c.favorite ? 'Bỏ yêu thích' : 'Đánh dấu yêu thích'}">${icon('heart', 18)}</button>`
    : c.favorite ? `<span class="tc-favmark" title="Yêu thích">${icon('heart', 20)}<span class="sr-only">Yêu thích</span></span>` : '';
  const cat = category(c.category);
  const isCard = c.category === 'card';
  const tags = isCard
    ? `<span class="ctile-rarity">${rarityLabel(c.rarity)}</span>
        ${c.card_number ? `<span class="ctile-pill" title="Số thẻ trong bộ">${esc(c.card_number)}</span>` : ''}`
    : `<span class="ctile-rarity">${cat.label}</span>
        ${c.signed ? '<span class="ctile-pill signed">Có chữ ký</span>' : ''}`;
  const photos = !isCard && c.gallery.length > 1
    ? `<span class="ctile-photos" title="${c.gallery.length} ảnh">${icon('image', 14)} ${c.gallery.length}</span>` : '';
  // Thẻ: viền màu theo độ hiếm; loại khác: khung trưng bày không viền màu
  return `<article class="tc ctile" data-cat="${c.category}" ${isCard ? `data-rarity="${esc(c.rarity)}"` : ''}>
    <div class="ctile-stage">
      ${fav}
      <div class="ctile-tags">${tags}</div>
      <button class="tc-hit" type="button" data-open="${c.id}" aria-label="Xem ${cat.label.toLowerCase()} ${esc(c.player_name)}">
        <div class="tc-frame">
          ${mediaHTML(c.front_url, c.front_w, c.front_h, `${cat.label} ${c.player_name}`, { ratio: cat.ratio })}
          <span class="tc-shine"></span>
          ${photos}
        </div>
      </button>
    </div>
    <h3 class="ctile-name" title="${esc(c.player_name)}">${esc(c.player_name)}</h3>
    <p class="ctile-sub">${esc([c.team || 'Chưa rõ CLB', c.season].filter(Boolean).join(', '))}</p>
    <button class="btn outline ctile-btn" type="button" data-open="${c.id}">Xem chi tiết</button>
  </article>`;
}

function rowHTML(c) {
  const cat = category(c.category);
  return `<button class="row" type="button" data-open="${c.id}" ${c.category === 'card' ? `data-rarity="${esc(c.rarity)}"` : 'data-cat="other"'}>
    <div class="row-thumb">${mediaHTML(c.front_url, c.front_w, c.front_h, '', { ratio: cat.ratio })}</div>
    <div style="min-width:0">
      <div class="row-name">${esc(c.player_name)}${c.favorite ? ` <span class="fav-on" title="Yêu thích">${icon('heart', 15)}</span>` : ''}</div>
      <div class="row-small">${esc(c.team || 'Chưa rõ CLB')}</div>
    </div>
    <div class="row-small hide-sm">${esc([c.manufacturer, c.set_name].filter(Boolean).join(', ') || '—')}<br>${esc(c.season || '')}</div>
    <div class="row-small hide-sm">${esc(c.card_number ? `Số ${c.card_number}` : '')}<br>${esc(conditionLabel(c.card_condition))}</div>
    ${c.category === 'card'
      ? `<span class="badge" data-r="${esc(c.rarity)}">${rarityLabel(c.rarity)}</span>`
      : `<span class="badge cat-badge">${cat.label}${c.signed ? ', có chữ ký' : ''}</span>`}
  </button>`;
}

function emptyHTML() {
  const cta = state.admin && hooks.emptyAction
    ? `<button class="btn primary" type="button" data-action="add">${icon('plus')} Thêm món đầu tiên</button>`
    : '';
  return `<section class="empty">
    <div class="empty-art">${icon('cards', 36)}</div>
    <h2>Bộ sưu tập đang chờ món đầu tiên</h2>
    <p>${state.admin
      ? 'Chọn loại (thẻ, áo đấu, poster hay tượng), chụp hoặc tải ảnh, điền tên cầu thủ là xong.'
      : 'Chủ bộ sưu tập chưa đưa món nào lên. Hãy quay lại sau nhé.'}</p>
    ${cta}
  </section>`;
}

// ================== Trang bộ sưu tập ==================
function renderCollection() {
  if (!state.cards.length) {
    main.innerHTML = `<div class="page">${emptyHTML()}</div>`;
    return;
  }
  const sorts = SORTS.filter((s) => !s.admin || state.admin);
  if (!sorts.some((s) => s.key === state.sort)) state.sort = 'created_desc';

  main.innerHTML = `<div class="page shop-page">
    ${heroHTML()}

    <nav class="cat-tabs" aria-label="Loại món sưu tập">
      ${[{ key: 'all', label: 'Tất cả', plural: 'Tất cả', slug: '' }, ...CATEGORIES].map((t) => {
        const n = t.key === 'all' ? state.cards.length : state.cards.filter((c) => c.category === t.key).length;
        return `<a href="#${t.slug ? `loai-${t.slug}` : ''}" class="cat-tab" ${state.category === t.key ? 'aria-current="page"' : ''}>${t.plural}<span class="cat-n">${n}</span></a>`;
      }).join('')}
    </nav>

    <div class="shop-bar">
      <button class="btn pill-btn" type="button" id="toggleFilters" aria-expanded="${state.showFilters}" aria-controls="filters"></button>
      <span class="shop-count" id="shopCount" aria-live="polite"></span>
      <label class="search">
        <span class="sr-only">Tìm trong bộ sưu tập</span>
        ${icon('search')}
        <input id="q" type="search" placeholder="Tìm theo tên cầu thủ, CLB, người ký, tag…" value="${esc(state.q)}" autocomplete="off">
      </label>
      <label class="shop-sort"><span class="sr-only">Sắp xếp</span>
        <select class="field" id="sort">${sorts.map((s) => `<option value="${s.key}" ${s.key === state.sort ? 'selected' : ''}>${s.label}</option>`).join('')}</select>
      </label>
      <div class="segmented" role="group" aria-label="Kiểu hiển thị">
        <button type="button" data-layout="grid" aria-pressed="${state.layout === 'grid'}" aria-label="Dạng lưới album">${icon('grid')}</button>
        <button type="button" data-layout="list" aria-pressed="${state.layout === 'list'}" aria-label="Dạng danh sách">${icon('list')}</button>
      </div>
    </div>

    <div class="shop${state.showFilters ? ' filters-open' : ''}" id="shop">
      <div class="side-scrim" data-action="closeFilters" aria-hidden="true"></div>
      <aside class="side" id="filters" aria-label="Bộ lọc"></aside>
      <div class="shop-main">
        <p class="result-line" id="resultLine"></p>
        <div id="results"></div>
      </div>
    </div>

    <a class="promo" href="#thong-ke">
      <div>
        <h2>Bộ sưu tập qua những con số</h2>
        <p>Xem bộ sưu tập chia theo loại, độ hiếm, câu lạc bộ và hãng.</p>
      </div>
      <span class="btn primary">${icon('chart')} Xem thống kê</span>
    </a>
  </div>`;
  renderFilters();
  renderResults();
  initCarousel(main.querySelector('.carousel'));
}

// ================== Banner đầu trang (slide) ==================
// Slide do admin tạo ở tab Banner. Hai kiểu: "cards" (chữ + tối đa 3 thẻ xòe) và "image" (ảnh nền + chữ).
// Chưa có slide nào đang bật thì hiện một slide mặc định với 3 thẻ hiếm nhất.
const RARITY_RANK = { super_rare: 5, autograph: 4, limited: 3, rare: 2, common: 1 };
const rarest = (n) => [...state.cards]
  .map((c) => ({ ...c, _rank: c.category === 'card' ? RARITY_RANK[c.rarity] || 0 : c.signed ? 3.5 : 0.5 }))
  .sort((a, b) => b._rank - a._rank || b.created_at - a.created_at)
  .slice(0, n);

function slideButtonHTML(s) {
  if (!s.button_label || !s.button_link) return '';
  const external = /^https?:/i.test(s.button_link);
  return `<a class="btn primary hero-btn" href="${esc(s.button_link)}"${external ? ' target="_blank" rel="noopener"' : ''}>${esc(s.button_label)}</a>`;
}

// Một slide; slide đầu tiên dùng <h1>, các slide sau dùng <h2>
function slideHTML(s, first) {
  const tag = first ? 'h1' : 'h2';
  const hasText = s.title || s.subtitle || slideButtonHTML(s);
  const text = hasText ? `<div class="hero-text">
      ${s.title ? `<${tag} class="hero-title">${esc(s.title)}</${tag}>` : ''}
      ${s.subtitle ? `<p>${esc(s.subtitle)}</p>` : ''}
      ${slideButtonHTML(s)}
    </div>` : '';
  if (s.kind === 'image' && s.image_url) {
    // Slide chỉ có ảnh: không phủ lớp tối; trang vẫn cần một tiêu đề h1 cho trình đọc màn hình
    return `<div class="hero hero-image${hasText ? '' : ' bare'}">
      ${first && !s.title ? '<h1 class="sr-only">Bộ Sưu Tập Bóng Đá</h1>' : ''}
      <img class="hero-bg-fill" src="${esc(s.image_url)}" alt="" aria-hidden="true" ${first ? '' : 'loading="lazy"'} decoding="async">
      <img class="hero-bg" src="${esc(s.image_url)}" alt="${hasText ? '' : 'Ảnh banner bộ sưu tập bóng đá'}" ${first ? '' : 'loading="lazy"'} decoding="async">
      ${text}
    </div>`;
  }
  const picked = (s.card_ids || []).map((id) => state.cards.find((c) => c.id === id)).filter(Boolean);
  const stars = picked.length ? picked : rarest(3);
  return `<div class="hero">
    ${text}
    <div class="hero-fan" aria-hidden="true">
      ${stars.map((c, i) => `<div class="fan-card fan-${i}" data-rarity="${esc(c.rarity)}">${mediaHTML(c.front_url, c.front_w, c.front_h, '', { lazy: !first })}</div>`).join('')}
    </div>
  </div>`;
}

export function heroHTML(slides = state.slides.filter((s) => s.active)) {
  if (!slides.length) {
    const teams = new Set(state.cards.map((c) => c.team).filter(Boolean)).size;
    slides = [{
      kind: 'cards', card_ids: [],
      title: 'Khám phá toàn bộ album',
      subtitle: `Thẻ, áo đấu, poster chữ ký và tượng cầu thủ, mỗi món là một khoảnh khắc trên sân cỏ. ${state.cards.length} món của ${teams} câu lạc bộ và đội tuyển.`
    }];
  }
  const many = slides.length > 1;
  return `<section class="carousel" ${many ? 'aria-roledescription="carousel"' : ''} aria-label="Banner">
    <div class="carousel-track">
      ${slides.map((s, i) => `<div class="carousel-slide" ${many ? `role="group" aria-roledescription="slide" aria-label="${i + 1} / ${slides.length}"` : ''}>${slideHTML(s, i === 0)}</div>`).join('')}
    </div>
    ${many ? `
      <button class="carousel-nav prev" type="button" data-dir="-1" aria-label="Slide trước">${icon('chevronL', 22)}</button>
      <button class="carousel-nav next" type="button" data-dir="1" aria-label="Slide sau">${icon('chevronR', 22)}</button>
      <div class="carousel-bar">
        <button class="carousel-play" type="button" data-play aria-label="Tạm dừng tự chuyển slide">${icon('pause', 16)}</button>
        <div class="carousel-dots">
          ${slides.map((s, i) => `<button type="button" data-go="${i}" aria-label="Chuyển tới slide ${i + 1}${s.title ? `: ${esc(s.title)}` : ''}"></button>`).join('')}
        </div>
      </div>` : ''}
  </section>`;
}

// Điều khiển slide: tự chuyển mỗi 6,5 giây (tắt khi người dùng bật giảm chuyển động),
// dừng khi rê chuột / focus, nút trước-sau, chấm, vuốt trên điện thoại
let carouselTimer = null;
export function initCarousel(root) {
  clearInterval(carouselTimer);
  if (!root) return;
  const track = root.querySelector('.carousel-track');
  const slides = [...root.querySelectorAll('.carousel-slide')];
  if (slides.length < 2) return;
  const dots = [...root.querySelectorAll('[data-go]')];
  const playBtn = root.querySelector('[data-play]');
  let index = 0;
  let playing = !reduceMotion.matches;
  let hovering = false;

  const go = (i) => {
    index = (i + slides.length) % slides.length;
    track.style.transform = `translateX(-${index * 100}%)`;
    slides.forEach((s, k) => { s.inert = k !== index; });
    dots.forEach((d, k) => d.setAttribute('aria-current', k === index ? 'true' : 'false'));
  };
  const tick = () => { if (playing && !hovering && !document.hidden) go(index + 1); };
  const setPlaying = (p) => {
    playing = p;
    playBtn.innerHTML = icon(p ? 'pause' : 'play', 16);
    playBtn.setAttribute('aria-label', p ? 'Tạm dừng tự chuyển slide' : 'Bật tự chuyển slide');
  };

  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.dir) go(index + Number(b.dataset.dir));
    else if (b.dataset.go) go(Number(b.dataset.go));
    else if (b.hasAttribute('data-play')) setPlaying(!playing);
  });
  root.addEventListener('mouseenter', () => { hovering = true; });
  root.addEventListener('mouseleave', () => { hovering = false; });
  root.addEventListener('focusin', () => { hovering = true; });
  root.addEventListener('focusout', (e) => { if (!root.contains(e.relatedTarget)) hovering = false; });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') go(index - 1);
    if (e.key === 'ArrowRight') go(index + 1);
  });
  // Vuốt ngang trên màn hình cảm ứng
  let startX = null;
  root.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') startX = e.clientX; });
  root.addEventListener('pointerup', (e) => {
    if (startX === null) return;
    const dx = e.clientX - startX;
    startX = null;
    if (Math.abs(dx) > 50) go(index + (dx < 0 ? 1 : -1));
  });

  setPlaying(playing);
  go(0);
  carouselTimer = setInterval(tick, 6500);
}

// Cột lọc trái: mỗi nhóm là danh sách ô tick kèm số món, nhóm dài thì rút gọn còn 6 dòng.
// Nhóm "Độ hiếm" chỉ hiện khi đang xem Tất cả hoặc Thẻ.
function renderFilters() {
  const side = document.getElementById('filters');
  if (!side) return;
  const f = state.filters;
  const n = activeFilterCount();
  const group = (key, title, options) => {
    const counts = facet(key);
    const list = options || [...counts.keys()]
      .map((k) => ({ key: k, label: k || (key === 'team' ? 'Chưa rõ CLB' : 'Chưa rõ hãng') }))
      .sort((a, b) => counts.get(b.key) - counts.get(a.key) || a.label.localeCompare(b.label, 'vi'));
    const limit = key in state.expanded && !state.expanded[key] ? 6 : Infinity;
    const shown = list.filter((o, i) => i < limit || f[key].has(o.key));
    return `<fieldset class="side-group">
      <legend>${title}</legend>
      ${shown.map((o) => `<label class="side-check"${key === 'rarity' ? ` data-r="${o.key}"` : ''}>
        <input type="checkbox" data-filter="${key}" value="${esc(o.key)}" ${f[key].has(o.key) ? 'checked' : ''} ${counts.get(o.key) ? '' : 'disabled'}>
        ${key === 'rarity' ? '<span class="dot" aria-hidden="true"></span>' : ''}
        <span class="side-text">${esc(o.label)}</span>
        <span class="side-num">${counts.get(o.key) || 0}</span>
      </label>`).join('')}
      ${list.length > shown.length || (limit === Infinity && key in state.expanded && list.length > 6)
        ? `<button type="button" class="linklike side-more" data-expand="${key}">${state.expanded[key] ? 'Thu gọn' : `Xem thêm ${list.length - shown.length}`}</button>`
        : ''}
    </fieldset>`;
  };
  side.innerHTML = `
    <div class="side-head">
      <h2>Bộ lọc</h2>
      <button class="btn icon-only ghost side-close" type="button" data-action="closeFilters" aria-label="Đóng bộ lọc">${icon('x')}</button>
    </div>
    ${state.category === 'all' || state.category === 'card' ? group('rarity', state.category === 'all' ? 'Độ hiếm (thẻ)' : 'Độ hiếm', RARITY) : ''}
    ${group('feature', 'Đặc điểm', [{ key: 'signed', label: 'Có chữ ký' }])}
    ${group('condition', 'Tình trạng', CONDITION)}
    ${group('team', 'Câu lạc bộ / đội tuyển')}
    ${group('manufacturer', state.category === 'all' ? 'Hãng' : category(state.category).makerLabel)}
    <div class="side-foot">
      <button type="button" class="btn sm" data-action="reset" ${n ? '' : 'disabled'}>Xóa bộ lọc</button>
      <button type="button" class="btn sm primary side-apply" data-action="closeFilters" id="sideApply"></button>
    </div>`;
}

function setShowFilters(show) {
  state.showFilters = show;
  document.getElementById('shop')?.classList.toggle('filters-open', show);
  updateBar();
}

// Cập nhật nút "Ẩn/Hiện bộ lọc (n)", số kết quả
function updateBar(count) {
  const n = activeFilterCount();
  const btn = document.getElementById('toggleFilters');
  if (btn) {
    btn.setAttribute('aria-expanded', state.showFilters);
    btn.innerHTML = `${icon('filter', 18)} ${state.showFilters ? 'Ẩn bộ lọc' : 'Hiện bộ lọc'} (${n})`;
  }
  if (count !== undefined) {
    const el = document.getElementById('shopCount');
    if (el) el.textContent = `${count} món`;
    const apply = document.getElementById('sideApply');
    if (apply) apply.textContent = `Xem ${count} món`;
  }
}

function renderResults() {
  const list = visibleCards();
  const box = document.getElementById('results');
  const line = document.getElementById('resultLine');
  if (!box) return;
  updateBar(list.length);
  const filtered = state.q || activeFilterCount();
  line.innerHTML = filtered
    ? `Tìm thấy ${list.length} / ${itemsInView().length} món <button type="button" class="linklike" data-action="reset">Hiện tất cả</button>`
    : '';
  if (!list.length) {
    box.innerHTML = `<section class="empty"><h2>Không có món nào khớp</h2><p>Thử bỏ bớt bộ lọc hoặc tìm bằng từ khóa khác.</p><button class="btn" type="button" data-action="reset">Xóa tìm kiếm và bộ lọc</button></section>`;
    return;
  }
  box.innerHTML = state.layout === 'grid'
    ? `<div class="grid">${list.map(cardHTML).join('')}</div>`
    : `<div class="rows">${list.map(rowHTML).join('')}</div>`;
}

function resetFilters() {
  state.q = '';
  Object.assign(state.filters, { rarity: new Set(), condition: new Set(), team: new Set(), manufacturer: new Set(), feature: new Set() });
  const q = document.getElementById('q');
  if (q) q.value = '';
  renderFilters();
  renderResults();
}

// Sự kiện trong vùng nội dung (ủy quyền sự kiện cho phần tử cha)
main.addEventListener('input', (e) => {
  if (e.target.id === 'q') { state.q = e.target.value; renderResults(); }
});
main.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'sort') { state.sort = t.value; store.set('fc.sort', t.value); renderResults(); }
  // Tick/bỏ tick một ô lọc
  if (t.dataset.filter) {
    const set = state.filters[t.dataset.filter];
    t.checked ? set.add(t.value) : set.delete(t.value);
    renderResults();
    // Chỉ cập nhật trạng thái nút "Xóa bộ lọc", không vẽ lại cột lọc để giữ focus
    const reset = document.querySelector('.side-foot [data-action="reset"]');
    if (reset) reset.disabled = !activeFilterCount();
  }
});
main.addEventListener('click', (e) => {
  const t = e.target.closest('button, a');
  if (!t) return;
  if (t.dataset.fav && hooks.cardFav) return hooks.cardFav(Number(t.dataset.fav));
  if (t.dataset.open) return openDetail(Number(t.dataset.open), true);
  if (t.dataset.layout) {
    state.layout = t.dataset.layout; store.set('fc.layout', state.layout);
    main.querySelectorAll('[data-layout]').forEach((b) => b.setAttribute('aria-pressed', b === t));
    return renderResults();
  }
  if (t.id === 'toggleFilters') return setShowFilters(!state.showFilters);
  if (t.dataset.action === 'closeFilters') return setShowFilters(false);
  if (t.dataset.expand) {
    state.expanded[t.dataset.expand] = !state.expanded[t.dataset.expand];
    renderFilters();
    return document.querySelector(`[data-expand="${t.dataset.expand}"]`)?.focus();
  }
  if (t.dataset.action === 'reset') return resetFilters();
  if (t.dataset.action === 'add' && hooks.emptyAction) return hooks.emptyAction();
});

// Phím Esc đóng ngăn kéo bộ lọc trên điện thoại
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.showFilters && matchMedia('(max-width: 1023px)').matches && !document.querySelector('dialog[open]')) {
    setShowFilters(false);
    document.getElementById('toggleFilters')?.focus();
  }
});

// Hiệu ứng nghiêng + ánh sáng theo vị trí chuột (chỉ với chuột, tắt khi người dùng giảm chuyển động)
main.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse' || reduceMotion.matches) return;
  const hit = e.target.closest('.tc-hit');
  if (!hit) return;
  const frame = hit.firstElementChild;
  const r = hit.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width;
  const y = (e.clientY - r.top) / r.height;
  hit.closest('.tc').classList.add('tilting');
  frame.style.setProperty('--ry', `${(x - 0.5) * 16}deg`);
  frame.style.setProperty('--rx', `${(0.5 - y) * 16}deg`);
  frame.style.setProperty('--mx', `${x * 100}%`);
  frame.style.setProperty('--my', `${y * 100}%`);
});
main.addEventListener('pointerout', (e) => {
  const hit = e.target.closest('.tc-hit');
  if (!hit || hit.contains(e.relatedTarget)) return;
  hit.closest('.tc').classList.remove('tilting');
  const frame = hit.firstElementChild;
  ['--rx', '--ry', '--mx', '--my'].forEach((p) => frame.style.removeProperty(p));
});

// ================== Chi tiết món ==================
let openedByPush = false;

function factsHTML(c) {
  const cat = category(c.category);
  const x = c.extra || {};
  const rows = [
    ['Mùa giải / năm', c.season],
    [cat.makerLabel, c.manufacturer],
    ...(c.category === 'card' ? [['Bộ sưu tập', c.set_name], ['Số thẻ trong bộ', c.card_number]] : []),
    ...(c.category === 'poster' ? [['Kích thước', x.size], ['Người ký', x.signed_by], ['Giấy chứng nhận (COA)', x.coa]] : []),
    ...(c.category === 'figure' ? [['Chiều cao', x.height], ['Chất liệu', x.material], ['Hộp', x.boxed ? 'Còn hộp' : '']] : []),
    ['Tình trạng', conditionLabel(c.card_condition)],
    ['Ngày sở hữu', fmtDate(c.acquired_date)]
  ].filter(([, v]) => v);
  const head = c.category === 'card'
    ? `<div><dt>Độ hiếm</dt><dd><span class="badge" data-r="${esc(c.rarity)}">${rarityLabel(c.rarity)}</span></dd></div>`
    : `<div><dt>Loại</dt><dd><span class="badge cat-badge">${cat.label}</span>${c.signed ? ' <span class="badge signed-badge">Có chữ ký</span>' : ''}</dd></div>`;
  return `<dl class="facts">
    ${head}
    ${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}
    ${c.tags?.length ? `<div class="wide"><dt>Tags</dt><dd class="tags">${c.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</dd></div>` : ''}
  </dl>`;
}

function privateHTML(c) {
  if (!state.admin || (!c.source && !c.notes)) return '';
  return `<section class="private-note" aria-label="Thông tin riêng của admin">
    <h3>Chỉ admin nhìn thấy</h3>
    <dl class="facts">
      ${c.source ? `<div class="wide"><dt>Nguồn có được</dt><dd>${esc(c.source)}</dd></div>` : ''}
      ${c.notes ? `<div class="wide"><dt>Ghi chú</dt><dd class="notes">${esc(c.notes)}</dd></div>` : ''}
    </dl>
  </section>`;
}

// Bộ ảnh cho áo đấu, poster, tượng: ảnh lớn + nút trước/sau + dải ảnh nhỏ
let galleryIndex = 0;
function galleryHTML(c) {
  const cat = category(c.category);
  const g = c.gallery;
  return `<div class="gallery" data-cat="${c.category}">
    <div class="gallery-main">
      ${g.map((img, i) => `<div class="gallery-slide" data-gslide="${i}" ${i === galleryIndex ? '' : 'hidden'}>
        <button class="gallery-zoom" type="button" data-gzoom="${i}" aria-label="Phóng to ảnh ${i + 1}">
          ${mediaHTML(img.url, img.w, img.h, `${cat.label} ${c.player_name}, ảnh ${i + 1}/${g.length}`, { lazy: i !== galleryIndex, ratio: cat.ratio })}
        </button>
      </div>`).join('')}
      ${g.length > 1 ? `
        <button class="carousel-nav prev" type="button" data-gnav="-1" aria-label="Ảnh trước">${icon('chevronL', 22)}</button>
        <button class="carousel-nav next" type="button" data-gnav="1" aria-label="Ảnh sau">${icon('chevronR', 22)}</button>` : ''}
    </div>
    <p class="side-label" id="galleryLabel">Ảnh ${galleryIndex + 1} / ${g.length}</p>
    ${g.length > 1 ? `<div class="gallery-thumbs" role="group" aria-label="Chọn ảnh">
      ${g.map((img, i) => `<button type="button" class="gallery-thumb" data-gi="${i}" aria-label="Xem ảnh ${i + 1}" aria-current="${i === galleryIndex}">
        <img src="${esc(img.url)}" alt="" loading="lazy"></button>`).join('')}
    </div>` : ''}
    <div class="flip-actions">
      <button class="btn" type="button" data-zoombtn>${icon('zoom')} Phóng to</button>
    </div>
  </div>`;
}

function showGalleryImage(i) {
  const c = state.cards.find((x) => x.id === state.detailId);
  if (!c || !c.gallery.length) return;
  galleryIndex = (i + c.gallery.length) % c.gallery.length;
  detailDialog.querySelectorAll('[data-gslide]').forEach((el) => {
    el.hidden = Number(el.dataset.gslide) !== galleryIndex;
    if (!el.hidden) el.querySelectorAll('img[loading="lazy"]').forEach((im) => im.removeAttribute('loading'));
  });
  detailDialog.querySelectorAll('[data-gi]').forEach((b) => b.setAttribute('aria-current', Number(b.dataset.gi) === galleryIndex));
  detailDialog.querySelector('#galleryLabel').textContent = `Ảnh ${galleryIndex + 1} / ${c.gallery.length}`;
}

function cardFlipHTML(c) {
  const hasBack = !!c.back_url;
  return `<div class="flip" data-rarity="${esc(c.rarity)}" id="flip">
          <div class="flip-inner">
            <div class="face front" data-zoom="front" role="button" tabindex="0" aria-label="Phóng to mặt trước">${mediaHTML(c.front_url, c.front_w, c.front_h, `Mặt trước thẻ ${c.player_name}`, { lazy: false })}</div>
            ${hasBack ? `<div class="face back" data-zoom="back" role="button" tabindex="-1" aria-label="Phóng to mặt sau">${mediaHTML(c.back_url, c.back_w, c.back_h, `Mặt sau thẻ ${c.player_name}`, { lazy: false })}</div>` : ''}
          </div>
        </div>
        <p class="side-label" id="sideLabel">${hasBack ? 'Đang xem mặt trước' : 'Thẻ chưa có ảnh mặt sau'}</p>
        <div class="flip-actions">
          ${hasBack ? `<button class="btn" type="button" data-flip>${icon('flip')} Lật thẻ</button>` : ''}
          <button class="btn" type="button" data-zoombtn>${icon('zoom')} Phóng to</button>
        </div>`;
}

function renderDetail(c) {
  const isCard = c.category === 'card';
  detailDialog.innerHTML = `
    <div class="sheet-head">
      <h2 id="detailTitle">${esc(c.player_name)}</h2>
      ${state.admin ? `<button class="btn icon-only ghost${c.favorite ? ' fav-on' : ''}" type="button" data-dfav aria-pressed="${c.favorite}" aria-label="${c.favorite ? 'Bỏ yêu thích' : 'Đánh dấu yêu thích'}">${icon('heart')}</button>` : ''}
      <button class="btn icon-only ghost" type="button" data-close aria-label="Đóng">${icon('x')}</button>
    </div>
    <div class="sheet-body detail-body">
      <div>${isCard ? cardFlipHTML(c) : galleryHTML(c)}</div>
      <div>
        <p class="detail-team">${esc(c.team || 'Chưa rõ câu lạc bộ')}</p>
        ${factsHTML(c)}
        ${privateHTML(c)}
      </div>
    </div>
    ${state.admin && hooks.detailActions ? `<div class="sheet-foot">
      <button class="btn danger" type="button" data-delete>${icon('trash')} Xóa ${isCard ? 'thẻ' : 'món này'}</button>
      <span class="spacer"></span>
      <button class="btn primary" type="button" data-edit>${icon('edit')} Sửa thông tin</button>
    </div>` : ''}`;
}

function openDetail(id, push = false) {
  const c = state.cards.find((x) => x.id === id);
  if (!c) return;
  if (state.detailId !== id) galleryIndex = 0;
  state.detailId = id;
  renderDetail(c);
  if (!detailDialog.open) detailDialog.showModal();
  if (push && location.hash !== `#the-${id}`) { openedByPush = true; location.hash = `the-${id}`; }
}

function flipCard() {
  const flip = detailDialog.querySelector('#flip');
  if (!flip || !detailDialog.querySelector('.face.back')) return;
  const back = flip.classList.toggle('flipped');
  detailDialog.querySelector('#sideLabel').textContent = back ? 'Đang xem mặt sau' : 'Đang xem mặt trước';
  detailDialog.querySelector('.face.front').tabIndex = back ? -1 : 0;
  detailDialog.querySelector('.face.back').tabIndex = back ? 0 : -1;
}

detailDialog.addEventListener('click', (e) => {
  if (e.target === detailDialog) return detailDialog.close(); // bấm ra ngoài
  const t = e.target.closest('[data-close],[data-flip],[data-zoombtn],[data-zoom],[data-edit],[data-delete],[data-dfav],[data-gnav],[data-gi],[data-gzoom]');
  if (!t) return;
  const c = state.cards.find((x) => x.id === state.detailId);
  if (t.hasAttribute('data-close')) detailDialog.close();
  else if (t.hasAttribute('data-flip')) flipCard();
  else if (t.dataset.gnav) showGalleryImage(galleryIndex + Number(t.dataset.gnav));
  else if (t.dataset.gi) showGalleryImage(Number(t.dataset.gi));
  else if (t.dataset.gzoom) openZoom(c, c.gallery[Number(t.dataset.gzoom)].url);
  else if (t.hasAttribute('data-zoombtn')) {
    openZoom(c, c.category === 'card'
      ? (detailDialog.querySelector('#flip.flipped') ? c.back_url : c.front_url)
      : c.gallery[galleryIndex].url);
  }
  else if (t.dataset.zoom) openZoom(c, t.dataset.zoom === 'back' ? c.back_url : c.front_url);
  else if (hooks.detailActions) hooks.detailActions(t, c);
});
detailDialog.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.dataset?.zoom) {
    e.preventDefault();
    const c = state.cards.find((x) => x.id === state.detailId);
    openZoom(c, e.target.dataset.zoom === 'back' ? c.back_url : c.front_url);
  }
  // Phím mũi tên: chuyển ảnh trong bộ ảnh
  if (detailDialog.querySelector('.gallery') && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.target.matches('input, textarea')) {
    showGalleryImage(galleryIndex + (e.key === 'ArrowRight' ? 1 : -1));
  }
  if (e.key.toLowerCase() === 'f' && !e.target.matches('input, textarea')) flipCard();
});
detailDialog.addEventListener('close', () => {
  state.detailId = null;
  if (location.hash.startsWith('#the-')) {
    if (openedByPush) history.back();
    else history.replaceState(null, '', location.pathname + location.search);
  }
  openedByPush = false;
});

// ================== Phóng to ảnh ==================
function openZoom(c, url) {
  zoomDialog.innerHTML = `
    <div class="zoom-stage" id="zoomStage"><img src="${esc(url)}" alt="Ảnh ${category(c.category).label.toLowerCase()} ${esc(c.player_name)} phóng to" draggable="false"></div>
    <div class="zoom-bar">
      <button class="btn icon-only" type="button" data-z="out" aria-label="Thu nhỏ">${icon('zoomOut')}</button>
      <button class="btn icon-only" type="button" data-z="in" aria-label="Phóng to thêm">${icon('zoom')}</button>
      <button class="btn icon-only" type="button" data-z="close" aria-label="Đóng phóng to">${icon('x')}</button>
    </div>`;
  zoomDialog.showModal();
  const stage = zoomDialog.querySelector('#zoomStage');
  const img = stage.querySelector('img');
  let scale = 1, x = 0, y = 0, drag = null;
  const apply = () => { img.style.transform = `translate(${x}px, ${y}px) scale(${scale})`; };
  const setScale = (s) => { scale = Math.min(5, Math.max(1, s)); if (scale === 1) { x = 0; y = 0; } apply(); };
  zoomDialog.onclick = (e) => {
    const b = e.target.closest('[data-z]');
    if (!b) return;
    if (b.dataset.z === 'close') zoomDialog.close();
    else setScale(scale * (b.dataset.z === 'in' ? 1.5 : 1 / 1.5));
  };
  stage.ondblclick = () => setScale(scale > 1 ? 1 : 2.5);
  stage.onwheel = (e) => { e.preventDefault(); setScale(scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)); };
  // Kéo để di chuyển ảnh khi đang phóng to; chụm 2 ngón để phóng to trên điện thoại
  const pts = new Map();
  let pinch = null;
  stage.onpointerdown = (e) => {
    stage.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: scale };
    } else drag = { sx: e.clientX - x, sy: e.clientY - y };
    stage.classList.add('dragging');
  };
  stage.onpointermove = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pts.size === 2) {
      const [a, b] = [...pts.values()];
      setScale(pinch.s * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d));
    } else if (drag && scale > 1) { x = e.clientX - drag.sx; y = e.clientY - drag.sy; apply(); }
  };
  stage.onpointerup = stage.onpointercancel = (e) => {
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (!pts.size) { drag = null; stage.classList.remove('dragging'); }
  };
}

// ================== Thống kê ==================
function barsHTML(items, total, swatch) {
  if (!items.length) return '<p class="page-sub">Chưa có dữ liệu.</p>';
  const max = Math.max(...items.map((i) => i.count), 1);
  return `<ul class="bars">${items.map((i) => `
    <li class="bar-row" ${swatch ? `data-r="${i.key}"` : ''}>
      <span class="name" title="${esc(i.label)}">${esc(i.label)}</span>
      <span class="bar-track" aria-hidden="true"><span class="bar-fill" style="--w:${(i.count / max) * 100}%"></span></span>
      <span class="count">${i.count}<span class="sr-only"> món, ${Math.round((i.count / total) * 100)}%</span></span>
    </li>`).join('')}</ul>`;
}

function groupCount(key, fallback, limit = 12) {
  const map = new Map();
  state.cards.forEach((c) => { const k = c[key] || fallback; map.set(k, (map.get(k) || 0) + 1); });
  const sorted = [...map].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'vi'));
  if (sorted.length <= limit) return sorted;
  const rest = sorted.slice(limit - 1).reduce((s, i) => s + i.count, 0);
  return [...sorted.slice(0, limit - 1), { label: `${sorted.length - limit + 1} nhóm khác`, count: rest }];
}

function renderStats() {
  const cards = state.cards;
  const total = cards.length;
  if (!total) { main.innerHTML = `<div class="page"><h1 class="page-title">Thống kê</h1>${emptyHTML()}</div>`; return; }
  const teams = new Set(cards.map((c) => c.team).filter(Boolean)).size;
  const onlyCards = cards.filter((c) => c.category === 'card');
  const byRarity = RARITY.map((r) => ({ key: r.key, label: r.label, count: onlyCards.filter((c) => c.rarity === r.key).length }));
  const byCategory = CATEGORIES.map((k) => ({ label: k.plural, count: cards.filter((c) => c.category === k.key).length }));
  main.innerHTML = `<div class="page">
    <div class="page-head"><div><h1 class="page-title">Thống kê</h1><p class="page-sub">Tổng quan toàn bộ bộ sưu tập</p></div></div>
    <div class="stat-tiles">
      <div class="tile"><div class="num">${total}</div><div class="lbl">Tổng số món</div></div>
      <div class="tile"><div class="num">${cards.filter(isSigned).length}</div><div class="lbl">Món có chữ ký</div></div>
      <div class="tile"><div class="num">${teams}</div><div class="lbl">Câu lạc bộ / đội tuyển</div></div>
    </div>
    <div class="panels">
      <section class="panel"><h2>Theo loại</h2>${barsHTML(byCategory, total)}</section>
      <section class="panel"><h2>Thẻ theo độ hiếm</h2>${barsHTML(byRarity, onlyCards.length || 1, true)}</section>
      <section class="panel"><h2>Theo câu lạc bộ</h2>${barsHTML(groupCount('team', 'Chưa rõ CLB'), total)}</section>
      <section class="panel"><h2>Theo hãng</h2>${barsHTML(groupCount('manufacturer', 'Chưa rõ hãng'), total)}</section>
    </div>
  </div>`;
}

// ================== Điều hướng theo #hash ==================
function render() {
  document.querySelectorAll('.tabs a').forEach((a) => {
    if (a.dataset.view === state.view) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  if (state.view !== 'collection') clearInterval(carouselTimer);
  if (state.view === 'stats') renderStats();
  else if (state.view === 'banner' && hooks.renderBanner) hooks.renderBanner(main);
  else renderCollection();
}

function route(force = false) {
  const h = location.hash;
  const m = h.match(/^#the-(\d+)$/);
  const view = h === '#thong-ke' ? 'stats' : h === '#banner' && hooks.renderBanner ? 'banner' : 'collection';
  // Mở chi tiết (#the-12) thì giữ nguyên loại đang xem
  let cat = state.category;
  if (!m && view === 'collection') {
    const cm = h.match(/^#loai-([\w-]+)$/);
    cat = (cm && CATEGORIES.find((c) => c.slug === cm[1])?.key) || 'all';
  }
  if (force || view !== state.view || cat !== state.category) {
    if (cat !== state.category) { state.filters.rarity.clear(); state.filters.manufacturer.clear(); }
    state.category = cat;
    state.view = view;
    render();
  }
  if (m) openDetail(Number(m[1]));
  else if (detailDialog.open) { openedByPush = false; detailDialog.close(); }
}
window.addEventListener('hashchange', route);

// ================== Giao diện cho admin.js dùng ==================
export const app = {
  state, hooks, toast, api,
  async reload() { await loadCards(); render(); if (state.detailId) openDetail(state.detailId); },
  render,
  renderResults,
  openDetail,
  closeDetail: () => detailDialog.close(),
  heroHTML,
  initCarousel
};

// ================== Khởi động ==================
async function start() {
  main.innerHTML = '<div class="loading"><div class="spinner" role="img" aria-label="Đang tải"></div></div>';
  try {
    if (IS_ADMIN_PAGE) {
      const me = await api('/api/auth/me');
      const admin = await import('./admin.js');
      if (!me.admin) return admin.showLogin(app, start);
      document.querySelector('.tabs').hidden = false;
      admin.setup(app);
    }
    await loadCards();
    route(true);
  } catch (err) {
    main.innerHTML = `<div class="page"><section class="empty"><h2>Chưa tải được album</h2><p>${esc(err.message)}</p><a class="btn" href="">Tải lại trang</a></section></div>`;
  }
}
start();
