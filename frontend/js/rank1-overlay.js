const RANK1_CONFIG = {
  POSTER_URL: 'https://late-dream-58c0.rysn-craft.workers.dev/',
  PHRASES: [
    { white: 'DO THE', yellow: 'IMPOSSIBLE' },
    { white: 'SEE THE', yellow: 'INVISIBLE' },
    { white: 'TOUCH THE', yellow: 'UNTOUCHABLE' },
    { white: 'BREAK THE', yellow: 'UNBREAKABLE' },
  ],
  PHRASE_DURATION: 1050,
  PHRASE_EXIT_WAIT: 380,
  POWER_DURATION: 1400,
  PARTICLE_COUNT_MOBILE: 38,
  PARTICLE_COUNT_DESKTOP: 65
};

let posterReady = false;
let cinematicActive = false;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function spawnParticles() {
  const container = document.getElementById('rank1-particles');
  if (!container) return;

  container.innerHTML = '';
  const count = window.innerWidth < 600
    ? RANK1_CONFIG.PARTICLE_COUNT_MOBILE
    : RANK1_CONFIG.PARTICLE_COUNT_DESKTOP;

  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    const size = Math.random() * 5 + 2;
    const left = Math.random() * 100;
    const delay = Math.random() * 8;
    const dur = 5 + Math.random() * 9;
    const startY = 80 + Math.random() * 30;

    p.style.cssText = `
      width: ${size}px;
      height: ${size}px;
      left: ${left}%;
      bottom: ${startY - 80}%;
      animation-delay: ${delay}s;
      animation-duration: ${dur}s;
      opacity: 0;
    `;
    container.appendChild(p);
  }
}

function buildPhraseEl(data) {
  const el = document.createElement('div');
  el.className = 'phrase';
  el.innerHTML = `<span style="color:var(--rank1-white);display:block">${data.white}</span><span class="yellow">${data.yellow}</span>`;
  return el;
}

function preloadPosterImage() {
  return new Promise((resolve) => {
    if (posterReady) {
      resolve(true);
      return;
    }

    const img = new Image();
    img.onload = () => {
      posterReady = true;
      resolve(true);
    };
    img.onerror = () => {
      posterReady = false;
      console.error('[Rank1] Failed to load poster image');
      resolve(false);
    };
    img.src = RANK1_CONFIG.POSTER_URL;
  });
}

async function execCinematicPosterOverlay() {
  if (cinematicActive) return;

  cinematicActive = true;

  const overlay = document.getElementById('rank1-cinematic-overlay');
  const home = document.getElementById('main-content');
  const header = document.getElementById('header');

  if (!overlay) {
    console.error('[Rank1] Overlay element not found');
    cinematicActive = false;
    return;
  }

  if (home) home.style.filter = 'blur(8px) brightness(0.35)';
  if (header) header.style.filter = 'blur(8px) brightness(0.35)';

  overlay.classList.add('active');
  spawnParticles();

  await sleep(300);

  const phrases = document.getElementById('rank1-intro-phrases');
  if (phrases) {
    phrases.innerHTML = '';

    for (let i = 0; i < RANK1_CONFIG.PHRASES.length; i++) {
      const el = buildPhraseEl(RANK1_CONFIG.PHRASES[i]);
      phrases.appendChild(el);

      await sleep(20);
      el.classList.add('visible');
      await sleep(RANK1_CONFIG.PHRASE_DURATION);
      el.classList.remove('visible');
      el.classList.add('exit');
      await sleep(RANK1_CONFIG.PHRASE_EXIT_WAIT);
      phrases.innerHTML = '';
    }
  }

  const power = document.getElementById('rank1-power-block');
  if (power) {
    power.classList.add('visible');
    await sleep(RANK1_CONFIG.POWER_DURATION);
    power.classList.remove('visible');
    power.classList.add('exit');
    await sleep(500);
    power.classList.remove('exit');
  }

  await revealPoster();
}

async function revealPoster() {
  const stage = document.getElementById('rank1-poster-stage');
  const poster = document.getElementById('rank1-poster');
  const closeBtn = document.getElementById('rank1-close-btn');
  const continueBtn = document.getElementById('rank1-continue-btn');

  if (!stage || !poster) {
    console.error('[Rank1] Poster elements not found');
    return;
  }

  poster.src = RANK1_CONFIG.POSTER_URL;

  await new Promise((resolve) => {
    if (poster.complete && poster.naturalWidth > 0) {
      posterReady = true;
      resolve();
      return;
    }

    poster.onload = () => {
      posterReady = true;
      resolve();
    };

    poster.onerror = () => {
      console.error('[Rank1] Failed to load poster');
      poster.style.background = 'linear-gradient(135deg, rgba(255,208,0,0.1), rgba(255,208,0,0.05))';
      poster.style.border = '2px dashed rgba(255,208,0,0.3)';
      resolve();
    };

    setTimeout(() => {
      if (!posterReady) resolve();
    }, 10000);
  });

  stage.classList.add('visible');
  await sleep(80);
  poster.classList.add('revealed');
  await sleep(600);
  if (closeBtn) closeBtn.classList.add('visible');
  await sleep(100);
  if (continueBtn) continueBtn.classList.add('visible');
}

function closeRank1Overlay() {
  localStorage.setItem('rank1-overlay-seen', 'true');

  const overlay = document.getElementById('rank1-cinematic-overlay');
  const home = document.getElementById('main-content');
  const header = document.getElementById('header');
  const closeBtn = document.getElementById('rank1-close-btn');
  const continueBtn = document.getElementById('rank1-continue-btn');
  const stage = document.getElementById('rank1-poster-stage');
  const power = document.getElementById('rank1-power-block');
  const phrases = document.getElementById('rank1-intro-phrases');
  const poster = document.getElementById('rank1-poster');

  if (!overlay) return;

  overlay.style.transition = 'opacity 0.5s ease';
  overlay.style.opacity = '0';

  setTimeout(() => {
    overlay.classList.remove('active');
    overlay.style.opacity = '';
    overlay.style.transition = '';

    if (stage) stage.classList.remove('visible');
    if (closeBtn) closeBtn.classList.remove('visible');
    if (continueBtn) continueBtn.classList.remove('visible');
    if (poster) poster.classList.remove('revealed');
    if (power) power.classList.remove('visible', 'exit');
    if (phrases) phrases.innerHTML = '';
    if (home) home.style.filter = '';
    if (header) header.style.filter = '';

    cinematicActive = false;
  }, 500);
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && cinematicActive) {
    closeRank1Overlay();
  }
});

async function checkAndExecuteRank1Overlay(currentRank) {
  const lastRank = localStorage.getItem('last-user-rank');
  const alreadySeen = localStorage.getItem('rank1-overlay-seen') === 'true';
  const enteredRankOne = currentRank === 1 && lastRank !== '1';

  if (enteredRankOne) {
    localStorage.removeItem('rank1-overlay-seen');
  }

  localStorage.setItem('last-user-rank', String(currentRank));

  if (currentRank === 1 && !alreadySeen) {
    await preloadPosterImage();
    await execCinematicPosterOverlay();
    localStorage.setItem('rank1-overlay-seen', 'true');
  }
}

window.Rank1Overlay = {
  check: checkAndExecuteRank1Overlay,
  close: closeRank1Overlay,
  preload: preloadPosterImage
};
