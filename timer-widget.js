/* =====================================================
   timer-widget.js
   タスク管理ツール（task-manager.html）専用
   タイマー／ストップウォッチ／ポモドーロ機能

   ★このファイルは他ツールと共通化しない（task-manager.html専用）
   ★common.jsとは独立して動作する（common.jsのSTORAGE_KEYとは
     別のlocalStorageキーを使うので、タスクデータには影響しない）

   【前提】
   - task-manager.htmlに <div class="timer-placeholder-zone"
     id="timerWidgetZone"></div> が1つ存在すること
   - このJSが起動時に中身を丸ごと生成する（HTML側は空でOK）

   【全体構成】
   1. 設定・状態管理
   2. 初期化／描画（ミニ表示⇔展開パネル）
   3. タイマー（カウントダウン）
   4. ストップウォッチ（カウントアップ）
   5. ポモドーロ（作業⇔休憩の自動サイクル）
   6. 共通：時計tick／音／フラッシュ演出／設定保存
   ===================================================== */

(function () {
  'use strict';

  /* =====================================================
     1. 設定・状態管理
     ===================================================== */

  // 設定の保存キー（タスクデータとは別管理。ここを直せば保存内容も変わる）
  const SETTINGS_KEY = 'task_manager_timer_settings_v1';

  // ★将来プリセットを増やしたい場合はここに分数を追加するだけでOK
  const TIMER_PRESET_MINUTES = [5, 10, 15, 25, 45];

  const DEFAULT_SETTINGS = {
    soundOn: true,
    timerMin: 5,          // タイマーのデフォルト分
    timerSec: 0,          // タイマーのデフォルト秒
    pomoWorkMin: 25,       // ポモドーロ：作業時間（分）
    pomoBreakMin: 5,       // ポモドーロ：休憩時間（分）
    pomoLongBreakMin: 15,  // ポモドーロ：長い休憩（分）
    pomoCyclesUntilLong: 4 // 何セット作業したら長い休憩にするか
  };

  let settings = loadSettings();

  // 表示モード（タブ切替）
  let mode = 'timer'; // 'timer' | 'stopwatch' | 'pomodoro'

  // ミニ表示⇔展開パネルの開閉状態
  let isExpanded = false;

  // 動作中かどうか（3モード共通で1つだけ管理。同時に2つは動かさない設計）
  let isRunning = false;

  // 時計tick用（250msごとに残り時間／経過時間を再計算する）
  let tickIntervalId = null;

  /* ---- タイマー（カウントダウン）用の状態 ---- */
  let timerTotalSec = settings.timerMin * 60 + settings.timerSec; // 設定した合計秒数
  let timerRemainingSec = timerTotalSec; // 一時停止中の残り秒数（動作中はtargetEndAtから逆算する）
  let timerTargetEndAt = null; // 動作中：終了予定時刻（Date.now()と比較して残り秒数を出す）

  /* ---- ストップウォッチ（カウントアップ）用の状態 ---- */
  let swElapsedBeforePauseSec = 0; // 一時停止までに経過した秒数の累計
  let swStartedAt = null;          // 動作中：直近でスタートした時刻

  /* ---- ポモドーロ用の状態 ---- */
  let pomoPhase = 'work';   // 'work' | 'break' | 'longBreak'
  let pomoCycleCount = 1;   // 現在何セット目か（1〜pomoCyclesUntilLong）
  let pomoTotalSec = settings.pomoWorkMin * 60;
  let pomoRemainingSec = pomoTotalSec;
  let pomoTargetEndAt = null;

  // Web Audio APIの共有コンテキスト（初回の音再生時に生成。iOS等はユーザー操作後でないと鳴らないため）
  let audioCtx = null;

  /* =====================================================
     2. 初期化／描画
     ===================================================== */
  document.addEventListener('DOMContentLoaded', init);

  function init() {
    const zone = document.getElementById('timerWidgetZone')
      || document.querySelector('.timer-placeholder-zone');
    if (!zone) return; // タイマー枠が無いページでは何もしない
    zone.id = 'timerWidgetZone';
    render();
  }

  // 状態が変わるたびに呼ぶ「構造ごと作り直す」描画関数
  // ※1秒ごとの数字更新はこれを使わず updateDisplayOnly() で軽量に行う
  function render() {
    const zone = document.getElementById('timerWidgetZone');
    if (!zone) return;

    zone.classList.toggle('tw-expanded', isExpanded);
    zone.innerHTML = isExpanded ? buildPanelHtml() : buildMiniHtml();
  }

  /* ---- ミニ表示（普段はこれだけ。タップで展開） ---- */
  function buildMiniHtml() {
    const icon = { timer: '⏱', stopwatch: '⏲', pomodoro: '🍅' }[mode];
    const label = { timer: 'タイマー', stopwatch: 'ストップウォッチ', pomodoro: 'ポモドーロ' }[mode];
    const remaining = getCurrentDisplaySeconds();

    return `
      <div class="tw-mini" onclick="twToggleExpand()">
        <div class="tw-mini-icon-row">${icon} ${label}${isRunning ? '（動作中）' : ''}</div>
        <div class="tw-mini-value" id="twDisplay">${formatTime(remaining)}</div>
        <div class="tw-mini-hint">タップで開く ▼</div>
      </div>`;
  }

  /* ---- 展開パネル（タブ切替＋詳細操作） ---- */
  function buildPanelHtml() {
    return `
      <div class="tw-panel">
        <div class="tw-panel-header">
          <div class="tw-tabs">
            <button class="tw-tab-btn ${mode === 'timer' ? 'active' : ''}" onclick="twSetMode('timer')">⏱ タイマー</button>
            <button class="tw-tab-btn ${mode === 'stopwatch' ? 'active' : ''}" onclick="twSetMode('stopwatch')">⏲ SW</button>
            <button class="tw-tab-btn ${mode === 'pomodoro' ? 'active' : ''}" onclick="twSetMode('pomodoro')">🍅 ポモドーロ</button>
          </div>
          <div style="display:flex; gap:4px; margin-left:6px;">
            <button class="tw-icon-btn ${settings.soundOn ? '' : 'muted'}" onclick="twToggleSound()" title="音のON/OFF">${settings.soundOn ? '🔔' : '🔕'}</button>
            <button class="tw-icon-btn" onclick="twToggleExpand()" title="閉じる">✕</button>
          </div>
        </div>
        ${mode === 'timer' ? buildTimerBodyHtml() : ''}
        ${mode === 'stopwatch' ? buildStopwatchBodyHtml() : ''}
        ${mode === 'pomodoro' ? buildPomodoroBodyHtml() : ''}
      </div>`;
  }

  /* =====================================================
     3. タイマー（カウントダウン）
     ===================================================== */
  function buildTimerBodyHtml() {
    const presetBtns = TIMER_PRESET_MINUTES.map(min => `
      <button class="tw-preset-btn ${!isRunning && settings.timerMin === min && settings.timerSec === 0 ? 'active' : ''}"
        onclick="twSetTimerPreset(${min})" ${isRunning ? 'disabled' : ''}>${min}分</button>
    `).join('');

    return `
      <div class="tw-presets">${presetBtns}</div>
      <div class="tw-settings-grid">
        <div>
          <label for="twTimerMin">分</label>
          <input type="number" id="twTimerMin" inputmode="numeric" min="0" max="180"
            value="${settings.timerMin}" ${isRunning ? 'disabled' : ''}
            oninput="twSetTimerCustom(this.value, null)">
        </div>
        <div>
          <label for="twTimerSec">秒</label>
          <input type="number" id="twTimerSec" inputmode="numeric" min="0" max="59"
            value="${settings.timerSec}" ${isRunning ? 'disabled' : ''}
            oninput="twSetTimerCustom(null, this.value)">
        </div>
      </div>
      <div class="tw-display" id="twDisplay">${formatTime(getCurrentDisplaySeconds())}</div>
      ${buildControlsHtml()}`;
  }

  function twSetTimerPreset(min) {
    if (isRunning) return;
    settings.timerMin = min;
    settings.timerSec = 0;
    saveSettings();
    resetTimerToSetting();
    render();
  }

  function twSetTimerCustom(minVal, secVal) {
    if (isRunning) return;
    if (minVal !== null) settings.timerMin = clampInt(minVal, 0, 180);
    if (secVal !== null) settings.timerSec = clampInt(secVal, 0, 59);
    saveSettings();
    resetTimerToSetting();
    // ★入力中に毎回render()すると入力欄のフォーカスが飛ぶため、
    //   数字表示だけを軽量更新する
    updateDisplayOnly();
  }

  function resetTimerToSetting() {
    timerTotalSec = settings.timerMin * 60 + settings.timerSec;
    timerRemainingSec = timerTotalSec;
    timerTargetEndAt = null;
  }

  /* =====================================================
     4. ストップウォッチ（カウントアップ）
     ===================================================== */
  function buildStopwatchBodyHtml() {
    return `
      <div class="tw-display" id="twDisplay">${formatTime(getCurrentDisplaySeconds())}</div>
      <div class="tw-sub-label">経過時間</div>
      ${buildControlsHtml()}`;
  }

  /* =====================================================
     5. ポモドーロ（作業⇔休憩の自動サイクル）
     ===================================================== */
  function buildPomodoroBodyHtml() {
    const phaseLabel = { work: '🍅 作業中', break: '☕ 休憩中', longBreak: '🛋️ 長い休憩' }[pomoPhase];

    return `
      <div class="tw-cycle-badge">${pomoCycleCount} / ${settings.pomoCyclesUntilLong} セット目</div>
      <div class="tw-settings-grid">
        <div>
          <label for="twPomoWork">作業（分）</label>
          <input type="number" id="twPomoWork" inputmode="numeric" min="1" max="180"
            value="${settings.pomoWorkMin}" ${isRunning ? 'disabled' : ''}
            oninput="twSetPomoSetting('pomoWorkMin', this.value)">
        </div>
        <div>
          <label for="twPomoBreak">休憩（分）</label>
          <input type="number" id="twPomoBreak" inputmode="numeric" min="1" max="60"
            value="${settings.pomoBreakMin}" ${isRunning ? 'disabled' : ''}
            oninput="twSetPomoSetting('pomoBreakMin', this.value)">
        </div>
        <div>
          <label for="twPomoLong">長い休憩（分）</label>
          <input type="number" id="twPomoLong" inputmode="numeric" min="1" max="90"
            value="${settings.pomoLongBreakMin}" ${isRunning ? 'disabled' : ''}
            oninput="twSetPomoSetting('pomoLongBreakMin', this.value)">
        </div>
        <div>
          <label for="twPomoCycles">何セットで長休憩</label>
          <input type="number" id="twPomoCycles" inputmode="numeric" min="2" max="10"
            value="${settings.pomoCyclesUntilLong}" ${isRunning ? 'disabled' : ''}
            oninput="twSetPomoSetting('pomoCyclesUntilLong', this.value)">
        </div>
      </div>
      <div class="tw-sub-label">${phaseLabel}</div>
      <div class="tw-display" id="twDisplay">${formatTime(getCurrentDisplaySeconds())}</div>
      ${buildControlsHtml()}`;
  }

  function twSetPomoSetting(key, val) {
    if (isRunning) return;
    const max = { pomoWorkMin: 180, pomoBreakMin: 60, pomoLongBreakMin: 90, pomoCyclesUntilLong: 10 }[key];
    const min = key === 'pomoCyclesUntilLong' ? 2 : 1;
    settings[key] = clampInt(val, min, max);
    saveSettings();
    resetPomodoroToSetting();
    updateDisplayOnly();
  }

  function resetPomodoroToSetting() {
    pomoPhase = 'work';
    pomoCycleCount = 1;
    pomoTotalSec = settings.pomoWorkMin * 60;
    pomoRemainingSec = pomoTotalSec;
    pomoTargetEndAt = null;
  }

  // 現フェーズが終わったら次のフェーズへ自動的に進める
  // ★手動で「次へ」を選びたい要望が出たら、ここをフラグ分岐に拡張すればよい（YAGNIのため今は自動のみ）
  function advancePomodoroPhase() {
    if (pomoPhase === 'work') {
      const isLongBreakTime = pomoCycleCount >= settings.pomoCyclesUntilLong;
      pomoPhase = isLongBreakTime ? 'longBreak' : 'break';
    } else {
      // 休憩明け：セット数を進めて作業フェーズに戻る（長い休憩明けは1セット目にリセット）
      pomoCycleCount = (pomoPhase === 'longBreak') ? 1 : pomoCycleCount + 1;
      pomoPhase = 'work';
    }

    pomoTotalSec = {
      work: settings.pomoWorkMin,
      break: settings.pomoBreakMin,
      longBreak: settings.pomoLongBreakMin
    }[pomoPhase] * 60;
    pomoRemainingSec = pomoTotalSec;
    pomoTargetEndAt = Date.now() + pomoTotalSec * 1000; // 自動で次フェーズを開始する
  }

  /* =====================================================
     6. 共通：開始／一時停止／リセット／モード切替
     ===================================================== */
  function buildControlsHtml() {
    return `
      <div class="tw-controls">
        <button class="tw-btn tw-btn-start" onclick="twStart()" ${isRunning ? 'disabled' : ''}>▶ 開始</button>
        <button class="tw-btn tw-btn-pause" onclick="twPause()" ${isRunning ? '' : 'disabled'}>⏸ 一時停止</button>
        <button class="tw-btn tw-btn-reset" onclick="twReset()">🔄 リセット</button>
      </div>`;
  }

  function twSetMode(newMode) {
    if (isRunning) return; // 動作中のモード切替は誤操作防止のため不可（先に一時停止 or リセットしてもらう）
    mode = newMode;
    render();
  }

  function twToggleExpand() {
    isExpanded = !isExpanded;
    render();
  }

  function twToggleSound() {
    settings.soundOn = !settings.soundOn;
    saveSettings();
    render();
  }

  function twStart() {
    if (isRunning) return;
    const now = Date.now();

    if (mode === 'timer') {
      if (timerRemainingSec <= 0) resetTimerToSetting();
      timerTargetEndAt = now + timerRemainingSec * 1000;
    } else if (mode === 'stopwatch') {
      swStartedAt = now;
    } else if (mode === 'pomodoro') {
      if (pomoRemainingSec <= 0) resetPomodoroToSetting();
      pomoTargetEndAt = now + pomoRemainingSec * 1000;
    }

    isRunning = true;
    startTick();
    render();
  }

  function twPause() {
    if (!isRunning) return;
    const now = Date.now();

    if (mode === 'timer') {
      timerRemainingSec = Math.max(0, Math.round((timerTargetEndAt - now) / 1000));
    } else if (mode === 'stopwatch') {
      swElapsedBeforePauseSec += (now - swStartedAt) / 1000;
      swStartedAt = null;
    } else if (mode === 'pomodoro') {
      pomoRemainingSec = Math.max(0, Math.round((pomoTargetEndAt - now) / 1000));
    }

    isRunning = false;
    stopTick();
    render();
  }

  function twReset() {
    isRunning = false;
    stopTick();

    if (mode === 'timer') {
      resetTimerToSetting();
    } else if (mode === 'stopwatch') {
      swElapsedBeforePauseSec = 0;
      swStartedAt = null;
    } else if (mode === 'pomodoro') {
      resetPomodoroToSetting();
    }

    render();
  }

  /* =====================================================
     6. 共通：時計tick／音／フラッシュ演出／設定保存
     ===================================================== */

  // 250msごとに現在の残り秒数／経過秒数を再計算して数字だけ更新する
  // ※Date.now()基準で計算するため、タブが裏に回っても誤差が蓄積しにくい
  function startTick() {
    stopTick();
    tickIntervalId = setInterval(tick, 250);
  }

  function stopTick() {
    if (tickIntervalId) clearInterval(tickIntervalId);
    tickIntervalId = null;
  }

  function tick() {
    const now = Date.now();

    if (mode === 'timer') {
      const remaining = (timerTargetEndAt - now) / 1000;
      if (remaining <= 0) {
        timerRemainingSec = 0;
        onTimerFinished();
        return;
      }
      timerRemainingSec = remaining;
    } else if (mode === 'pomodoro') {
      const remaining = (pomoTargetEndAt - now) / 1000;
      if (remaining <= 0) {
        onPomodoroPhaseFinished();
        return;
      }
      pomoRemainingSec = remaining;
    }
    // ストップウォッチは getCurrentDisplaySeconds() が都度計算するのでここでは何もしない

    updateDisplayOnly();
  }

  // タイマー終了：音＋フラッシュを鳴らして停止状態に戻す
  function onTimerFinished() {
    isRunning = false;
    stopTick();
    resetTimerToSetting();
    playAlertSound();
    flashZone();
    render();
  }

  // ポモドーロ：1フェーズ終了→次フェーズへ自動移行（作業⇔休憩をループ）
  function onPomodoroPhaseFinished() {
    playAlertSound();
    flashZone();
    advancePomodoroPhase(); // 内部でpomoTargetEndAtを再設定し、自動的に次フェーズがスタートする
    render();
    // isRunningはtrueのまま維持＝次フェーズへノンストップで継続
  }

  // 展開パネル・ミニ表示どちらでも id="twDisplay" は1つだけなので、これだけ更新すれば十分
  function updateDisplayOnly() {
    const el = document.getElementById('twDisplay');
    if (el) el.textContent = formatTime(getCurrentDisplaySeconds());
  }

  // 現在表示すべき秒数を、モードと動作状態から算出する
  function getCurrentDisplaySeconds() {
    const now = Date.now();
    if (mode === 'timer') {
      return isRunning ? Math.max(0, (timerTargetEndAt - now) / 1000) : timerRemainingSec;
    }
    if (mode === 'stopwatch') {
      return isRunning ? swElapsedBeforePauseSec + (now - swStartedAt) / 1000 : swElapsedBeforePauseSec;
    }
    if (mode === 'pomodoro') {
      return isRunning ? Math.max(0, (pomoTargetEndAt - now) / 1000) : pomoRemainingSec;
    }
    return 0;
  }

  // mm:ss形式に変換（1時間を超える場合はh:mm:ssにする）
  function formatTime(totalSec) {
    const s = Math.max(0, Math.round(totalSec));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) {
      return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    }
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }

  function clampInt(val, min, max) {
    const n = parseInt(val, 10);
    if (isNaN(n)) return min;
    return Math.min(max, Math.max(min, n));
  }

  // 通知音（ビープ2回）。Web Audio APIのみで完結＝音声ファイル不要
  function playAlertSound() {
    if (!settings.soundOn) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      beep(audioCtx.currentTime);
      beep(audioCtx.currentTime + 0.3);
    } catch (e) {
      // Web Audio非対応・自動再生制限等で失敗しても他の処理は止めない
    }
  }

  function beep(startTime) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.18, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.25);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(startTime);
    osc.stop(startTime + 0.25);
  }

  // 完了時の見た目フラッシュ演出（枠の背景を一瞬点滅させる）
  function flashZone() {
    const zone = document.getElementById('timerWidgetZone');
    if (!zone) return;
    zone.classList.remove('tw-flash'); // 連続完了時に再トリガーできるよう一旦外す
    void zone.offsetWidth; // reflow強制（アニメーション再スタートのおまじない）
    zone.classList.add('tw-flash');
    setTimeout(() => zone.classList.remove('tw-flash'), 1600);
  }

  /* ---- 設定の保存／読込（localStorage） ---- */
  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return { ...DEFAULT_SETTINGS };
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch (e) {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {
      // プライベートモード等でlocalStorageが使えない場合は無視（次回起動時はデフォルト設定になるだけ）
    }
  }

  /* =====================================================
     HTML側のonclick/oninputから呼べるようにwindowへ公開
     ===================================================== */
  window.twToggleExpand = twToggleExpand;
  window.twSetMode = twSetMode;
  window.twToggleSound = twToggleSound;
  window.twStart = twStart;
  window.twPause = twPause;
  window.twReset = twReset;
  window.twSetTimerPreset = twSetTimerPreset;
  window.twSetTimerCustom = twSetTimerCustom;
  window.twSetPomoSetting = twSetPomoSetting;
})();
