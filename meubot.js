const { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const fs = require('fs');
const axios = require('axios');
const https = require('https');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode'); // Para gerar imagem de QR code
const readline = require('readline');
const express = require('express');

let currentQRDataURL = ""; // Guarda o QR Code para o painel web
let isConnected = false; // Status da conexão com o WhatsApp

// Otimização: Mantém a conexão aberta com o servidor da casa de aposta para evitar tempo de "aperto de mão" SSL em cada requisição.
const apiClient = axios.create({
    httpsAgent: new https.Agent({ keepAlive: true })
});

// ==========================================
// CONFIGURAÇÕES DO BOT E DA CASA DE APOSTAS
// ==========================================
let CONFIG = {
    isPaused: false,
    monitorPrivate: true, // Habilitado por padrão para funcionar no PV
    requireTrigger: true,
    maxLimit: 1000 // Limite padrão de valor
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

// Histórico de Logs para o Painel Web
let recentLogs = [];
function addLog(type, message) {
    const time = new Date().toLocaleTimeString();
    recentLogs.unshift({ time, type, message }); // Adiciona no início
    if (recentLogs.length > 100) recentLogs.pop(); // Mantém os últimos 100
    
    // Imprime no terminal também
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
    
    // Tenta carregar o arquivo de frases QR
    if (fs.existsSync('frases-qr.txt')) {
        frasesQR = fs.readFileSync('frases-qr.txt', 'utf8').split('\n').map(l => l.trim().toLowerCase()).filter(Boolean);
    } else {
        frasesQR = ['foto qr', 'imagem qr', 'qr code']; // Padrão se o arquivo for apagado
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
    
    // Remove os pontos que servem como separador de milhar (ex: 1.000 -> 1000)
    while (/\.\d{3}/.test(nums)) {
        nums = nums.replace(/\.(\d{3})/, '$1');
    }
    
    let val = parseFloat(nums.replace(',', '.'));
    if (val < 1) return null;
    return Math.floor(val);
}

// Função para gerar imagem do QR code
async function gerarQRCodeImagem(pixCode) {
    try {
        // Gera a imagem do QR code como buffer PNG (Otimizado para velocidade)
        const buffer = await QRCode.toBuffer(pixCode, {
            errorCorrectionLevel: 'M', // 'M' é mais rápido de gerar que 'H' e suficiente para tela
            type: 'image/png',
            quality: 0.8,
            margin: 1,
            width: 350, // Menor tamanho = Geração mais rápida e envio mais rápido pelo WhatsApp
        });
        return buffer;
    } catch (erro) {
        addLog('error', `Erro ao gerar imagem QR Code: ${erro.message}`);
        return null;
    }
}

// OTIMIZAÇÃO: Cache do token em memória para não ler do HD a cada mensagem
let cachedTokenContent = "";
try {
    cachedTokenContent = fs.readFileSync('token.txt', 'utf8').trim();
} catch(e) {}

// ==========================================
// PAINEL WEB (EXPRESS SERVER)
// ==========================================
const app = express();
app.use(express.json());
app.use(express.static('public')); // Serve a pasta public (HTML, CSS, JS)

app.get('/api/status', (req, res) => res.json(CONFIG));
app.post('/api/toggle', (req, res) => {
    const { setting, value } = req.body;
    if (CONFIG[setting] !== undefined) {
        if (value !== undefined) {
            CONFIG[setting] = value;
        } else {
            CONFIG[setting] = !CONFIG[setting];
        }
        addLog('warn', `Configuração alterada: ${setting} agora é ${CONFIG[setting]}`);
        salvarConfig(); // Salva a alteração para não resetar ao reiniciar o bot
    }
    res.json(CONFIG);
});
app.get('/api/logs', (req, res) => res.json(recentLogs));

app.get('/api/token', (req, res) => {
    res.json({ token: cachedTokenContent });
});

app.post('/api/token', (req, res) => {
    const { token } = req.body;
    fs.writeFileSync('token.txt', token);
    cachedTokenContent = token.trim(); // Atualiza a memória
    addLog('success', '🔑 Token de Autenticação atualizado via Painel Web!');
    res.json({ success: true });
});

// Novo Endpoint para fornecer o QR Code do WhatsApp
app.get('/api/qr', (req, res) => {
    res.json({ 
        qr: currentQRDataURL,
        connected: isConnected
    });
});



const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    console.log(`\n=================================================`);
    console.log(`🌐 O SEU PAINEL DE CONTROLE WEB ESTÁ PRONTO!`);
    console.log(`➡️  Abra no seu navegador: http://localhost:${PORT}`);
    console.log(`=================================================\n`);
    addLog('info', 'Servidor Painel Web iniciado.');
});

// ==========================================
// LÓGICA PRINCIPAL DO WHATSAPP
// ==========================================
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_meubot');
    const { version } = await fetchLatestBaileysVersion();
    
    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false // Nós mesmos vamos imprimir
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('\n📱 ESCANEIE O QR CODE ABAIXO NO SEU WHATSAPP:\n');
            qrcode.generate(qr, { small: true });
            
            // Gera a imagem pro painel web
            try {
                currentQRDataURL = await QRCode.toDataURL(qr);
            } catch(e) {}
        }
        
        if (connection === 'close') {
            isConnected = false;
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            addLog('warn', 'Conexão do WhatsApp caiu. Tentando reconectar...');
            
            if (!shouldReconnect) {
                // Se foi deslogado (apertou sair no celular), apaga os arquivos de sessão
                fs.rmSync('auth_meubot', { recursive: true, force: true });
                addLog('warn', 'Sessão encerrada. Gere um novo QR Code recarregando o painel.');
            }
            startBot();
        } else if (connection === 'open') {
            isConnected = true;
            currentQRDataURL = ""; // Limpa da memória pois já conectou
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

        if (proibidas.some(p => textoMin.includes(p))) {
            addLog('info', `⛔ Ignorado (Palavra proibida detectada)`);
            return;
        }

        if (CONFIG.requireTrigger) {
            const temGatilho = frasesEfeito.some(f => textoMin.includes(f));
            if (!temGatilho) {
                addLog('info', `⛔ Ignorado (Sem palavra gatilho)`);
                return;
            }
        }

        const valorReal = extrairValor(text);
        if (!valorReal) {
            addLog('warn', `⚠️ Sem valor financeiro. Ignorando a mensagem...`);
            return;
        }

        if (valorReal > CONFIG.maxLimit) {
            addLog('warn', `⚠️ Valor solicitado (R$ ${valorReal},00) é maior que o limite permitido (R$ ${CONFIG.maxLimit},00). Ignorando sem responder...`);
            return;
        }

        const tempoInicio = Date.now(); // Cronômetro iniciado
        addLog('warn', `💰 PEDIDO DETECTADO: R$ ${valorReal},00 (Número: ${msg.key.remoteJid.split('@')[0]})`);
        
        try {
            let customHeaders = {};
            let payTypeSubId = 4661; // Valor padrão de fallback
            try {
                if (cachedTokenContent.startsWith('{')) {
                    const parsedData = JSON.parse(cachedTokenContent);
                    if (parsedData.headers && parsedData.payTypeSubId) {
                        // Novo formato que inclui headers e o ID de pagamento
                        customHeaders = parsedData.headers;
                        payTypeSubId = parsedData.payTypeSubId;
                    } else {
                        // Formato antigo que só tinha os headers
                        customHeaders = parsedData;
                    }
                } else {
                    // Método antigo fallback
                    customHeaders = {
                        "authorization": `Bearer ${cachedTokenContent}`,
                        "x-token": cachedTokenContent
                    };
                }
            } catch(e) {
                addLog('error', 'Formato do token inválido!');
            }
            
            const payloadHeaders = {
                "content-type": "application/json",
                ...customHeaders,
                "origin": "https://5kejp.com",
                "referer": "https://5kejp.com/",
                "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                "accept": "application/json, text/plain, */*"
            };
            
            const resposta = await apiClient.post("https://api2.ycyd123.com/api/frontend/trpc/pay.create", {
                "json": {
                    "amount": valorReal * 100,
                    "processMode": "THREE_PARTY_PAYMENT",
                    "payTypeSubId": payTypeSubId,
                    "participateReward": false,
                    "lobbyUrl": "https://5kejp.com/launch"
                }
            }, {
                headers: payloadHeaders
            });

            const data = resposta.data;
            
            if (data?.result?.data?.json?.payUrl) {
                const pixCode = data.result.data.json.payUrl;
                
                // Verifica se o usuário pediu a foto do QR Code baseado no arquivo frases-qr.txt
                const pediuFotoQR = frasesQR.some(f => textoMin.includes(f));
                
                if (pediuFotoQR) {
                    // Gera e envia como imagem
                    addLog('info', `📸 Gerando QR Code em formato de imagem...`);
                    const imagemQR = await gerarQRCodeImagem(pixCode);
                    
                    if (imagemQR) {
                        // Envia a imagem apenas com o código PIX na legenda
                        await sock.sendMessage(msg.key.remoteJid, { 
                            image: imagemQR,
                            caption: pixCode
                        }, { quoted: msg });
                        
                        const tempoFim = Date.now();
                        const tempoTotal = tempoFim - tempoInicio;
                        addLog('success', `📸 QR Code (IMAGEM) de R$ ${valorReal},00 gerado e enviado! ⏱️ Levou: ${tempoTotal}ms (${(tempoTotal/1000).toFixed(2)}s)`);
                    } else {
                        // Se falhar ao gerar imagem, envia apenas o código
                        await sock.sendMessage(msg.key.remoteJid, { text: pixCode }, { quoted: msg });
                        addLog('warn', `⚠️ Falha ao gerar imagem. Código PIX enviado em texto.`);
                        
                        const tempoFim = Date.now();
                        const tempoTotal = tempoFim - tempoInicio;
                        addLog('success', `✅ PIX de R$ ${valorReal},00 gerado e enviado em texto! ⏱️ Levou: ${tempoTotal}ms (${(tempoTotal/1000).toFixed(2)}s)`);
                    }
                } else {
                    // Envia apenas o código PIX em texto (comportamento padrão)
                    await sock.sendMessage(msg.key.remoteJid, { text: pixCode }, { quoted: msg });
                    
                    const tempoFim = Date.now();
                    const tempoTotal = tempoFim - tempoInicio;
                    addLog('success', `✅ PIX de R$ ${valorReal},00 gerado e enviado! ⏱️ Levou: ${tempoTotal}ms (${(tempoTotal/1000).toFixed(2)}s)`);
                }
            } else {
                addLog('error', `Falha ao gerar o PIX na plataforma.`);
            }
        } catch (erro) {
            let erroDetalhes = erro.message;
            if (erro.response && erro.response.data) {
                erroDetalhes += " | Resposta: " + JSON.stringify(erro.response.data);
            }
            addLog('error', `Falha de comunicação com a casa de apostas: ${erroDetalhes}`);
        }
    });
}

startBot();
