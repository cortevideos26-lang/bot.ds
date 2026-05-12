// ... (mantenha todo o resto igual, mudei apenas o bloco de erro no final do meubot.js)

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
                    }
                } else {
                    await sock.sendMessage(msg.key.remoteJid, { text: pixCode }, { quoted: msg });
                    addLog('success', `✅ PIX Gerado!`);
                }
            } else { 
                addLog('error', `Plataforma recusou: ${JSON.stringify(data)}`); 
            }
        } catch (erro) { 
            // AQUI ESTÁ A MUDANÇA: Log detalhado do erro
            const status = erro.response ? erro.response.status : 'Sem Status';
            const msgErro = erro.response ? JSON.stringify(erro.response.data) : erro.message;
            addLog('error', `Falha API (${status}): ${msgErro}`); 
        }
// ...
