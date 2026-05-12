const { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const fs = require('fs');
const axios = require('axios');
const https = require('https');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode'); 
const readline = require('readline');
const express = require('express');
const path = require('path'); 

let currentQRDataURL = ""; 
let isConnected = false; 

const apiClient = axios.create({
    httpsAgent: new https.Agent({ keepAlive: true })
});

let CONFIG = {
    isPaused: false,
    monitorPrivate: true, 
    requireTrigger: true,
    maxLimit: 1000 
};

try {
    if (fs.existsSync('config.json')) {
        const savedConfig = JSON.parse(fs.readFileSync('config.json', 'utf8'));
        CONFIG = { ...CONFIG, ...savedConfig };
    }
} catch(e) {
    console.error("Erro ao carregar config.json", e);
}

function salvarConfig() {
    fs.writeFileSync('config.json', JSON.stringify(CONFIG, null, 2));
}

let recentLogs = [];
function addLog(type, message) {
    const time = new Date().toLocaleTimeString();
    recentLogs.unshift({ time, type, message }); 
    if (recentLogs.length > 100) recentLogs.pop(); 
    
    if(type === 'error') console.error(`[${time}] ❌ ${message}`);
    else if(type === 'success') console.log(`[${time}] ✅ ${message}`);
    else if(type === 'warn') console.log(`[${time}] ⚠️ ${message}`);
    else console.log(`[${time}] ℹ️ ${message}`);
}

let frasesEfeito = [];
let proibidas = [];
let frasesQR = [];

try {
    frasesEfeito = fs.readFileSync('frases-efeito.txt', 'utf8').split('\n').map(l => l.trim().toLowerCase()).filter(Boolean);
    proibidas = fs.readFileSync('proibidas.txt', 'utf8').split('\n').map(l => l.trim().toLowerCase()).filter(Boolean);
    
    if (fs.existsSync('frases-qr.txt')) {
        frasesQR = fs.readFileSync('frases-qr.txt', 'utf8').split('\n').map(l => l.trim().toLowerCase()).filter(Boolean);
    } else {
        frasesQR = ['foto qr', 'imagem qr', 'qr code']; 
    }

    addLog('info', `Listas carregadas: ${frasesEfeito.length} gatilhos, ${frasesQR.length} para QR Imagem e ${proibidas.length} proibidas.`);
} catch (e) {
    addLog('error', "Arquivos de frases não encontrados!");
}

function extrairValor(texto) {
    let t = texto.toLowerCase();
    let matchK = t.match(/(\d+(?:[.,]\d+)?)\s*k\b/);
    if (matchK) return parseFloat(matchK[1].replace(',', '.')) * 1000;
    let matchMil = t.match(/(\d+(?:[.,]\d+)?)\s*mil\b/);
    if (matchMil) return parseFloat(matchMil[1].replace(',', '.')) * 1000;
    let nums = t.replace(/[^\d.,]/g, '');
    if (!nums) return null;
    while (/\.\d{3}/.test(nums)) { nums = nums.replace(/\.(\d{3})/, '$1'); }
    let val = parseFloat(nums.replace(',', '.'));
    if (val < 1) return null;
    return Math.floor(val);
}

async function gerarQRCodeImagem(pixCode) {
    try {
        const buffer = await QRCode.toBuffer(pixCode, {
            errorCorrectionLevel: 'M', 
            type: 'image/png',
            quality: 0.8,
            margin: 1,
            width: 350, 
        });
        return buffer;
    } catch (erro) {
        addLog('error', `Erro ao gerar imagem QR Code: ${erro.message}`);
        return null;
    }
}

let cachedTokenContent = "";
try { cachedTokenContent = fs.readFileSync('token.txt', 'utf8').trim(); } catch(e) {}

const app = express();
app.use(express.json());
app.use(express.static(__dirname)); 

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/status', (req, res) => res.json(CONFIG));
app.post('/api/toggle', (req, res) => {
    const { setting, value } = req.body;
    if (CONFIG[setting] !== undefined) {
        if (value !== undefined) { CONFIG[setting] = value; } 
        else { CONFIG[setting] = !CONFIG[setting]; }
        addLog('warn', `Configuração alterada: ${setting} agora é ${CONFIG[setting]}`);
        salvarConfig(); 
    }
    res.json(CONFIG);
});
app.get('/api/logs', (req, res) => res.json(recentLogs));
app.get('/api/token', (req, res) => { res.json({ token: cachedTokenContent }); });
app.post('/api/token', (req, res) => {
    const { token } = req.body;
    fs.writeFileSync('token.txt', token);
    cachedTokenContent = token.trim(); 
    addLog('success', '🔑 Token de Autenticação atualizado via Painel Web!');
    res.json({ success: true });
});
app.get('/api/qr', (req, res) => { res.json({ qr: currentQRDataURL, connected: isConnected }); });

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    console.log(`\n=================================================`);
    console.log(`🌐 O SEU PAINEL DE CONTROLE WEB ESTÁ PRONTO!`);
    console.log(`➡️  Acesse pelo link do Render!`);
    console.log(`=================================================\n`);
    addLog('info', 'Servidor Painel Web iniciado.');
});

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_meubot');
    const { version } = await fetchLatestBaileysVersion();
    const sock = makeWASocket({ version, auth: state, printQRInTerminal: false });
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log('\n📱 ESCANEIE O QR CODE ABAIXO NO SEU WHATSAPP:\n');
            qrcode.generate(qr, { small: true });
            try { currentQRDataURL = await QRCode.toDataURL(qr); } catch(e) {}
        }
        if (connection === 'close') {
            isConnected = false;
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            addLog('warn', 'Conexão do WhatsApp caiu. Tentando reconectar...');
            if (!shouldReconnect) {
                fs.rmSync('auth_meubot', { recursive: true, force: true });
                addLog('warn', 'Sessão encerrada. Gere um novo QR Code recarregando o painel.');
            }
            startBot();
        } else if (connection === 'open') {
            isConnected = true;
            currentQRDataURL = ""; 
            addLog('success', 'Bot conectado ao WhatsApp com sucesso!');
        }
    });
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('messages.upsert', async ({ messages }) => {
        if (CONFIG.isPaused) return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const isGroup = msg.key.remoteJid.endsWith('@g.us');
        if (!isGroup && !CONFIG.monitorPrivate) return; 
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
        if (!text) return;
        addLog('info', `📩 RECEBIDO de ${msg.key.remoteJid.split('@')[0]}: "${text}"`);
        const textoMin = text.toLowerCase();
        if (proibidas.some(p => textoMin.includes(p))) { addLog('info', `⛔ Ignorado (Palavra proibida)`); return; }
        if (CONFIG.requireTrigger) {
            const temGatilho = frasesEfeito.some(f => textoMin.includes(f));
            if (!temGatilho) { addLog('info', `⛔ Ignorado (Sem gatilho)`); return; }
        }
        const valorReal = extrairValor(text);
        if (!valorReal) { addLog('warn', `⚠️ Sem valor financeiro.`); return; }
        if (valorReal > CONFIG.maxLimit) { addLog('warn', `⚠️ Valor maior que limite (R$ ${CONFIG.maxLimit}).`); return; }
        const tempoInicio = Date.now();
        addLog('warn', `💰 PEDIDO DETECTADO: R$ ${valorReal},00`);
        try {
            let customHeaders = {};
            let payTypeSubId = 4661;
            try {
                if (cachedTokenContent.startsWith('{')) {
                    const parsedData = JSON.parse(cachedTokenContent);
                    if (parsedData.headers && parsedData.payTypeSubId) {
                        customHeaders = parsedData.headers;
                        payTypeSubId = parsedData.payTypeSubId;
                    } else { customHeaders = parsedData; }
                } else {
                    customHeaders = { "authorization": `Bearer ${cachedTokenContent}`, "x-token": cachedTokenContent };
                }
            } catch(e) { addLog('error', 'Formato do token inválido!'); }
            const payloadHeaders = {
                "content-type": "application/json",
                ...customHeaders,
                "origin": "https://5kejp.com",
                "referer": "https://5kejp.com/",
                "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                "accept": "application/json, text/plain, */*"
            };
            const resposta = await apiClient.post("https://api2.ycyd123.com/api/frontend/trpc/pay.create", {
                "json": { "amount": valorReal * 100, "processMode": "THREE_PARTY_PAYMENT", "payTypeSubId": payTypeSubId, "participateReward": false, "lobbyUrl": "https://5kejp.com/launch" }
            }, { headers: payloadHeaders });
            const data = resposta.data;
            if (data?.result?.data?.json?.payUrl) {
                const pixCode = data.result.data.json.payUrl;
                const pediuFotoQR = frasesQR.some(f => textoMin.includes(f));
                if (pediuFotoQR) {
                    addLog('info', `📸 Gerando imagem...`);
                    const imagemQR = await gerarQRCodeImagem(pixCode);
                    if (imagemQR) {
                        await sock.sendMessage(msg.key.remoteJid, { image: imagemQR, caption: pixCode }, { quoted: msg });
                        addLog('success', `📸 QR Code Imagem enviado!`);
                    } else {
                        await sock.sendMessage(msg.key.remoteJid, { text: pixCode }, { quoted: msg });
                        addLog('warn', `⚠️ Enviado em texto.`);
                    }
                } else {
                    await sock.sendMessage(msg.key.remoteJid, { text: pixCode }, { quoted: msg });
                    addLog('success', `✅ PIX Gerado!`);
                }
            } else { addLog('error', `Falha ao gerar na plataforma.`); }
        } catch (erro) { addLog('error', `Falha de comunicação.`); }
    });
}
startBot();
