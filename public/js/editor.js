// Xử lý ảnh trên trình duyệt: chuẩn hóa, nén JPEG và trình chỉnh sửa (cắt, xoay, lật, sáng/tương phản).
// Dùng thư viện Cropper.js (nạp sẵn ở admin.html, biến toàn cục window.Cropper).
import { icon } from './icons.js';

export const MAX_EDGE = 1200;   // cạnh dài tối đa của ảnh lưu lên server
const WORK_EDGE = 2400;         // ảnh gốc giữ lại để chỉnh sửa (đủ nét khi cắt nhỏ)
const QUALITY = 0.86;

// Ảnh HEIC/HEIF (iPhone): nhận diện qua loại file, đuôi file hoặc phần đầu file ("ftyp" + heic/heix/mif1…)
async function isHeic(blob) {
  if (/image\/hei[cf]/i.test(blob.type) || /\.(heic|heif)$/i.test(blob.name || '')) return true;
  const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const text = String.fromCharCode(...head.slice(4, 12));
  return text.startsWith('ftyp') && /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(text.slice(4));
}

// Chrome/Edge trên Windows không tự đọc được HEIC: chuyển sang JPEG bằng bộ giải mã WebAssembly
async function heicToJpeg(blob) {
  const { heicTo } = await import('/vendor/heic/heic-to.js');
  return heicTo({ blob, type: 'image/jpeg', quality: 0.92 });
}

// Đọc file ảnh thành bitmap, tự xoay theo thông tin EXIF của ảnh chụp điện thoại
async function decode(blob) {
  if (!(blob instanceof HTMLCanvasElement) && await isHeic(blob)) {
    // Safari đọc được HEIC sẵn; trình duyệt khác thì chuyển đổi trước
    try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch {}
    blob = await heicToJpeg(blob);
  }
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch {}
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasToBlob(canvas, quality = QUALITY) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Không xuất được ảnh.'))), 'image/jpeg', quality));
}

// Thu nhỏ ảnh về cạnh dài tối đa `maxEdge` rồi nén JPEG (nền trắng cho ảnh PNG trong suốt)
export async function compress(source, maxEdge = MAX_EDGE) {
  const bmp = source instanceof HTMLCanvasElement ? source : await decode(source);
  const w0 = bmp.width, h0 = bmp.height;
  const k = Math.min(1, maxEdge / Math.max(w0, h0));
  const w = Math.round(w0 * k), h = Math.round(h0 * k);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return { blob: await canvasToBlob(canvas), w, h };
}

// Chuẩn bị ảnh gốc để chỉnh sửa (đã xoay đúng chiều, tối đa 2400px)
export const prepareOriginal = async (blob) => (await compress(blob, WORK_EDGE)).blob;

// Áp dụng độ sáng / tương phản lên từng điểm ảnh (cùng công thức với CSS filter)
function adjust(canvas, brightness, contrast) {
  if (brightness === 1 && contrast === 1) return;
  const ctx = canvas.getContext('2d');
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    for (let j = 0; j < 3; j++) {
      d[i + j] = (d[i + j] * brightness - 128) * contrast + 128; // Uint8ClampedArray tự giới hạn 0–255
    }
  }
  ctx.putImageData(img, 0, 0);
}

const ASPECTS = [
  { key: 'portrait', label: 'Thẻ dọc 5:7', value: 5 / 7 },
  { key: 'landscape', label: 'Thẻ ngang 7:5', value: 7 / 5 },
  { key: 'free', label: 'Tự do', value: NaN }
];

/**
 * Mở trình chỉnh sửa.
 * @param {Blob} original  ảnh gốc (từ prepareOriginal)
 * @param {object} prev    thiết lập lần chỉnh trước (để tiếp tục chỉnh), có thể null
 * @param {string} title   tiêu đề hộp thoại
 * @param {object} opts    { aspects: danh sách khung cắt, maxEdge: cạnh dài tối đa khi lưu }
 * @returns {Promise<null | {blob, w, h, settings}>}  null nếu người dùng hủy
 */
export function openEditor(original, prev, title, { aspects = ASPECTS, maxEdge = MAX_EDGE } = {}) {
  const dialog = document.getElementById('editorDialog');
  const url = URL.createObjectURL(original);
  const firstAspect = aspects[0].key;
  const s = { aspect: firstAspect, brightness: 1, contrast: 1, ...(prev || {}) };

  dialog.innerHTML = `
    <div class="sheet-head">
      <h2 id="editorTitle">${title}</h2>
      <button class="btn icon-only ghost" type="button" data-act="cancel" aria-label="Đóng trình chỉnh ảnh">${icon('x')}</button>
    </div>
    <div class="editor-wrap">
      <div class="editor-canvas" id="edCanvas"><img id="edImg" src="${url}" alt="Ảnh đang chỉnh sửa"></div>
      <div class="editor-tools">
        <div class="tool-group">
          <h3>${icon('crop', 16)} Khung cắt</h3>
          <div class="tool-row" role="group" aria-label="Tỉ lệ khung cắt">
            ${aspects.map((a) => `<button type="button" class="chip" data-aspect="${a.key}" aria-pressed="${a.key === s.aspect}">${a.label}</button>`).join('')}
          </div>
        </div>
        <div class="tool-group">
          <h3>Xoay và lật</h3>
          <div class="tool-row">
            <button type="button" class="btn sm icon-only" data-act="rotL" aria-label="Xoay trái 90 độ" title="Xoay trái 90°">${icon('rotateL', 18)}</button>
            <button type="button" class="btn sm icon-only" data-act="rotR" aria-label="Xoay phải 90 độ" title="Xoay phải 90°">${icon('rotateR', 18)}</button>
            <button type="button" class="btn sm icon-only" data-act="flipH" aria-label="Lật ngang" title="Lật ngang">${icon('flipH', 18)}</button>
            <button type="button" class="btn sm icon-only" data-act="flipV" aria-label="Lật dọc" title="Lật dọc">${icon('flipV', 18)}</button>
          </div>
        </div>
        <div class="tool-group">
          <h3>Ánh sáng</h3>
          <label class="range" title="Độ sáng">${icon('sun', 18)}<span class="sr-only">Độ sáng</span>
            <input type="range" id="edB" min="50" max="150" step="1" value="${Math.round(s.brightness * 100)}"><output id="edBo"></output></label>
          <label class="range" title="Độ tương phản">${icon('contrast', 18)}<span class="sr-only">Độ tương phản</span>
            <input type="range" id="edC" min="50" max="150" step="1" value="${Math.round(s.contrast * 100)}"><output id="edCo"></output></label>
        </div>
        <button type="button" class="btn" data-act="reset">${icon('undo')} Hoàn tác về ảnh gốc</button>
        <p class="hint">Ảnh lưu sẽ được thu nhỏ tối đa ${maxEdge}px và nén JPEG.</p>
      </div>
    </div>
    <div class="sheet-foot">
      <button class="btn" type="button" data-act="cancel">Hủy</button>
      <button class="btn primary" type="button" data-act="apply">${icon('check')} Áp dụng</button>
    </div>`;

  const img = dialog.querySelector('#edImg');
  const box = dialog.querySelector('#edCanvas');
  const bIn = dialog.querySelector('#edB'), cIn = dialog.querySelector('#edC');
  const preview = () => {
    box.style.setProperty('--b', s.brightness);
    box.style.setProperty('--c', s.contrast);
    dialog.querySelector('#edBo').textContent = `${Math.round(s.brightness * 100)}%`;
    dialog.querySelector('#edCo').textContent = `${Math.round(s.contrast * 100)}%`;
  };
  preview();

  const aspectValue = () => (aspects.find((a) => a.key === s.aspect) || aspects[0]).value;
  let cropper;

  return new Promise((resolve) => {
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      cropper?.destroy();
      URL.revokeObjectURL(url);
      if (dialog.open) dialog.close();
      resolve(result);
    };

    dialog.showModal();
    // Khởi tạo Cropper sau khi hộp thoại hiển thị để đo đúng kích thước vùng chỉnh
    requestAnimationFrame(() => {
      cropper = new window.Cropper(img, {
        viewMode: 1,
        dragMode: 'move',
        aspectRatio: aspectValue(),
        autoCropArea: 0.96,
        checkOrientation: false,
        background: false,
        toggleDragModeOnDblclick: false,
        data: s.data || undefined
      });
    });

    dialog.onclick = async (e) => {
      const t = e.target.closest('[data-act],[data-aspect]');
      if (!t || !cropper) return;
      if (t.dataset.aspect) {
        s.aspect = t.dataset.aspect;
        dialog.querySelectorAll('[data-aspect]').forEach((b) => b.setAttribute('aria-pressed', b === t));
        cropper.setAspectRatio(aspectValue());
        return;
      }
      const d = cropper.getData();
      switch (t.dataset.act) {
        case 'rotL': cropper.rotate(-90); break;
        case 'rotR': cropper.rotate(90); break;
        case 'flipH': cropper.scaleX(-(d.scaleX || 1)); break;
        case 'flipV': cropper.scaleY(-(d.scaleY || 1)); break;
        case 'reset':
          Object.assign(s, { brightness: 1, contrast: 1, aspect: firstAspect, data: null });
          bIn.value = 100; cIn.value = 100; preview();
          dialog.querySelectorAll('[data-aspect]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.aspect === firstAspect));
          cropper.reset(); cropper.setAspectRatio(aspectValue());
          break;
        case 'cancel': finish(null); break;
        case 'apply': {
          t.disabled = true;
          t.textContent = 'Đang xử lý…';
          const canvas = cropper.getCroppedCanvas({ maxWidth: maxEdge, maxHeight: maxEdge, fillColor: '#fff', imageSmoothingQuality: 'high' });
          adjust(canvas, s.brightness, s.contrast);
          const out = await compress(canvas, maxEdge);
          finish({ ...out, settings: { aspect: s.aspect, brightness: s.brightness, contrast: s.contrast, data: cropper.getData() } });
          break;
        }
      }
    };
    bIn.oninput = () => { s.brightness = bIn.value / 100; preview(); };
    cIn.oninput = () => { s.contrast = cIn.value / 100; preview(); };
    dialog.oncancel = (e) => { e.preventDefault(); finish(null); }; // phím Esc
  });
}
