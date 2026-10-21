// Tiện ích dùng chung: gọi API, thông báo nhỏ, nhãn tiếng Việt, định dạng, khung ảnh.
import { icon } from './icons.js';

export const RARITY = [
  { key: 'common', label: 'Thường' },
  { key: 'rare', label: 'Hiếm' },
  { key: 'super_rare', label: 'Siêu hiếm' },
  { key: 'autograph', label: 'Chữ ký' },
  { key: 'limited', label: 'Giới hạn' }
];
export const CONDITION = [
  { key: 'new', label: 'Mới' },
  { key: 'good', label: 'Tốt' },
  { key: 'fair', label: 'Trung bình' },
  { key: 'worn', label: 'Đã cũ' }
];
// Các loại món sưu tập. ratio: tỉ lệ khung ảnh (rộng / cao); slug: dùng trên địa chỉ (#ao-dau…)
export const CATEGORIES = [
  { key: 'card', label: 'Thẻ', plural: 'Thẻ cầu thủ', slug: 'the', ratio: 5 / 7, makerLabel: 'Hãng phát hành' },
  { key: 'jersey', label: 'Áo đấu', plural: 'Áo đấu', slug: 'ao-dau', ratio: 1, makerLabel: 'Hãng sản xuất' },
  { key: 'poster', label: 'Poster', plural: 'Poster chữ ký', slug: 'poster', ratio: 3 / 4, makerLabel: 'Hãng / nhà in' },
  { key: 'figure', label: 'Tượng', plural: 'Tượng cầu thủ', slug: 'tuong', ratio: 4 / 5, makerLabel: 'Hãng sản xuất' }
];
export const category = (k) => CATEGORIES.find((c) => c.key === k) || CATEGORIES[0];

export const rarityLabel =(k) => RARITY.find((r) => r.key === k)?.label || 'Thường';
export const conditionLabel = (k) => CONDITION.find((c) => c.key === k)?.label || '';

// Thoát ký tự HTML cho mọi dữ liệu người dùng nhập
export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// Bỏ dấu tiếng Việt để tìm kiếm không phân biệt dấu ("ronaldo" khớp "Rônaldo", "doi" khớp "đội")
export function norm(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim();
}

export const fmtVND = (n) => `${new Intl.NumberFormat('vi-VN').format(Number(n) || 0)} ₫`;
export function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export async function api(url, opts = {}) {
  const res = await fetch(url, { credentials: 'same-origin', ...opts });
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const err = new Error(data?.error || `Lỗi kết nối (${res.status}).`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// Thông báo nhỏ góc dưới màn hình
export function toast(message, type = 'ok') {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `${icon(type === 'error' ? 'alert' : 'check')}<span>${esc(message)}</span>`;
  box.append(el);
  // Hộp thoại đang mở nằm ở "top layer" che mọi thứ khác: đưa vùng thông báo lên top layer
  // (Popover API) và mở lại mỗi lần để nó luôn nằm trên hộp thoại mới nhất
  if (box.showPopover) {
    try { if (box.matches(':popover-open')) box.hidePopover(); box.showPopover(); } catch {}
  }
  const ttl = type === 'error' ? 7000 : 3200;
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => {
      el.remove();
      if (!box.children.length && box.hidePopover) { try { box.hidePopover(); } catch {} }
    }, 250);
  }, ttl);
}

// Tỉ lệ thẻ chuẩn 63×88mm ≈ 5:7
export const CARD_RATIO = 5 / 7;
export const ratioOff = (w, h, ratio = CARD_RATIO) => (w && h ? Math.abs(w / h - ratio) / ratio : 0);

// Khung ảnh theo tỉ lệ (mặc định thẻ 5:7). Ảnh gần đúng tỉ lệ khung (lệch < 6%) thì phủ kín;
// ảnh lệch nhiều thì hiển thị trọn vẹn trên nền mờ của chính ảnh, khung giữ nguyên kích thước.
export function mediaHTML(url, w, h, alt, { lazy = true, ratio = CARD_RATIO } = {}) {
  const fill = w && h && ratioOff(w, h, ratio) < 0.06;
  const load = lazy ? 'loading="lazy" decoding="async"' : 'decoding="async"';
  const style = ratio === CARD_RATIO ? '' : ` style="aspect-ratio:${ratio}"`;
  return `<div class="media${fill ? ' fill' : ''}"${style}>
    ${fill ? '' : `<img class="media-bg" src="${esc(url)}" alt="" aria-hidden="true" ${load}>`}
    <img class="media-img" src="${esc(url)}" alt="${esc(alt)}" ${load}>
  </div>`;
}

export const store = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }
};
