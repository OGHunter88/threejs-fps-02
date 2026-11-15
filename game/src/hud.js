// The HUD: health, ammunition, the round timer, the score, the money, the
// kill feed, the bomb, and the three overlays (menu, buy, round banner). The
// DOM lives in index.html; this module only drives it, so the game logic
// never touches the document directly.
import { WEAPONS, GRENADE, BUY_MENU } from './weapons.js';

export function createHud(callbacks) {
  const el = (id) => document.getElementById(id);
  const healthFill = el('health-fill');
  const healthValue = el('health-value');
  const ammoMag = el('ammo-mag');
  const ammoReserve = el('ammo-reserve');
  const timerValue = el('timer-value');
  const scoreV = el('score-v');
  const scoreR = el('score-r');
  const moneyValue = el('money-value');
  const grenadesValue = el('grenades-value');
  const killfeed = el('killfeed');
  const bombStatus = el('bomb-status');
  const progress = el('progress');
  const progressLabel = el('progress-label');
  const progressFill = el('progress-fill');
  const overlay = el('overlay');
  const overlayTitle = el('overlay-title');
  const overlayCopy = el('overlay-copy');
  const playButton = el('play');
  const buyPanel = el('buy');
  const buyMoney = el('buy-money');
  const buyList = el('buy-list');
  const banner = el('banner');
  const bannerTitle = el('banner-title');
  const bannerSub = el('banner-sub');
  const hitmarker = el('hitmarker');
  const crosshair = el('crosshair');
  const scoped = el('scoped');

  let hitTimer = 0;

  // The buy menu is built once from the armoury; each row is a button.
  for (const item of BUY_MENU) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'buy-row';
    row.dataset.item = item.id;
    row.innerHTML = `<span class="buy-name">${item.name}</span><span class="buy-price">$${item.price}</span>`;
    row.addEventListener('click', () => callbacks.onBuy(item.id));
    buyList.appendChild(row);
  }

  playButton.addEventListener('click', () => callbacks.onPlay());
  el('buy-close').addEventListener('click', () => callbacks.onBuyClose());
  el('again').addEventListener('click', () => callbacks.onPlayAgain());

  function formatTime(seconds) {
    const s = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  return {
    setHealth(hp) {
      healthValue.textContent = String(Math.max(0, Math.ceil(hp)));
      healthFill.style.width = `${Math.max(0, Math.min(100, hp))}%`;
      healthFill.classList.toggle('low', hp <= 30);
    },
    setAmmo(mag, reserve) {
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = `/ ${reserve}`;
      el('ammo').classList.toggle('empty', mag === 0);
    },
    setGrenades(n) {
      grenadesValue.textContent = `Grenades ${n}`;
    },
    setTimer(seconds, phase) {
      timerValue.textContent = formatTime(seconds);
      timerValue.parentElement.classList.toggle('freeze', phase === 'freeze');
    },
    setScore(v, r) {
      scoreV.textContent = String(v);
      scoreR.textContent = String(r);
    },
    setMoney(money) {
      moneyValue.textContent = `$${money}`;
      buyMoney.textContent = `$${money}`;
      for (const row of buyList.children) {
        const item = BUY_MENU.find((i) => i.id === row.dataset.item);
        row.classList.toggle('cant', money < item.price);
      }
    },
    markBought(itemId) {
      const row = buyList.querySelector(`[data-item="${itemId}"]`);
      if (row) row.classList.add('owned');
    },
    resetBuy() {
      for (const row of buyList.children) row.classList.remove('owned');
    },
    killfeed(killer, victim, headshot) {
      const line = document.createElement('div');
      line.className = 'feed-line';
      line.innerHTML = `<b>${killer}</b> ${headshot ? '◉' : '×'} <b>${victim}</b>`;
      killfeed.prepend(line);
      while (killfeed.children.length > 5) killfeed.removeChild(killfeed.lastChild);
      window.setTimeout(() => line.remove(), 6000);
    },
    showBomb(text, kind) {
      bombStatus.textContent = text;
      bombStatus.className = kind ? `show ${kind}` : '';
    },
    setProgress(label, frac) {
      if (frac === null) {
        progress.hidden = true;
        return;
      }
      progress.hidden = false;
      progressLabel.textContent = label;
      progressFill.style.width = `${Math.round(frac * 100)}%`;
    },
    hitMarker(kill) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', kill);
      window.clearTimeout(hitTimer);
      hitTimer = window.setTimeout(() => hitmarker.classList.remove('on', 'kill'), 120);
    },
    setScoped(on) {
      scoped.hidden = !on;
      crosshair.style.opacity = on ? '0' : '';
    },
    showBanner(title, sub, kind) {
      bannerTitle.textContent = title;
      bannerSub.textContent = sub;
      banner.className = `show ${kind || ''}`;
      window.setTimeout(() => banner.classList.remove('show'), 3600);
    },
    showOverlay(kind, data) {
      overlay.hidden = false;
      playButton.hidden = false;
      el('again').hidden = true;
      if (kind === 'start') {
        overlayTitle.textContent = 'DUSTLINE';
        overlayCopy.textContent = 'A round-based tactical shooter. Hold Yard 7 against the Raiders, or lose the sites. Click to play.';
        playButton.textContent = 'Click to play';
      } else if (kind === 'paused') {
        overlayTitle.textContent = 'Paused';
        overlayCopy.textContent = `Round ${data.round} · Vanguard ${data.v} — ${data.r} Raiders`;
        playButton.textContent = 'Resume';
      } else if (kind === 'end') {
        overlayTitle.textContent = data.won ? 'Match won' : 'Match lost';
        overlayCopy.textContent = `Vanguard ${data.v} — ${data.r} Raiders · ${data.reason}`;
        playButton.hidden = true;
        el('again').hidden = false;
      }
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    showBuy(open) {
      buyPanel.hidden = !open;
    },
    isBuyOpen() {
      return !buyPanel.hidden;
    },
  };
}
