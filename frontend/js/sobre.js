function getStorageType() {
    if (sessionStorage.getItem('cx_logged_in_user')) {
        return sessionStorage;
    }
    if (localStorage.getItem('cx_logged_in_user')) {
        return localStorage;
    }
    return window.CxSession?.getPrimaryStorage?.() || sessionStorage;
}

function getUsersData() {
    const storage = getStorageType();
    return JSON.parse(storage.getItem('cx_users') || '{}');
}

function initSpaceBackground() {
    const canvas = document.getElementById('space-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const palette = {
        stars: ['rgba(255,255,255,0.9)', 'rgba(108,225,245,0.9)', 'rgba(246,201,14,0.9)'],
        asteroid: 'rgba(180, 192, 210, 0.35)',
        asteroidCore: 'rgba(120, 136, 158, 0.55)',
        rings: 'rgba(255,255,255,0.22)'
    };

    const planetImages = [];
    const planetImageCount = 10;
    for (let i = 0; i < planetImageCount; i++) {
        const img = new Image();
        img.src = `./frontend/assets/image/Planets/planet0${i}.png`;
        planetImages.push(img);
    }

    let dpr = window.devicePixelRatio || 1;
    let width = 0;
    let height = 0;
    let stars = [];
    let asteroids = [];
    let planets = [];
    let lastTime = performance.now();

    function resize() {
        width = canvas.clientWidth;
        height = canvas.clientHeight || window.innerHeight;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        stars = buildStars(140);
        asteroids = buildAsteroids(10);
        planets = buildPlanets();
    }

    function buildStars(count) {
        return Array.from({ length: count }, () => ({
            x: Math.random() * width,
            y: Math.random() * height,
            speed: 12 + Math.random() * 22, // px/s
            size: 0.6 + Math.random() * 1.2,
            tw: Math.random() * Math.PI * 2,
            parallax: 0.02 + Math.random() * 0.05,
            color: palette.stars[Math.floor(Math.random() * palette.stars.length)]
        }));
    }

    function buildAsteroids(count) {
        return Array.from({ length: count }, () => spawnAsteroid());
    }

    function spawnAsteroid(fromRight = Math.random() > 0.5) {
        const size = 16 + Math.random() * 26;
        const speed = 18 + Math.random() * 24;
        return {
            x: fromRight ? width + Math.random() * width * 0.4 : -Math.random() * width * 0.4,
            y: Math.random() * height,
            vx: fromRight ? -speed : speed,
            vy: (Math.random() - 0.5) * 8,
            size,
            rotation: Math.random() * Math.PI * 2,
            spin: (Math.random() - 0.5) * 0.4
        };
    }

    function buildPlanets() {
        const base = [
            { r: 78, speed: 6, imgIdx: 0 },
            { r: 54, speed: 4, imgIdx: 1 },
            { r: 66, speed: 5, imgIdx: 2 },
            { r: 60, speed: 3.5, imgIdx: 3 },
            { r: 48, speed: 2.8, imgIdx: 4 },
            { r: 72, speed: 4.5, imgIdx: 5 }
        ];
        return base.map((p, i) => ({
            ...p,
            x: (width / base.length) * (i + 0.5) + Math.random() * 120,
            y: height * (0.18 + Math.random() * 0.55),
            offset: Math.random() * Math.PI * 2,
            imgIdx: p.imgIdx % planetImages.length
        }));
    }

    function drawStar(star, scroll) {
        const y = (star.y + scroll * star.parallax) % height;
        const twinkle = 0.55 + 0.35 * Math.sin(performance.now() * 0.002 + star.tw);
        const color = star.color.replace('0.9', twinkle.toFixed(2));
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(star.x, y < 0 ? y + height : y, star.size, 0, Math.PI * 2);
        ctx.fill();
    }

    function drawAsteroid(ast) {
        ctx.save();
        ctx.translate(ast.x, ast.y);
        ctx.rotate(ast.rotation);
        const gradient = ctx.createRadialGradient(0, 0, ast.size * 0.25, 0, 0, ast.size);
        gradient.addColorStop(0, palette.asteroidCore);
        gradient.addColorStop(1, palette.asteroid);
        ctx.fillStyle = gradient;
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
            const angle = (Math.PI * 2 * i) / 8;
            const radius = ast.size * (0.7 + Math.random() * 0.35);
            ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    function drawPlanet(p, scroll) {
        ctx.save();
        const scrollY = (scroll * 0.05) % height;
        const y = p.y + scrollY;
        const img = planetImages[p.imgIdx % planetImages.length];
        if (img.complete && img.naturalWidth > 0) {
            ctx.drawImage(
                img,
                p.x - p.r,
                y - p.r,
                p.r * 2,
                p.r * 2
            );
        } else {
            ctx.beginPath();
            ctx.arc(p.x, y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = '#444';
            ctx.fill();
        }
        ctx.restore();
    }

    function step(now) {
        const dt = now - lastTime;
        lastTime = now;
        const scroll = window.scrollY || window.pageYOffset || 0;

        ctx.clearRect(0, 0, width, height);

        stars.forEach(star => {
            star.x -= (star.speed * dt) / 1000;
            if (star.x < -2) {
                star.x = width + 2;
                star.y = Math.random() * height;
            }
            drawStar(star, scroll);
        });

        asteroids.forEach((ast, i) => {
            ast.x += (ast.vx * dt) / 1000;
            ast.y += (ast.vy * dt) / 1000;
            ast.rotation += (ast.spin * dt) / 1000;

            if (ast.x < -ast.size * 2 || ast.x > width + ast.size * 2 || ast.y < -60 || ast.y > height + 60) {
                asteroids[i] = spawnAsteroid(ast.vx > 0);
            }
            drawAsteroid(ast);
        });

        planets.forEach(p => {
            p.x -= (p.speed * dt) / 1000;
            if (p.x < -p.r * 2) p.x = width + p.r * 2;
            drawPlanet(p, scroll);
        });

        requestAnimationFrame(step);
    }

    resize();
    window.addEventListener('resize', resize, { passive: true });
    requestAnimationFrame(step);
}

function getAuthState() {
    const loggedUser = window.CxSession?.getSessionValue?.('cx_logged_in_user') || localStorage.getItem('cx_logged_in_user') || sessionStorage.getItem('cx_logged_in_user');
    const loggedFlag = window.CxSession?.hasActiveSession?.() || localStorage.getItem('loggedIn') || sessionStorage.getItem('loggedIn');
    const users = getUsersData();
    const user = loggedUser ? users[loggedUser] : null;
    return { isLogged: Boolean(loggedUser && loggedFlag && user), user };
}

function updateAuthUI() {
    const { isLogged } = getAuthState();

    const authBtn = document.getElementById('auth-action-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const loginTopLink = document.querySelector('.top-nav__link[href="login.html"]');
    const ctaBtn = document.getElementById('cta-btn');
    const ctaBottom = document.getElementById('cta-bottom');

    const goLogin = () => window.location.href = 'login.html';
    const goPlay = () => window.location.href = '/app';

    if (authBtn) {
        if (isLogged) {
            authBtn.style.display = 'none';
        } else {
            authBtn.style.display = '';
            authBtn.textContent = 'Fazer login';
            authBtn.onclick = goLogin;
        }
    }

    if (logoutBtn) {
        if (isLogged) {
            logoutBtn.style.display = '';
            logoutBtn.onclick = handleLogout;
        } else {
            logoutBtn.style.display = 'none';
        }
    }

    if (loginTopLink) {
        loginTopLink.style.display = isLogged ? 'none' : '';
    }

    const setCta = (btn, primary) => {
        if (!btn) return;
        btn.textContent = isLogged
            ? (primary ? 'Começar o desafio' : 'Continuar trilha')
            : (primary ? 'Fazer login para começar' : 'Explorar desafios');
        btn.onclick = isLogged ? goPlay : goLogin;
    };

    setCta(ctaBtn, true);
    setCta(ctaBottom, true);
}

async function handleLogout() {
    document.body.style.opacity = '0';
    document.body.style.transition = 'opacity 0.4s ease';
    
    setTimeout(() => {
        window.CxSession?.clearSessionState?.();
        window.location.replace('login.html');
    }, 400);
}

function wireSecondaryButtons() {
    const toLoginOrHome = () => {
        const { isLogged } = getAuthState();
        window.location.href = isLogged ? '/app' : 'login.html';
    };

    const secondaryTop = document.getElementById('secondary-btn');
    const secondaryBottom = document.getElementById('cta-bottom-secondary');

    if (secondaryTop) secondaryTop.onclick = toLoginOrHome;
    if (secondaryBottom) secondaryBottom.onclick = toLoginOrHome;
}

function animateProgress() {
    const bar = document.querySelector('.progress-bar__fill');
    if (!bar) return;
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                bar.style.transition = 'width 1.2s cubic-bezier(0.34, 1.56, 0.64, 1)';
                bar.style.width = bar.dataset.target || bar.style.width || '62%';
                observer.disconnect();
            }
        });
    }, { threshold: 0.4 });
    observer.observe(bar);
}

document.addEventListener('DOMContentLoaded', () => {
    updateAuthUI();
    wireSecondaryButtons();
    animateProgress();
    initSpaceBackground();
});
