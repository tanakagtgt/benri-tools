/* =====================================================
   common.js
   全ツール共通のJS処理（おすすめ読込／シェア／コピー／
   localStorage保存復元／トグル／リセット等）

   ★このファイルはツールごとに書き換えない（共通処理のみ）
   ★ツール固有の設定・ロジックは各ツールのHTML内<script>に書く

   【各ツール側で必ず定義しておく変数・関数（呼び出し前提）】
   - CURRENT_TOOL_ID   : string  … tools.json内の自ツールid
   - STORAGE_KEY        : string  … localStorage保存キー
   - STORAGE_FIELDS      : array   … 保存対象input/selectのid一覧
   - INPUT_LABELS        : object  … テキスト/Excelコピー用ラベル
   - RESULT_LABELS       : object  … 結果表示用ラベル（main/subA〜C）
   - calculateInputs()   : function … 入力値取得ロジック
   - calculateResult(inputs) : function … 計算ロジック（不正時はnull）
   - displayResult(result)   : function … 結果表示ロジック
   - buildShareText(result)  : function … シェア用テキスト
   - buildShareUrl()         : function … シェア用URL（省略時は現在URL）
   ===================================================== */

/* =====================================================
   状態管理（トグルの現在値）
   ===================================================== */
let currentToggle = 'A';

/* =====================================================
   初期化
   ===================================================== */
document.addEventListener('DOMContentLoaded', () => {
  injectCommonUI(); // 共通UIブロック（ナビ/広告/シェア/リセット/QR/フッター）を注入
  loadRecommends();  // おすすめツールを非同期で読み込む
  restoreInputs();   // LocalStorageから入力値を復元
  setCopyrightYear(); // フッターの©年号を自動表示
});

/* =====================================================
   共通UIブロックの一括注入
   - htmlには空の<div id="◯◯Slot"></div>だけ置いておく
   - ここでHTMLを一括生成して差し込む
   - common.jsをここだけ直せば全ツール一括反映される
   対象スロット：
     #topNavSlot    → 上部ナビ（ツール一覧に戻る＋おすすめ）
     #bottomNavSlot → 下部ナビ（同上）
     #adAreaSlot    → 広告エリア
     #shareAreaSlot → シェアエリア
     #resetBtnSlot  → リセットボタン
     #qrModalSlot   → QRコードモーダル
     #footerSlot    → フッター
   ===================================================== */
function injectCommonUI() {
  const topNav = document.getElementById('topNavSlot');
  if (topNav) topNav.outerHTML = `
<div class="back-to-index">
  <a class="btn-back" href="/index.html">← ツール一覧に戻る</a>
  <div class="recommend-wrap">
    <span class="recommend-label">おすすめ：</span>
    <span id="recommendLinks">読み込み中…</span>
  </div>
</div>`;

  const bottomNav = document.getElementById('bottomNavSlot');
  if (bottomNav) bottomNav.outerHTML = `
<div class="bottom-nav">
  <a class="btn-back" href="/index.html">← ツール一覧に戻る</a>
  <div class="recommend-wrap">
    <span class="recommend-label">おすすめ：</span>
    <span id="recommendLinks2">読み込み中…</span>
  </div>
</div>`;

  const adArea = document.getElementById('adAreaSlot');
  if (adArea) adArea.outerHTML = `
<div class="ad-area">
  <div class="ad-area-label">スポンサー</div>
  <!-- ここにAdSenseコードを貼る -->
</div>`;

  const shareArea = document.getElementById('shareAreaSlot');
  if (shareArea) shareArea.outerHTML = `
<div class="share-area">
  <div class="share-title">▶ このツールをシェア</div>
  <div class="share-btns">
    <button class="btn-share" id="btnShareUrl" onclick="shareUrl()">🔗 URLをコピー</button>
    <button class="btn-share x-post" onclick="shareX()">𝕏 ポストする</button>
    <button class="btn-share line" onclick="shareLine()">💬 LINEで送る</button>
    <button class="btn-share qr" onclick="showQr()">📷 QRコード</button>
  </div>
</div>`;

  const resetBtn = document.getElementById('resetBtnSlot');
  if (resetBtn) resetBtn.outerHTML = `<button class="btn-reset" onclick="handleReset()">🔄 入力値をリセット</button>`;

  const qrModal = document.getElementById('qrModalSlot');
  if (qrModal) qrModal.outerHTML = `
<div class="qr-modal-overlay" id="qrModalOverlay" onclick="closeQrOnOverlay(event)">
  <div class="qr-modal">
    <div class="qr-modal-title" id="qrModalTitle">📷 QRコードでシェア</div>
    <div id="qrCanvas"></div>
    <div class="qr-modal-url" id="qrUrl"></div>
    <button class="qr-modal-close" onclick="hideQr()">✕ 閉じる</button>
  </div>
</div>`;

  const footer = document.getElementById('footerSlot');
  if (footer) footer.outerHTML = `
<footer>
  © <span id="copyrightYear"></span> アリガイツ<br>
  <a class="footer-back" href="https://x.com/arigaitsu" target="_blank" rel="noopener">𝕏(twitter)</a>
   ・
  <a class="footer-back" href="https://note.com/arigaitsu" target="_blank" rel="noopener">開発ブログ(note)</a>
   ・
  <a class="footer-back" href="https://docs.google.com/forms/d/e/1FAIpQLSfUe9UzcRcIRFb4TmDAYKsZ75CcGRjF8Z7Ar_u7a4KgyyNyzQ/viewform?usp=publish-editor" target="_blank" rel="noopener">💡 作ってほしいツール・ご意見はこちら</a>
</footer>`;
}

/* =====================================================
   リセットボタンの共通ハンドラ
   - 常にresetAll()（標準の入力値クリア）を実行
   - ツール固有の追加リセット処理が必要な場合は、
     各ツールのHTML内<script>で onResetExtra() を定義しておけば
     ここから自動的に呼ばれる（未定義なら何もしない）
   ===================================================== */
function handleReset() {
  resetAll();
  if (typeof onResetExtra === 'function') onResetExtra();
}

/* =====================================================
   フッター©年号の自動表示
   - htmlの <span id="copyrightYear"></span> に現在年を挿入
   - ツール側での書き換えは一切不要（完全共通）
   ===================================================== */
function setCopyrightYear() {
  const el = document.getElementById('copyrightYear');
  if (el) el.textContent = new Date().getFullYear();
}

/* =====================================================
   おすすめツール読み込み（tools.jsonから）
   - 上部（recommendLinks）と下部ナビ（recommendLinks2）の両方に反映
   ===================================================== */
async function loadRecommends() {
  try {
    const res = await fetch('/tools.json');
    const tools = await res.json();

    const others = tools.filter(t => t.id !== CURRENT_TOOL_ID);
    const picks = others.sort(() => Math.random() - 0.5).slice(0, 2);

    const html = picks.length > 0
      ? picks.map(t => `<a class="recommend-link" href="${t.url}">${t.emoji} ${t.name}</a>`).join('')
      : '';

    const el1 = document.getElementById('recommendLinks');
    const el2 = document.getElementById('recommendLinks2');
    if (el1) el1.innerHTML = html;
    if (el2) el2.innerHTML = html;

  } catch (e) {
    const el1 = document.getElementById('recommendLinks');
    const el2 = document.getElementById('recommendLinks2');
    if (el1) el1.textContent = '';
    if (el2) el2.textContent = '';
  }
}

/* =====================================================
   トグル切り替え（2択トグルがないツールでは呼ばれない）
   ===================================================== */
function setToggle(val) {
  currentToggle = val;
  const a = document.getElementById('toggleA');
  const b = document.getElementById('toggleB');
  if (a) a.classList.toggle('active', val === 'A');
  if (b) b.classList.toggle('active', val === 'B');
  onInputChange();
}

/* =====================================================
   入力変更時のハンドラ（保存→計算を一括で呼ぶ）
   ===================================================== */
function onInputChange() {
  saveInputs();
  calculate();
}

/* =====================================================
   計算メイン処理（入力取得→計算→表示）
   - calculateInputs / calculateResult / displayResult は
     各ツールのHTML内<script>で定義する
   ===================================================== */
function calculate() {
  const inputs = calculateInputs();
  const result = calculateResult(inputs);

  const errEl = document.getElementById('errorMsg');

  if (result === null) {
    if (errEl) errEl.classList.remove('show');
    reset();
    return;
  }

  if (errEl) errEl.classList.remove('show');
  displayResult(result);
}

/* =====================================================
   リセット（プレースホルダー表示に戻す）
   - bA〜bCがないツールでは自動的に無視される
   ===================================================== */
function reset() {
  const numEl = document.getElementById('resultNum');
  if (numEl) {
    numEl.textContent = '—';
    numEl.classList.add('placeholder');
  }

  ['bA', 'bB', 'bC'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = '—';
    el.classList.add('placeholder');
  });

  ['btnCopyText', 'btnCopyUrlInputs', 'btnQrInputs', 'btnCopyExcel'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = true;
  });
}

/* =====================================================
   1つのinput/selectから表示用の値を取得する
   ===================================================== */
function getInputDisplayValue(id) {
  const el = document.getElementById(id);
  if (!el) return '';
  if (el.type === 'checkbox') return el.checked ? 'ON' : 'OFF';
  if (el.tagName === 'SELECT') return el.options[el.selectedIndex]?.text ?? el.value;
  return el.value;
}

/* =====================================================
   入力条件を「ラベル：値」の配列で取得
   - INPUT_LABELSに列挙した項目のみ対象
   - トグル（A/B）があるツールは末尾に自動追加
   ===================================================== */
function buildConditionsLines() {
  const lines = Object.keys(INPUT_LABELS).map(
    id => `${INPUT_LABELS[id]}：${getInputDisplayValue(id)}`
  );
  const toggleAEl = document.getElementById('toggleA');
  if (toggleAEl) {
    const activeBtn = document.getElementById(currentToggle === 'A' ? 'toggleA' : 'toggleB');
    lines.push(`設定：${activeBtn.textContent.trim()}`);
  }
  return lines;
}

/* =====================================================
   クリップボードコピー共通処理（ボタンのフィードバック付き）
   ===================================================== */
function copyToClipboard(text, btnId, label) {
  const btn = document.getElementById(btnId);
  navigator.clipboard.writeText(text).then(() => {
    if (btn) {
      btn.textContent = '✅ コピーしました！';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = label;
        btn.classList.remove('copied');
      }, 2000);
    }
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  });
}

/* =====================================================
   結果をテキストでコピー（入力値・条件＋メイン結果のみ）
   ===================================================== */
function copyResultText() {
  const inputs = calculateInputs();
  const result = calculateResult(inputs);
  if (!result) return;

  const lines = [
    '【入力条件】',
    ...buildConditionsLines(),
    '',
    '【計算結果】',
    `${RESULT_LABELS.main}：${result.main.toLocaleString()}`,
  ];

  copyToClipboard(lines.join('\n'), 'btnCopyText', '📄 テキストでコピー');
}

/* =====================================================
   入力値URLコピー／QR（現在の入力値をURLパラメータに乗せる）
   ===================================================== */
function buildShareUrlWithInputs() {
  const params = new URLSearchParams();
  STORAGE_FIELDS.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    params.set(id, el.type === 'checkbox' ? (el.checked ? '1' : '0') : el.value);
  });
  return location.href.split('?')[0] + '?' + params.toString();
}

function copyResultUrlInputs() {
  const inputs = calculateInputs();
  const result = calculateResult(inputs);
  if (!result) return;
  copyToClipboard(buildShareUrlWithInputs(), 'btnCopyUrlInputs', '🔗 入力値URLコピー');
}

function showQrInputs() {
  const inputs = calculateInputs();
  const result = calculateResult(inputs);
  if (!result) return;
  showQr(buildShareUrlWithInputs(), '📷 入力値付きQRコード');
}

/* =====================================================
   Excel用コピー（入力値・条件＋詳細結果、タブ区切り）
   ===================================================== */
function copyResultExcel() {
  const inputs = calculateInputs();
  const result = calculateResult(inputs);
  if (!result) return;

  const rows = [
    ...buildConditionsLines().map(line => line.split('：').join('\t')),
    ...Object.keys(RESULT_LABELS)
      .filter(key => key in result)
      .map(key => `${RESULT_LABELS[key]}\t${result[key].toLocaleString()}`),
  ];

  copyToClipboard(rows.join('\n'), 'btnCopyExcel', '📊 Excel用コピー');
}

/* =====================================================
   LocalStorage：入力値を保存
   ===================================================== */
function saveInputs() {
  try {
    const data = {};
    STORAGE_FIELDS.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      data[id] = el.type === 'checkbox' ? el.checked : el.value;
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    // プライベートモード等でlocalStorageが使えない場合は無視
  }
}

/* =====================================================
   LocalStorage：入力値を復元
   ===================================================== */
function restoreInputs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    const data = JSON.parse(raw);
    STORAGE_FIELDS.forEach(id => {
      if (!(id in data)) return;
      const el = document.getElementById(id);
      if (!el) return;
      if (el.type === 'checkbox') {
        el.checked = data[id];
      } else {
        el.value = data[id];
      }
    });

    calculate();
  } catch (e) {
    // パース失敗時は無視
  }
}

/* =====================================================
   入力値リセット（STORAGE_FIELDSを全クリア＋localStorage削除）
   ===================================================== */
function resetAll() {
  STORAGE_FIELDS.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.type === 'checkbox') {
      el.checked = false;
    } else {
      el.value = '';
    }
  });

  if (document.getElementById('toggleA')) setToggle('A');

  try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}

  const errEl = document.getElementById('errorMsg');
  if (errEl) errEl.classList.remove('show');
  reset();
}

/* =====================================================
   エラー表示ヘルパー
   ===================================================== */
function showError(msg) {
  const el = document.getElementById('errorMsg');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
}

/* =====================================================
   URLコピー（ツール紹介用シェアURL）
   ===================================================== */
function shareUrl() {
  const url = buildShareUrl();
  const btn = document.getElementById('btnShareUrl');

  navigator.clipboard.writeText(url).then(() => {
    if (btn) {
      btn.textContent = '✅ コピーしました！';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = '🔗 URLをコピー';
        btn.classList.remove('copied');
      }, 2500);
    }
  }).catch(() => {
    prompt('このURLをコピーしてください', url);
  });
}

/* =====================================================
   𝕏（Twitter）シェア
   ===================================================== */
function shareX() {
  const inputs = calculateInputs();
  const result = calculateResult(inputs);
  if (!result) return;

  const text = buildShareText(result) + '\n' + buildShareUrl();
  window.open(
    `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`,
    '_blank'
  );
}

/* =====================================================
   LINEシェア
   ===================================================== */
function shareLine() {
  const inputs = calculateInputs();
  const result = calculateResult(inputs);
  if (!result) return;

  const text = buildShareText(result) + '\n' + buildShareUrl();
  window.open(
    `https://line.me/R/msg/text/${encodeURIComponent(text)}`,
    '_blank'
  );
}

/* =====================================================
   QRコード表示／非表示
   ===================================================== */
function showQr(customUrl, customTitle) {
  const url = customUrl || buildShareUrl();

  const titleEl = document.getElementById('qrModalTitle');
  if (titleEl) titleEl.textContent = customTitle || '📷 QRコードでシェア';

  document.getElementById('qrModalOverlay').classList.add('show');

  const urlEl = document.getElementById('qrUrl');
  if (urlEl) urlEl.textContent = url;

  const canvas = document.getElementById('qrCanvas');
  canvas.innerHTML = '';

  new QRCode(canvas, {
    text: url,
    width: 200,
    height: 200,
    colorDark:  '#111111',
    colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.M
  });
}

function hideQr() {
  document.getElementById('qrModalOverlay').classList.remove('show');
}

function closeQrOnOverlay(e) {
  if (e.target === document.getElementById('qrModalOverlay')) hideQr();
}
