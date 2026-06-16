document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('register-form');
    const card = document.getElementById('register-card');

    if (form) form.style.display = 'none';

    const disabledMessage = document.createElement('div');
    disabledMessage.className = 'registration-disabled';
    disabledMessage.innerHTML = `
        <div style="text-align: center; padding: 2rem;">
            <img src="./frontend/assets/image/icons8-alert-96.apng.png"
                 alt="Alert"
                 style="width: 64px; height: 64px; filter: invert(1) brightness(2); margin-bottom: 1.5rem;">
            <h2 style="color: #FFC700; font-size: 1.5rem; margin-bottom: 1rem;">
                Cadastro Temporariamente Desativado
            </h2>
            <p style="color: #7A7570; margin-bottom: 1.5rem; line-height: 1.6;">
                O cadastro publico esta temporariamente desativado.<br>
                Para criar uma conta, voce precisa de um convite.
            </p>
            <div style="display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap;">
                <a href="login.html" class="login-btn" style="text-decoration: none; display: inline-flex; align-items: center; justify-content: center; padding: 0.75rem 1.5rem;">
                    <span class="btn-text">Ir para Login</span>
                </a>
            </div>
        </div>
    `;

    if (card) {
        const title = card.querySelector('.card-title');
        const subtitle = card.querySelector('.card-subtitle');
        const footer = card.querySelector('.card-footer-text');

        if (title) title.style.display = 'none';
        if (subtitle) subtitle.style.display = 'none';
        if (footer) footer.style.display = 'none';

        card.insertBefore(disabledMessage, form);
    }
});
