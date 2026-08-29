(() => {
  'use strict';

  const TOTAL_MS = 5 * 60 * 1000;
  const HOLD_MS = 2000;
  const BREAK_MS = 7000;
  const BREAK_AT = [60, 120, 180, 240].map((seconds) => seconds * 1000);
  const EFFECT_LIMIT = 4;
  const screens = {
    start: document.getElementById('start-screen'),
    play: document.getElementById('play-screen'),
    break: document.getElementById('break-screen'),
    finish: document.getElementById('finish-screen'),
  };
  const stage = document.getElementById('stage');
  const progress = document.getElementById('progress');
  const startButton = document.getElementById('start-button');
  const soundToggle = document.getElementById('sound-toggle');
  const startStatus = document.getElementById('start-status');
  const exitOverlay = document.getElementById('exit-overlay');
  const exitMessage = document.getElementById('exit-message');
  const holdProgress = document.getElementById('hold-progress');
  const exitButton = document.getElementById('exit-button');

  let state = 'START';
  let startedAt = 0;
  let breakIndex = 0;
  let breakUntil = 0;
  let rafId = 0;
  let lastPointerAt = 0;
  let soundEnabled = false;
  let audioContext = null;
  let gateStage = 0;
  let gateTimer = 0;
  let gateExpiryTimer = 0;
  let gateStartedAt = 0;
  let awaitingRelease = false;
  let fullscreenRetryTimer = 0;
  const down = new Set();
  const effects = [];

  const palette = ['#f4b7a5', '#a9d9c9', '#b9c9ef', '#efd49d', '#d6b6df'];

  function showScreen(name) {
    Object.entries(screens).forEach(([key, element]) => element.classList.toggle('active', key === name));
  }

  function randomBetween(min, max) { return min + Math.random() * (max - min); }

  function pointForEvent(event) {
    const rect = stage.getBoundingClientRect();
    return {
      x: Math.max(4, Math.min(96, ((event.clientX - rect.left) / rect.width) * 100)),
      y: Math.max(8, Math.min(92, ((event.clientY - rect.top) / rect.height) * 100)),
    };
  }

  function addEffect(kind, x, y) {
    if (state !== 'PLAYING') return;
    while (effects.length >= EFFECT_LIMIT) effects.shift()?.remove();
    const element = document.createElement('div');
    element.className = `effect ${kind}`;
    element.style.left = `${x}%`;
    element.style.top = `${y}%`;
    const color = palette[Math.floor(Math.random() * palette.length)];
    if (kind === 'orb' || kind === 'face') element.style.background = color;
    if (kind === 'bubble') element.style.setProperty('--bubble', `${color}78`);
    stage.appendChild(element);
    effects.push(element);
    element.addEventListener('animationend', () => {
      element.remove();
      const index = effects.indexOf(element);
      if (index >= 0) effects.splice(index, 1);
    }, { once: true });
    playTone(kind);
  }

  function clearEffects() {
    effects.splice(0).forEach((element) => element.remove());
  }

  function playTone(kind) {
    if (!soundEnabled || !audioContext) return;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const base = kind === 'bubble' ? 440 : kind === 'face' ? 330 : 390;
    oscillator.frequency.value = base + Math.random() * 90;
    oscillator.type = 'sine';
    gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.035, audioContext.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.22);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.24);
  }

  async function enterFullscreen() {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      startStatus.textContent = '';
    } catch {
      startStatus.textContent = '未能进入全屏；建议使用 Chrome/Edge 应用模式打开。';
    }
  }

  function startGame() {
    soundEnabled = soundToggle.checked;
    if (soundEnabled && !audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    state = 'PLAYING';
    startedAt = performance.now();
    breakIndex = 0;
    breakUntil = 0;
    gateStage = 0;
    awaitingRelease = false;
    window.clearTimeout(gateExpiryTimer);
    hideExitOverlay();
    clearEffects();
    showScreen('play');
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(tick);
  }

  function finishGame(reason = 'time') {
    if (state === 'FINISHED') return;
    state = 'FINISHED';
    cancelAnimationFrame(rafId);
    clearEffects();
    progress.style.width = '100%';
    showScreen('finish');
    if (reason === 'fullscreen') {
      document.querySelector('#finish-screen .finish-small').textContent = '全屏已退出，游戏已安全锁定。';
    }
  }

  function enterBreak(now) {
    state = 'BREAK';
    breakUntil = Math.min(startedAt + TOTAL_MS, now + BREAK_MS);
    clearEffects();
    showScreen('break');
  }

  function tick(now) {
    if (state !== 'PLAYING' && state !== 'BREAK') return;
    const elapsed = now - startedAt;
    if (elapsed >= TOTAL_MS) {
      finishGame();
      return;
    }
    progress.style.width = `${Math.min(100, (elapsed / TOTAL_MS) * 100)}%`;
    if (state === 'PLAYING' && breakIndex < BREAK_AT.length && elapsed >= BREAK_AT[breakIndex]) {
      enterBreak(now);
      breakIndex += 1;
    } else if (state === 'BREAK' && now >= breakUntil) {
      state = 'PLAYING';
      showScreen('play');
    }
    rafId = requestAnimationFrame(tick);
  }

  function requiredDown() {
    const has = (prefix) => [...down].some((code) => code.startsWith(prefix));
    return has('Control') && has('Alt') && has('Shift') && down.has('KeyQ');
  }

  function cancelGate() {
    window.clearTimeout(gateTimer);
    gateTimer = 0;
    gateStartedAt = 0;
    holdProgress.style.width = '0%';
  }

  function hideExitOverlay() {
    cancelGate();
    exitOverlay.classList.remove('visible');
    exitOverlay.setAttribute('aria-hidden', 'true');
    exitButton.hidden = true;
  }

  function showExitOverlay() {
    exitOverlay.classList.add('visible');
    exitOverlay.setAttribute('aria-hidden', 'false');
    exitButton.hidden = true;
    exitMessage.textContent = gateStage === 0 ? '请继续按住组合键……' : '已确认一次，请再次按住组合键……';
  }

  function beginGateHold() {
    if (!requiredDown() || gateTimer || awaitingRelease || gateStage >= 2) return;
    showExitOverlay();
    gateStartedAt = performance.now();
    const update = () => {
      if (!requiredDown()) { cancelGate(); return; }
      const ratio = Math.min(1, (performance.now() - gateStartedAt) / HOLD_MS);
      holdProgress.style.width = `${ratio * 100}%`;
      if (ratio >= 1) {
        gateTimer = 0;
        holdProgress.style.width = '100%';
        if (gateStage === 0) {
          gateStage = 1;
          awaitingRelease = true;
          exitMessage.textContent = '已确认一次，请松开后再次按住组合键……';
          window.clearTimeout(gateExpiryTimer);
          gateExpiryTimer = window.setTimeout(() => {
            if (gateStage === 1) {
              gateStage = 0;
              awaitingRelease = false;
              hideExitOverlay();
            }
          }, 5000);
        } else {
          gateStage = 2;
          window.clearTimeout(gateExpiryTimer);
          exitMessage.textContent = '家长确认完成，可以结束游戏。';
          exitButton.hidden = false;
          exitButton.focus();
        }
        return;
      }
      gateTimer = window.setTimeout(update, 50);
    };
    gateTimer = window.setTimeout(update, 50);
  }

  function isModifierKey(code) { return code.startsWith('Control') || code.startsWith('Alt') || code.startsWith('Shift'); }

  function handleKeyDown(event) {
    down.add(event.code);
    if (event.key === 'Escape') {
      // Best-effort prevention; browser fullscreen ESC may be handled before
      // page JavaScript. The fullscreenchange handler keeps the game alive.
      event.preventDefault();
      return;
    }
    const reserved = event.ctrlKey || event.altKey || event.metaKey || ['Backspace', 'F5'].includes(event.key);
    if (reserved) event.preventDefault();
    beginGateHold();
    if (state === 'PLAYING' && !isModifierKey(event.code) && !reserved && !event.repeat) {
      addEffect(Math.random() > 0.5 ? 'orb' : 'face', randomBetween(20, 80), randomBetween(22, 76));
    }
  }

  function handleKeyUp(event) {
    down.delete(event.code);
    if (!requiredDown()) {
      cancelGate();
      if (awaitingRelease) awaitingRelease = false;
    }
  }

  function handlePointerMove(event) {
    if (state !== 'PLAYING') return;
    const now = performance.now();
    if (now - lastPointerAt < 140) return;
    lastPointerAt = now;
    const point = pointForEvent(event);
    addEffect('ripple', point.x, point.y);
  }

  function handlePointerDown(event) {
    if (state !== 'PLAYING') return;
    const point = pointForEvent(event);
    addEffect('bubble', point.x, point.y);
  }

  startButton.addEventListener('click', async () => {
    await enterFullscreen();
    startGame();
  });
  exitButton.addEventListener('click', async () => {
    hideExitOverlay();
    state = 'START';
    gateStage = 0;
    awaitingRelease = false;
    window.clearTimeout(gateExpiryTimer);
    clearEffects();
    showScreen('start');
    startStatus.textContent = '本次游戏已结束。';
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
  });
  window.addEventListener('keydown', handleKeyDown, { passive: false });
  window.addEventListener('keyup', handleKeyUp, { passive: true });
  window.addEventListener('blur', () => { down.clear(); cancelGate(); });
  stage.addEventListener('pointermove', handlePointerMove, { passive: true });
  stage.addEventListener('pointerdown', handlePointerDown, { passive: true });
  document.addEventListener('contextmenu', (event) => event.preventDefault());
  document.addEventListener('dragstart', (event) => event.preventDefault());
  document.addEventListener('selectstart', (event) => event.preventDefault());
  document.addEventListener('fullscreenchange', () => {
    // ESC is a browser-reserved fullscreen shortcut and cannot be cancelled
    // reliably from a page. Keep the game and its timer alive if it happens;
    // an app-mode window normally prevents the browser chrome from appearing.
    if ((state === 'PLAYING' || state === 'BREAK') && !document.fullscreenElement) {
      window.clearTimeout(fullscreenRetryTimer);
      fullscreenRetryTimer = window.setTimeout(() => {
        if (state !== 'PLAYING' && state !== 'BREAK') return;
        try {
          const request = document.documentElement.requestFullscreen();
          if (request && typeof request.catch === 'function') request.catch(() => {});
        } catch {
          // Re-entry may be rejected because ESC removed the user gesture.
        }
      }, 250);
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (state === 'PLAYING' || state === 'BREAK') rafId = requestAnimationFrame(tick);
  });

  showScreen('start');
})();
