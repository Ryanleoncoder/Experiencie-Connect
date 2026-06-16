function infraDebugLog(...args) {
  if (typeof window !== 'undefined' && window.CX_DEBUG === true) {
    console.debug(...args);
  }
}

function showInfrastructureError(message, retryCallback) {
    const existing = document.getElementById('infrastructure-error-modal');
    if (existing) existing.remove();

    if (!document.getElementById('ec-infra-error-styles')) {
        const s = document.createElement('style');
        s.id = 'ec-infra-error-styles';
        s.textContent = `
            @keyframes ecModalIn {
                from { opacity: 0; transform: translateY(12px) scale(.97); }
                to   { opacity: 1; transform: translateY(0) scale(1); }
            }
            #infrastructure-error-modal {
                position: fixed; inset: 0; z-index: 10000;
                display: flex; align-items: center; justify-content: center;
                padding: 20px;
            }
            .ec-infra-backdrop {
                position: absolute; inset: 0;
                background: rgba(10,10,10,.55);
            }
            .ec-infra-card {
                position: relative;
                background: #F5F0E6;
                border: 3px solid #0A0A0A;
                border-radius: 18px;
                box-shadow: 8px 8px 0 #0A0A0A;
                padding: 32px 28px;
                max-width: 460px;
                width: 100%;
                text-align: center;
                font-family: 'DM Sans', system-ui, sans-serif;
                animation: ecModalIn 0.2s cubic-bezier(.4,0,.2,1);
            }
            .ec-infra-icon {
                width: 48px; height: 48px;
                background: #FFE5E5;
                border: 2px solid #0A0A0A;
                border-radius: 50%;
                display: flex; align-items: center; justify-content: center;
                margin: 0 auto 20px;
            }
            .ec-infra-title {
                font-size: 20px; font-weight: 800;
                color: #0A0A0A; margin-bottom: 10px;
            }
            .ec-infra-msg {
                font-size: 14px; color: #48443F;
                line-height: 1.5; margin-bottom: 8px;
            }
            .ec-infra-reassurance {
                font-size: 13px; font-weight: 700;
                color: #16BF5C; margin-bottom: 28px;
            }
            .ec-infra-btn {
                display: inline-flex; align-items: center; justify-content: center;
                gap: 6px;
                background: #FFC700;
                color: #0A0A0A;
                border: 2px solid #0A0A0A;
                border-radius: 8px;
                box-shadow: 3px 3px 0 #0A0A0A;
                padding: 12px 28px;
                font-family: 'DM Sans', system-ui, sans-serif;
                font-size: 14px; font-weight: 700;
                text-transform: uppercase; letter-spacing: .01em;
                cursor: pointer;
                transition: box-shadow 80ms, transform 80ms;
            }
            .ec-infra-btn:hover {
                box-shadow: 5px 5px 0 #0A0A0A;
                transform: translate(-1px, -1px);
            }
            .ec-infra-btn:active {
                box-shadow: 1px 1px 0 #0A0A0A;
                transform: translate(2px, 2px);
            }
            @media (max-width: 600px) {
                .ec-infra-card { padding: 24px 18px; }
                .ec-infra-btn { width: 100%; }
            }
        `;
        document.head.appendChild(s);
    }

    const modal = document.createElement('div');
    modal.id = 'infrastructure-error-modal';
    modal.innerHTML = `
        <div class="ec-infra-backdrop"></div>
        <div class="ec-infra-card">
            <div class="ec-infra-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#FF3B3B" stroke-width="2" stroke-linecap="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                    <line x1="12" y1="9" x2="12" y2="13"/>
                    <circle cx="12" cy="17" r=".5" fill="#FF3B3B"/>
                </svg>
            </div>
            <h3 class="ec-infra-title">Erro de Conexão</h3>
            <p class="ec-infra-msg">${message}</p>
            <p class="ec-infra-reassurance">Sua tentativa não foi consumida.</p>
            <button class="ec-infra-btn" id="ec-infra-action">
                Voltar para Início
            </button>
        </div>
    `;

    modal.querySelector('#ec-infra-action').addEventListener('click', () => {
        modal.remove();
        window.location.href = '/app';
    });

    modal.querySelector('.ec-infra-backdrop').addEventListener('click', () => modal.remove());

    document.body.appendChild(modal);
}

function showValidationError(message) {
    infraDebugLog('[Validation Error]', message);
}

if (typeof window !== 'undefined') {
    window.InfrastructureErrorUI = {
        showInfrastructureError,
        showValidationError
    };
}
