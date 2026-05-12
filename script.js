document.addEventListener('DOMContentLoaded', () => {
    // ==========================================
    // SISTEMA DE LICENÇA (GOOGLE SHEETS)
    // ==========================================
    const licenseScreen = document.getElementById('licenseScreen');
    const licenseInput = document.getElementById('licenseInput');
    const activateBtn = document.getElementById('activateBtn');
    const licenseMsg = document.getElementById('licenseMsg');
    
    // Link do Google Apps Script
    const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxZwQK74ixs8fJBie_tXTEHDVF775b11fFviJpzR0AjQ1FBzq20GwqMyKM1_h9pWzqKaw/exec"; 

    // Verifica se já tem licença salva no navegador
    if (localStorage.getItem('botLicenseKey')) {
        licenseScreen.style.display = 'none';
    }

    activateBtn.addEventListener('click', async () => {
        const key = licenseInput.value.trim();
        if (!key) return;

        activateBtn.textContent = '⏳ Verificando no servidor...';
        activateBtn.disabled = true;

        try {
            // Validação Real no Google Sheets com tratamento melhorado
            const response = await fetch(`${SCRIPT_URL}?key=${encodeURIComponent(key)}`, {
                redirect: 'follow'
            });
            
            if (!response.ok) {
                throw new Error(`Erro HTTP: ${response.status}`);
            }

            const result = await response.json();
            console.log("Resposta do servidor:", result);
            
            // Aceita Ativo, ativo, ATIVO (ignorando letras maiúsculas/minúsculas) e confere o result.valid
            const isAtivo = result.status && result.status.trim().toLowerCase() === "ativo";
            
            if (result.valid === true || isAtivo) {
                licenseMsg.style.color = '#10b981';
                licenseMsg.textContent = `✅ Licença Válida! (Status: ${result.status})`;
                localStorage.setItem('botLicenseKey', key);
                setTimeout(() => licenseScreen.style.display = 'none', 1500);
            } else {
                licenseMsg.style.color = '#e63946';
                licenseMsg.textContent = `❌ Acesso Negado. (Status: ${result.status})`;
            }
        } catch(e) {
            console.error("Erro na requisição da licença:", e);
            licenseMsg.style.color = '#e63946';
            licenseMsg.textContent = `❌ Erro de conexão: ${e.message}. Tente novamente.`;
        }
        
        activateBtn.textContent = 'Acessar Painel';
        activateBtn.disabled = false;
    });

    // ==========================================
    // LÓGICA DO PAINEL
    // ==========================================
    const uiPaused = document.getElementById('isPaused');
    const uiPrivate = document.getElementById('monitorPrivate');
    const uiTrigger = document.getElementById('requireTrigger');
    
    const labelPaused = document.getElementById('label-isPaused');
    const labelPrivate = document.getElementById('label-monitorPrivate');
    const labelTrigger = document.getElementById('label-requireTrigger');

    function updateLabels(config) {
        uiPaused.checked = config.isPaused;
        uiPrivate.checked = config.monitorPrivate;
        uiTrigger.checked = config.requireTrigger;

        labelPaused.textContent = config.isPaused ? "⏸️ Pausado (Ignorando)" : "▶️ Rodando";
        labelPaused.style.color = config.isPaused ? "#fbbf24" : "#34d399";
        
        labelPrivate.textContent = config.monitorPrivate ? "👤 Privado + Grupos" : "👥 Apenas Grupos";
        
        labelTrigger.textContent = config.requireTrigger ? "🛡️ Obrigatório" : "⚠️ Qualquer número solto";
        labelTrigger.style.color = config.requireTrigger ? "#cbd5e1" : "#fbbf24";
    }

    async function fetchStatus() {
        const res = await fetch('/api/status');
        const config = await res.json();
        
        if (config.maxLimit !== undefined) {
            const maxLimitInput = document.getElementById('maxLimitInput');
            if (maxLimitInput) maxLimitInput.value = config.maxLimit;
        }

        updateLabels(config);
    }

    async function toggleSetting(setting) {
        const res = await fetch('/api/toggle', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ setting })
        });
        const config = await res.json();
        updateLabels(config);
    }

    uiPaused.addEventListener('change', () => toggleSetting('isPaused'));
    uiPrivate.addEventListener('change', () => toggleSetting('monitorPrivate'));
    uiTrigger.addEventListener('change', () => toggleSetting('requireTrigger'));

    const saveLimitBtn = document.getElementById('saveLimitBtn');
    if (saveLimitBtn) {
        saveLimitBtn.addEventListener('click', async () => {
            const maxLimitInput = document.getElementById('maxLimitInput');
            const limitVal = parseInt(maxLimitInput.value);
            if(isNaN(limitVal) || limitVal < 1) return alert('Valor de limite inválido!');
            
            saveLimitBtn.textContent = '⏳';
            const res = await fetch('/api/toggle', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ setting: 'maxLimit', value: limitVal })
            });
            const config = await res.json();
            updateLabels(config);
            
            saveLimitBtn.textContent = '✅ Salvo';
            saveLimitBtn.style.background = '#10b981';
            setTimeout(() => {
                saveLimitBtn.textContent = 'Salvar';
                saveLimitBtn.style.background = '#3b82f6';
            }, 2000);
        });
    }

    // Logs Fetching
    const logContainer = document.getElementById('logContainer');
    let lastLogCount = 0;

    async function fetchLogs() {
        try {
            const res = await fetch('/api/logs');
            const logs = await res.json();
            
            if (logs.length !== lastLogCount) {
                logContainer.innerHTML = '';
                logs.forEach(log => {
                    const div = document.createElement('div');
                    div.className = 'log-entry';
                    div.innerHTML = `<span class="log-time">[${log.time}]</span> <span class="log-type-${log.type}">${log.message}</span>`;
                    logContainer.appendChild(div);
                });
                lastLogCount = logs.length;
            }
        } catch(e) {}
    }

    const apiTokenInput = document.getElementById('apiToken');
    const saveTokenBtn = document.getElementById('saveTokenBtn');
    const autoTokenBtn = document.getElementById('autoTokenBtn');

    async function fetchToken() {
        try {
            const res = await fetch('/api/token');
            const data = await res.json();
            apiTokenInput.value = data.token;
        } catch(e) {}
    }

    saveTokenBtn.addEventListener('click', async () => {
        const token = apiTokenInput.value.trim();
        if(!token) return alert("O token não pode estar vazio!");
        
        saveTokenBtn.textContent = 'Salvando...';
        await fetch('/api/token', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ token })
        });
        
        saveTokenBtn.textContent = 'Salvo com Sucesso!';
        setTimeout(() => { saveTokenBtn.textContent = '💾 Salvar'; }, 2000);
    });

    const siteUrlInput = document.getElementById('siteUrl');
    const openSiteBtn = document.getElementById('openSiteBtn');
    const copyScriptBtn = document.getElementById('copyScriptBtn');

    openSiteBtn.addEventListener('click', () => {
        let url = siteUrlInput.value.trim();
        if (!url) return alert("Insira o link da casa de apostas!");
        if (!url.startsWith('http')) url = 'https://' + url;
        window.open(url, '_blank');
    });

    copyScriptBtn.addEventListener('click', () => {
        // Script Mágico Definitivo (Captura Headers e o ID de Pagamento Atualizado)
        const magicScript = `javascript:(function(){function e(h,b){let p=4661;try{if(b&&typeof b==='string'){let j=JSON.parse(b);if(j.json&&j.json.payTypeSubId)p=j.json.payTypeSubId;}}catch(x){}prompt('✅ SUCESSO! Copie TODO O TEXTO ABAIXO e cole na caixa do Painel Web:',JSON.stringify({headers:h,payTypeSubId:p}));}var F=window.fetch;window.fetch=function(u,o){if(u&&typeof u==='string'&&u.includes('pay.create')){var h={};if(o&&o.headers){if(o.headers.entries)for(var k of o.headers.entries())h[k[0]]=k[1];else h=o.headers;}e(h,o&&o.body);}return F.apply(this,arguments);};var X=XMLHttpRequest.prototype;var O=X.open;var S=X.send;var H=X.setRequestHeader;X.open=function(m,u){this._u=u;this._h={};return O.apply(this,arguments);};X.setRequestHeader=function(h,v){this._h[h]=v;return H.apply(this,arguments);};X.send=function(b){if(this._u&&this._u.includes('pay.create'))e(this._h,b);return S.apply(this,arguments);};alert('O Robô está ativo na sua guia! Agora clique no botão de depositar (PIX) no site e a sua chave mestra aparecerá na tela.');})();`;
        
        navigator.clipboard.writeText(magicScript).then(() => {
            copyScriptBtn.textContent = '✅ Copiado!';
            copyScriptBtn.style.background = '#10b981';
            setTimeout(() => {
                copyScriptBtn.textContent = '🪄 2. Copiar Código Mágico';
                copyScriptBtn.style.background = '#8b5cf6';
            }, 3000);
        }).catch(err => {
            alert("Erro ao copiar o código. Tente novamente.");
        });
    });

    setInterval(fetchLogs, 1500); // Atualiza os logs a cada 1.5s
    
    // ==========================================
    // QR CODE FETCHING
    // ==========================================
    const qrCodeContainer = document.getElementById('qrCodeContainer');
    const qrCodeImg = document.getElementById('qrCodeImg');
    const connectedBadge = document.getElementById('connectedBadge');
    const loadingBadge = document.getElementById('loadingBadge');

    async function fetchQR() {
        try {
            const res = await fetch('/api/qr');
            const data = await res.json();
            
            if (data.connected) {
                qrCodeContainer.style.display = 'none';
                loadingBadge.style.display = 'none';
                connectedBadge.style.display = 'block';
            } else if (data.qr) {
                qrCodeImg.src = data.qr;
                qrCodeContainer.style.display = 'block';
                loadingBadge.style.display = 'none';
                connectedBadge.style.display = 'none';
            } else {
                qrCodeContainer.style.display = 'none';
                loadingBadge.style.display = 'block';
                connectedBadge.style.display = 'none';
            }
        } catch(e) {}
    }

    setInterval(fetchQR, 2000); // Checa o QR Code a cada 2 segundos
    fetchQR();
    fetchStatus();

});
