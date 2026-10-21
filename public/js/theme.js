// Chế độ sáng / tối.
// Nạp sớm trong <head> (không defer) để đặt giao diện trước khi trang hiện ra, tránh chớp màn hình.
// Chưa chọn gì thì theo giao diện của máy; đã chọn thì nhớ trong trình duyệt.
(function () {
  var KEY = 'fc.theme';
  var root = document.documentElement;
  var media = window.matchMedia('(prefers-color-scheme: light)');
  var choice = null; // 'light' | 'dark' | null (theo máy)
  try { var t = localStorage.getItem(KEY); if (t === 'light' || t === 'dark') choice = t; } catch (e) {}

  function current() { return choice || (media.matches ? 'light' : 'dark'); }

  var SUN = '<svg class="ic" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  var MOON = '<svg class="ic" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>';

  // Nút hiện biểu tượng của chế độ sẽ chuyển sang
  function renderButton() {
    var btn = document.getElementById('themeToggle');
    if (!btn) return;
    var light = current() === 'light';
    var label = light ? 'Chuyển sang giao diện tối' : 'Chuyển sang giao diện sáng';
    btn.innerHTML = light ? MOON : SUN;
    btn.setAttribute('aria-label', label);
    btn.title = label;
  }

  function apply() {
    if (choice) root.setAttribute('data-theme', choice); else root.removeAttribute('data-theme');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', current() === 'light' ? '#f3f5f1' : '#0c1410');
    renderButton();
  }

  apply();
  // Máy đổi giao diện (VD: tự chuyển tối buổi tối) mà người xem chưa chọn riêng: đổi theo
  media.addEventListener('change', function () { if (!choice) apply(); });

  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.getElementById('themeToggle');
    if (!btn) return;
    renderButton();
    btn.addEventListener('click', function () {
      choice = current() === 'light' ? 'dark' : 'light';
      try { localStorage.setItem(KEY, choice); } catch (e) {} // không lưu được thì vẫn đổi cho lần xem này
      apply();
    });
  });
})();
