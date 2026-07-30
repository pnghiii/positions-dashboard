/*
 * auth-gate.js (bản Supabase)
 * ----------------------------
 * Lớp đăng nhập dùng chung cho cả ba trang (index.html, ausbildung/,
 * 18b-19c-16d/). Thay cho bản Netlify Identity trước đó — cùng giao diện,
 * nhưng gọi Supabase Auth phía sau.
 *
 * Yêu cầu: /config.js phải được nạp trước file này (chứa SB_CONFIG.url và
 * SB_CONFIG.anonKey), và thư viện supabase-js phải được nạp trước đó.
 *
 * Luồng hoạt động:
 *  - Chưa đăng nhập                -> hiện form Đăng nhập (email + mật khẩu)
 *  - Vào từ email mời / quên mật khẩu -> hiện form Đặt mật khẩu mới
 *  - Đã đăng nhập                  -> hiện nội dung trang ngay
 */
(function () {
  if (!window.SB_CONFIG || !window.supabase) {
    console.error('auth-gate.js: thiếu config.js hoặc thư viện supabase-js.');
    return;
  }

  var sb = window.supabase.createClient(window.SB_CONFIG.url, window.SB_CONFIG.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  function injectStyles() {
    var css = ''
      + '#authGate{position:fixed;inset:0;z-index:99999;background:#0f1c3f;'
      + 'display:flex;align-items:center;justify-content:center;padding:24px;'
      + 'font-family:"Inter","Segoe UI",system-ui,-apple-system,sans-serif;'
      + 'visibility:visible !important;}'
      + '#authGate .ag-card{background:#fff;border-radius:14px;width:100%;max-width:340px;'
      + 'padding:28px 28px 24px;box-shadow:0 30px 80px rgba(0,0,0,.35);}'
      + '#authGate .ag-logo{display:flex;justify-content:center;margin-bottom:18px;}'
      + '#authGate .ag-logo img{height:26px;}'
      + '#authGate h2{margin:0 0 18px;font-size:16px;font-weight:700;color:#111827;text-align:center;}'
      + '#authGate label{display:block;font-size:13px;font-weight:600;color:#111827;margin-bottom:4px;}'
      + '#authGate .ag-row{margin-bottom:14px;}'
      + '#authGate .ag-row-head{display:flex;justify-content:space-between;align-items:baseline;}'
      + '#authGate .ag-row-head a{font-size:12.5px;color:#2946CA;text-decoration:none;}'
      + '#authGate .ag-row-head a:hover{text-decoration:underline;}'
      + '#authGate input{width:100%;padding:9px 11px;border:1px solid #d0d5dd;border-radius:7px;'
      + 'font-size:14px;box-sizing:border-box;outline:none;}'
      + '#authGate input:focus{border-color:#2946CA;box-shadow:0 0 0 3px rgba(41,70,202,.15);}'
      + '#authGate button[type=submit]{width:100%;background:#2946CA;color:#fff;border:none;'
      + 'border-radius:8px;padding:10px;font-size:14.5px;font-weight:700;cursor:pointer;margin-top:4px;}'
      + '#authGate button[type=submit]:hover{background:#22389e;}'
      + '#authGate button[type=submit]:disabled{opacity:.6;cursor:default;}'
      + '#authGate .ag-error{color:#c0362c;font-size:13px;margin:-4px 0 12px;display:none;}'
      + '#authGate .ag-hint{font-size:12.5px;color:#6b7280;text-align:center;margin-top:16px;}'
      + '#authGate .ag-hint a{color:#2946CA;text-decoration:none;cursor:pointer;}'
      + '#authGate .ag-hint a:hover{text-decoration:underline;}'
      + 'body.ag-locked{overflow:hidden;}';
    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      if (k === 'text') node.textContent = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { node.appendChild(c); });
    return node;
  }

  function buildOverlay() {
    var existing = document.getElementById('authGate');
    if (existing) return existing.querySelector('.ag-card');
    var overlay = document.createElement('div');
    overlay.id = 'authGate';
    var card = el('div', { class: 'ag-card' });
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    document.body.classList.add('ag-locked');
    return card;
  }

  function removeOverlay() {
    var overlay = document.getElementById('authGate');
    if (overlay) overlay.remove();
    document.body.classList.remove('ag-locked');
    document.body.style.visibility = 'visible';
  }

  function logoRow() {
    return el('div', { class: 'ag-logo' }, [el('img', { src: '/alma-logo.png', alt: 'ALMA' })]);
  }

  function showError(errorBox, message) {
    errorBox.textContent = message;
    errorBox.style.display = 'block';
  }

  // ---------------------------------------------------------------------
  // Đăng nhập (email + mật khẩu)
  // ---------------------------------------------------------------------
  function renderLoginForm(card) {
    card.innerHTML = '';
    card.appendChild(logoRow());
    card.appendChild(el('h2', { text: 'Đăng nhập' }));

    var errorBox = el('div', { class: 'ag-error' });
    var form = el('form');

    var emailRow = el('div', { class: 'ag-row' });
    emailRow.appendChild(el('label', { text: 'Email' }));
    var emailInput = el('input', { type: 'email', required: 'required', autocomplete: 'email' });
    emailRow.appendChild(emailInput);

    var passRow = el('div', { class: 'ag-row' });
    var passHead = el('div', { class: 'ag-row-head' });
    passHead.appendChild(el('label', { text: 'Mật khẩu' }));
    var forgotLink = el('a', { text: 'Quên mật khẩu?' });
    passHead.appendChild(forgotLink);
    passRow.appendChild(passHead);
    var passInput = el('input', { type: 'password', required: 'required', autocomplete: 'current-password' });
    passRow.appendChild(passInput);

    var submitBtn = el('button', { type: 'submit', text: 'Đăng nhập' });

    form.appendChild(errorBox);
    form.appendChild(emailRow);
    form.appendChild(passRow);
    form.appendChild(submitBtn);
    card.appendChild(form);

    var hint = el('div', { class: 'ag-hint', text: 'Chỉ đối tác được mời mới có thể đăng nhập.' });
    card.appendChild(hint);

    forgotLink.addEventListener('click', function (e) {
      e.preventDefault();
      renderForgotPasswordForm(card);
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      errorBox.style.display = 'none';
      submitBtn.disabled = true;
      submitBtn.textContent = 'Đang đăng nhập...';

      sb.auth.signInWithPassword({ email: emailInput.value, password: passInput.value })
        .then(function (result) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Đăng nhập';
          if (result.error) {
            showError(errorBox, 'Email hoặc mật khẩu không đúng.');
          }
          // Thành công thì onAuthStateChange bên dưới sẽ tự đóng lớp chặn.
        });
    });
  }

  // ---------------------------------------------------------------------
  // Quên mật khẩu
  // ---------------------------------------------------------------------
  function renderForgotPasswordForm(card) {
    card.innerHTML = '';
    card.appendChild(logoRow());
    card.appendChild(el('h2', { text: 'Quên mật khẩu' }));

    var errorBox = el('div', { class: 'ag-error' });
    var successBox = el('div', { class: 'ag-hint' });
    successBox.style.display = 'none';
    var form = el('form');

    var emailRow = el('div', { class: 'ag-row' });
    emailRow.appendChild(el('label', { text: 'Email' }));
    var emailInput = el('input', { type: 'email', required: 'required' });
    emailRow.appendChild(emailInput);

    var submitBtn = el('button', { type: 'submit', text: 'Gửi email đặt lại mật khẩu' });

    form.appendChild(errorBox);
    form.appendChild(emailRow);
    form.appendChild(submitBtn);
    card.appendChild(form);
    card.appendChild(successBox);

    var backHint = el('div', { class: 'ag-hint' });
    var backLink = el('a', { text: 'Quay lại đăng nhập' });
    backHint.appendChild(backLink);
    card.appendChild(backHint);

    backLink.addEventListener('click', function (e) {
      e.preventDefault();
      renderLoginForm(card);
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      errorBox.style.display = 'none';
      submitBtn.disabled = true;

      sb.auth.resetPasswordForEmail(emailInput.value, {
        redirectTo: window.location.origin + window.location.pathname
      }).then(function () {
        form.style.display = 'none';
        successBox.style.display = 'block';
        successBox.textContent = 'Nếu email này đã được mời, một email đặt lại mật khẩu vừa được gửi đi.';
      }).catch(function () {
        submitBtn.disabled = false;
        showError(errorBox, 'Có lỗi xảy ra, vui lòng thử lại.');
      });
    });
  }

  // ---------------------------------------------------------------------
  // Đặt mật khẩu mới (dùng chung cho lời mời và quên mật khẩu)
  // ---------------------------------------------------------------------
  function renderSetPasswordForm(card) {
    card.innerHTML = '';
    card.appendChild(logoRow());
    card.appendChild(el('h2', { text: 'Tạo mật khẩu để bắt đầu' }));

    var errorBox = el('div', { class: 'ag-error' });
    var form = el('form');

    var passRow = el('div', { class: 'ag-row' });
    passRow.appendChild(el('label', { text: 'Mật khẩu mới' }));
    var passInput = el('input', { type: 'password', required: 'required', minlength: '8' });
    passRow.appendChild(passInput);

    var confirmRow = el('div', { class: 'ag-row' });
    confirmRow.appendChild(el('label', { text: 'Nhập lại mật khẩu' }));
    var confirmInput = el('input', { type: 'password', required: 'required', minlength: '8' });
    confirmRow.appendChild(confirmInput);

    var submitBtn = el('button', { type: 'submit', text: 'Xác nhận' });

    form.appendChild(errorBox);
    form.appendChild(passRow);
    form.appendChild(confirmRow);
    form.appendChild(submitBtn);
    card.appendChild(form);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      errorBox.style.display = 'none';

      if (passInput.value !== confirmInput.value) {
        showError(errorBox, 'Hai mật khẩu chưa khớp nhau.');
        return;
      }
      if (passInput.value.length < 8) {
        showError(errorBox, 'Mật khẩu cần ít nhất 8 ký tự.');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Đang xử lý...';

      sb.auth.updateUser({ password: passInput.value }).then(function (result) {
        if (result.error) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Xác nhận';
          showError(errorBox, 'Có lỗi xảy ra, vui lòng thử lại.');
          return;
        }
        // Thành công thì onAuthStateChange sẽ tự đóng lớp chặn.
      });
    });
  }

  // ---------------------------------------------------------------------
  // Supabase là nguồn sự thật duy nhất cho trạng thái đăng nhập
  // ---------------------------------------------------------------------
  sb.auth.onAuthStateChange(function (event, session) {
    if (event === 'PASSWORD_RECOVERY') {
      var card = buildOverlay();
      renderSetPasswordForm(card);
      return;
    }
    if (session && session.user) {
      removeOverlay();
    } else {
      var card2 = buildOverlay();
      renderLoginForm(card2);
    }
  });

  window.almaAuth = { supabase: sb };

  injectStyles();
})();
