const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const app = express();
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

function buatUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

bot.start((ctx) => {
    ctx.reply('Selamat datang di MasD VPNStore!\nSilakan pilih layanan Premium (30 Hari - Rp 10.000):', 
        Markup.inlineKeyboard([
            [Markup.button.callback('🇸🇬 Vmess SGDO', 'ORDER_VMESS_SGDO'), Markup.button.callback('🇮🇩 Vmess IDTECH', 'ORDER_VMESS_IDTECH')],
            [Markup.button.callback('🇸🇬 Vless SGDO', 'ORDER_VLESS_SGDO'), Markup.button.callback('🇮🇩 Vless IDTECH', 'ORDER_VLESS_IDTECH')],
            [Markup.button.callback('🇸🇬 Trojan SGDO', 'ORDER_TROJAN_SGDO'), Markup.button.callback('🇮🇩 Trojan IDTECH', 'ORDER_TROJAN_IDTECH')],
            [Markup.button.callback('🇸🇬 SSH SGDO', 'ORDER_SSH_SGDO'), Markup.button.callback('🇮🇩 SSH IDTECH', 'ORDER_SSH_IDTECH')]
        ])
    );
});

bot.action(/ORDER_([A-Z]+)_([A-Z]+)/, async (ctx) => {
    const protokol = ctx.match[1];
    const serverDipilih = ctx.match[2];
    const chatId = ctx.chat.id;
    
    const durasi = 30; 
    const harga = 10000;
    const usernameVpn = `masd${Math.floor(Math.random() * 1000)}`; 
    
    // FORMAT ORDER_ID: PROTOKOL-SERVER-DURASI-USERNAME-CHATID-TIMESTAMP
    // ChatID diletakkan di posisi indeks ke-4 (menggantikan posisi 'password' di web) agar webhook bot bisa membalas chat
    const orderId = `${protokol}-${serverDipilih}-${durasi}-${usernameVpn}-${chatId}-${Date.now()}`;
    const namaLayanan = `${protokol}-${serverDipilih}`;

    ctx.reply(`Mengecek sistem untuk ${namaLayanan}...\nMohon tunggu sebentar.`);

    try {
        await supabase.from('transaksi').insert([
            { order_id: orderId, chat_id: chatId, layanan: namaLayanan, durasi: durasi, username_vpn: usernameVpn, status: 'pending' }
        ]);

        // TRIK JENIUS: Nembak ke API Web Auto-Order milikmu sendiri!
        const reqQris = await fetch('https://buy.masdpremium.biz.id/api/buat_qris', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order_id: orderId, amount: harga })
        });
        
        const resQris = await reqQris.json();

        if (resQris.status === 'sukses' && resQris.qris_string) {
            // Ubah string QRIS jadi gambar pakai API gratis
            const linkGambarQr = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(resQris.qris_string)}`;

            ctx.replyWithPhoto({ url: linkGambarQr }, {
                caption: `Total Pembayaran: Rp ${parseInt(resQris.total_bayar || harga).toLocaleString('id-ID')}\nOrder ID: ${orderId}\n\nSilakan scan QRIS di atas.\nSistem otomatis mengirim akun VPN Anda ke chat ini setelah pembayaran lunas.`
            });
        } else {
            ctx.reply(`⚠️ Gagal memuat QRIS dari web: ${resQris.alasan || JSON.stringify(resQris)}`);
        }
    } catch (err) {
        ctx.reply(`⚠️ Terjadi Error API: ${err.message}`);
    }
});

// Endpoint untuk dipanggil Telegram
app.use(bot.webhookCallback('/api/telegram'));

// Endpoint Webhook untuk menerima lunas dari Pakasir
app.post('/api/pakasir', async (req, res) => {
    const dataPakasir = req.body;
    
    if (dataPakasir.status === 'completed' || dataPakasir.status === 'success') {
        const orderId = dataPakasir.order_id;
        const potong = orderId.split('-'); 
        const protokol = potong[0]; 
        const serverDipilih = potong[1];
        const durasi = parseInt(potong[2]);
        const username = potong[3];
        const chatId = potong[4]; // Diambil dari posisi ke-4 di order_id
        
        const { data: trxData } = await supabase.from('transaksi').select('*').eq('order_id', orderId).single();

        if (trxData && trxData.status === 'pending') {
            try {
                bot.telegram.sendMessage(chatId, "✅ Pembayaran LUNAS! Sedang mengeksekusi VPS...");

                let vpsUrl = '';
                let fetchOptions = {};
                let passwordSsh = chatId; // Pakai Chat ID sebagai password akun SSH biar aman & unik

                // LOGIKA ADOPSI DARI webhook.js MASD
                if (serverDipilih === 'SGDO') {
                    let endpoint = protokol.toLowerCase() + 'all'; 
                    if (protokol === 'SSH') endpoint = 'sshvpn';

                    vpsUrl = `http://167.172.73.230/vps/${endpoint}`;
                    let bodyData = { expired: durasi, limitip: 2, username: username };
                    
                    if (protokol !== 'SSH') { 
                        bodyData.kuota = 300; 
                        bodyData.uuidv2 = buatUUID(); 
                    } else { 
                        bodyData.password = passwordSsh.toString(); 
                    }

                    fetchOptions = {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.POTATO_API_KEY}` },
                        body: JSON.stringify(bodyData)
                    };
                } 
                else if (serverDipilih === 'IDTECH') {
                    let endpoint = 'add' + protokol.toLowerCase();
                    vpsUrl = `https://www.agung-store.my.id/api/${endpoint}`;
                    
                    let bodyData = { server: "MASDVPN", username: username, ipLimit: 2, days: durasi };
                    if (protokol !== 'SSH') bodyData.quota = 300;
                    else bodyData.password = passwordSsh.toString();

                    fetchOptions = {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.AGUNG_API_KEY },
                        body: JSON.stringify(bodyData)
                    };
                }

                if (vpsUrl) {
                    const resVPS = await fetch(vpsUrl, fetchOptions);
                    const teksHasil = await resVPS.text();
                    const hasilVPS = JSON.parse(teksHasil);
                    
                    if (resVPS.ok) {
                        const akun = hasilVPS.data || hasilVPS.akun || hasilVPS;
                        await supabase.from('transaksi').update({ status: 'sukses' }).eq('order_id', orderId);

                        let pesanSukses = `🎉 **AKUN ${protokol} BERHASIL DIBUAT** 🎉\n\n` +
                                          `Username: ${akun.username || akun.user || username}\n`;
                        if (protokol === 'SSH') pesanSukses += `Password: ${akun.password || akun.pass || passwordSsh}\n`;
                        pesanSukses += `Host: ${akun.hostname || akun.domain || akun.host || "id.masdvpnstore.web.id"}\n` +
                                       `Expired: ${durasi} Hari\n\n`;

                        if (protokol === 'VMESS') pesanSukses += `Link TLS: \`${akun.vmess || akun.vmess_tls || akun.linkTls || "Cek Panel"}\`\n\n`;
                        else if (protokol === 'VLESS') pesanSukses += `Link TLS: \`${akun.vless || akun.vless_tls || akun.linkTls || "Cek Panel"}\`\n\n`;
                        else if (protokol === 'TROJAN') pesanSukses += `Link TLS: \`${akun.trojan || akun.trojan_tls || akun.linkTls || "Cek Panel"}\`\n\n`;
                        
                        pesanSukses += `Terima kasih telah berbelanja di MasD VPNStore!`;
                        bot.telegram.sendMessage(chatId, pesanSukses, { parse_mode: 'Markdown' });
                    } else {
                        bot.telegram.sendMessage(chatId, `⚠️ VPS Menolak: ${JSON.stringify(hasilVPS)}`);
                    }
                }
            } catch (err) {
                bot.telegram.sendMessage(chatId, `⚠️ Gagal Eksekusi VPS: ${err.message}`);
            }
        }
    }
    res.status(200).send('OK');
});

module.exports = app;
