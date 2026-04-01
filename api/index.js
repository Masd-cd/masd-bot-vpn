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

// ==========================================
// 1. MENU UTAMA
// ==========================================
function menuUtama() {
    return Markup.inlineKeyboard([
        [Markup.button.callback('🛒 Beli VPN', 'MENU_ORDER'), Markup.button.callback('👤 Akun Saya', 'MENU_PROFIL')]
    ]);
}

bot.start(async (ctx) => {
    // Hapus draft kalau user reset bot
    await supabase.from('transaksi').delete().eq('order_id', `DRAFT-${ctx.chat.id}`);
    
    ctx.reply('⚡ Selamat datang di MasD VPNStore Premium.\n\n👇 Silakan pilih menu di bawah ini:', menuUtama());
});

bot.action('KEMBALI_AWAL', async (ctx) => {
    await supabase.from('transaksi').delete().eq('order_id', `DRAFT-${ctx.chat.id}`);
    ctx.editMessageText('⚡ Selamat datang di MasD VPNStore Premium.\n\n👇 Silakan pilih menu di bawah ini:', menuUtama());
});

// ==========================================
// 2. ALUR ORDER STEP-BY-STEP
// ==========================================
bot.action('MENU_ORDER', (ctx) => {
    ctx.editMessageText('Pilih Protokol:', Markup.inlineKeyboard([
        [Markup.button.callback('SSH', 'PROTO_SSH'), Markup.button.callback('VLESS', 'PROTO_VLESS')],
        [Markup.button.callback('VMess', 'PROTO_VMESS'), Markup.button.callback('Trojan', 'PROTO_TROJAN')],
        [Markup.button.callback('🔙 Kembali', 'KEMBALI_AWAL')]
    ]));
});

bot.action(/PROTO_([A-Z]+)/, (ctx) => {
    const proto = ctx.match[1];
    ctx.editMessageText(`Protokol: <b>${proto}</b>\n\nPilih Server:`, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('🇸🇬 Singapore DO', `SRV_${proto}_SGDO`)],
            [Markup.button.callback('🇮🇩 Indonesia Techno', `SRV_${proto}_IDTECH`)],
            [Markup.button.callback('🔙 Kembali', 'MENU_ORDER')]
        ])
    });
});

bot.action(/SRV_([A-Z]+)_([A-Z]+)/, (ctx) => {
    const proto = ctx.match[1];
    const srv = ctx.match[2];
    ctx.editMessageText(`Protokol: <b>${proto}</b>\nServer: <b>${srv}</b>\n\nPilih Durasi:`, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('📅 15 Hari (Rp 5.000)', `PKG_${proto}_${srv}_15_5000`)],
            [Markup.button.callback('🚀 30 Hari (Rp 10.000)', `PKG_${proto}_${srv}_30_10000`)],
            [Markup.button.callback('🔙 Kembali', `PROTO_${proto}`)]
        ])
    });
});

// ==========================================
// 3. TAHAP MINTA USERNAME (SIMPAN DRAFT KE SUPABASE)
// ==========================================
bot.action(/PKG_([A-Z]+)_([A-Z]+)_(\d+)_(\d+)/, async (ctx) => {
    const proto = ctx.match[1];
    const srv = ctx.match[2];
    const durasi = ctx.match[3];
    const harga = ctx.match[4];
    const chatId = ctx.chat.id;

    await ctx.deleteMessage(); // Bersihkan tombol

    try {
        // Hapus draft lama jika ada biar bersih
        await supabase.from('transaksi').delete().eq('order_id', `DRAFT-${chatId}`);

        // Titipkan ingatan bot ke Supabase (Harga dititip di kolom username_vpn sementara)
        await supabase.from('transaksi').insert([{
            order_id: `DRAFT-${chatId}`,
            chat_id: chatId,
            layanan: `${proto}-${srv}`,
            durasi: parseInt(durasi),
            username_vpn: harga, 
            status: 'draft'
        }]);

        await ctx.reply(`Anda memilih <b>${proto} ${srv} (${durasi} Hari)</b>.\n\n✍️ <b>Silakan ketik Username VPN yang Anda inginkan:</b>\n<i>(Ketik langsung balas di chat ini, tanpa spasi atau simbol)</i>`, { parse_mode: 'HTML' });
    } catch (err) {
        ctx.reply("⚠️ Gagal memproses data. Coba lagi nanti.");
    }
});

// ==========================================
// 4. TANGKAP KETIKAN USERNAME & GENERATE QRIS
// ==========================================
bot.on('text', async (ctx) => {
    const chatId = ctx.chat.id;
    const text = ctx.message.text.trim();

    try {
        // Cek ingatan bot (Draft) di Supabase
        const { data: draft } = await supabase.from('transaksi').select('*').eq('order_id', `DRAFT-${chatId}`).single();

        // Jika bot sedang menunggu username
        if (draft && draft.status === 'draft') {
            
            // Validasi spasi/simbol
            if (text.includes(' ') || !/^[a-zA-Z0-9]+$/.test(text)) {
                return ctx.reply('⚠️ Username hanya boleh berisi huruf dan angka tanpa spasi. Silakan ketik ulang:');
            }

            const protoSrv = draft.layanan.split('-');
            const proto = protoSrv[0];
            const srv = protoSrv[1];
            const durasi = draft.durasi;
            const harga = parseInt(draft.username_vpn); // Ambil harga yang dititipkan
            const usernameVpn = text.toLowerCase();
            
            const orderId = `${proto}-${srv}-${durasi}-${usernameVpn}-${chatId}-${Date.now()}`;
            
            const msgLoading = await ctx.reply(`<i>⏳ Sedang memproses invoice untuk username <b>${usernameVpn}</b>...</i>`, { parse_mode: 'HTML' });

            // Hapus draft, dan masukkan order asli dengan status pending
            await supabase.from('transaksi').delete().eq('order_id', `DRAFT-${chatId}`);
            await supabase.from('transaksi').insert([{
                order_id: orderId, chat_id: chatId, layanan: draft.layanan, durasi: durasi, username_vpn: usernameVpn, status: 'pending'
            }]);

            // Tembak API Web untuk ambil QRIS
            const reqQris = await fetch('https://buy.masdpremium.biz.id/api/buat_qris', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ order_id: orderId, amount: harga })
            });
            const resQris = await reqQris.json();

            if (resQris.status === 'sukses' && resQris.qris_string) {
                const linkGambarQr = `https://api.qrserver.com/v1/create-qr-code/?size=350x350&data=${encodeURIComponent(resQris.qris_string)}&margin=10`;
                
                const invoiceText = `🧾 <b>INVOICE PEMBAYARAN</b> 🧾\n\n` +
                                    `<b>Order ID:</b> <code>${orderId}</code>\n` +
                                    `<b>Layanan:</b> ${proto} Premium\n` +
                                    `<b>Server:</b> ${srv}\n` +
                                    `<b>Durasi:</b> ${durasi} Hari\n` +
                                    `<b>Username:</b> <code>${usernameVpn}</code>\n` +
                                    `<b>Tagihan:</b> <b>Rp ${harga.toLocaleString('id-ID')}</b>\n\n` +
                                    `<i>⚠️ Silakan scan QR Code di atas. Sistem otomatis mengirim akun VPN Anda ke chat ini setelah pembayaran lunas.</i>`;

                await ctx.deleteMessage(msgLoading.message_id); 
                await ctx.replyWithPhoto({ url: linkGambarQr }, {
                    caption: invoiceText,
                    parse_mode: 'HTML',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('🔄 Cek Pembayaran', `CEK_${orderId}`), Markup.button.callback('❌ Batal', `BATAL_${orderId}`)]
                    ])
                });
            } else {
                await ctx.deleteMessage(msgLoading.message_id); 
                ctx.reply(`⚠️ Gagal memuat QRIS: ${resQris.alasan}`, Markup.inlineKeyboard([[Markup.button.callback('🔙 Menu Utama', 'KEMBALI_AWAL')]]));
            }
        }
    } catch(err) {
        console.log(err);
    }
});

// ==========================================
// 5. TOMBOL CEK & BATAL
// ==========================================
bot.action(/CEK_(.*)/, async (ctx) => {
    const orderId = ctx.match[1];
    const { data } = await supabase.from('transaksi').select('status').eq('order_id', orderId).single();
    
    if(data && data.status === 'sukses') {
        ctx.answerCbQuery('✅ Pembayaran LUNAS! Akun sedang dibuat...', { show_alert: true });
    } else {
        ctx.answerCbQuery('⏳ Pembayaran belum terdeteksi. Silakan coba beberapa saat lagi.', { show_alert: true });
    }
});

bot.action(/BATAL_(.*)/, async (ctx) => {
    const orderId = ctx.match[1];
    await supabase.from('transaksi').update({ status: 'batal' }).eq('order_id', orderId);
    ctx.deleteMessage();
    ctx.reply('❌ Pesanan berhasil dibatalkan.', Markup.inlineKeyboard([[Markup.button.callback('🔙 Kembali ke Menu Utama', 'KEMBALI_AWAL')]]));
});

bot.action('MENU_PROFIL', (ctx) => { ctx.answerCbQuery('Fitur Akun Saya sedang dalam pengembangan 🛠️', { show_alert: true }); });

// ==========================================
// 6. WEBHOOK & EKSEKUSI VPS (LOGIC ASLI MASD)
// ==========================================
app.use(bot.webhookCallback('/api/telegram'));

app.post('/api/pakasir', async (req, res) => {
    const dataPakasir = req.body;
    
    if (dataPakasir.status === 'completed' || dataPakasir.status === 'success') {
        const orderId = dataPakasir.order_id;
        const potong = orderId.split('-'); 
        const protokol = potong[0]; 
        const serverDipilih = potong[1];
        const durasi = parseInt(potong[2]);
        const username = potong[3];
        const chatId = potong[4]; 
        
        const { data: trxData } = await supabase.from('transaksi').select('*').eq('order_id', orderId).single();

        if (trxData && trxData.status === 'pending') {
            try {
                bot.telegram.sendMessage(chatId, "✅ <b>Pembayaran LUNAS!</b> Sedang mengeksekusi server...", {parse_mode: 'HTML'});

                let vpsUrl = '';
                let fetchOptions = {};
                let passwordSsh = chatId; // Pakai Chat ID sebagai password akun SSH

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

                        // FORMAT HASIL AKUN YANG ELEGAN
                        let pesanSukses = `🎉 <b>AKUN ${protokol} BERHASIL DIBUAT!</b> 🎉\n\n` +
                                          `<b>Username:</b> <code>${akun.username || akun.user || username}</code>\n`;
                        if (protokol === 'SSH') pesanSukses += `<b>Password:</b> <code>${akun.password || akun.pass || passwordSsh}</code>\n`;
                        pesanSukses += `<b>Host/IP:</b> <code>${akun.hostname || akun.domain || akun.host || "id.masdvpnstore.web.id"}</code>\n` +
                                       `<b>Expired:</b> ${durasi} Hari\n\n`;
                                       
                        if (protokol === 'VMESS') pesanSukses += `<b>Link TLS:</b>\n<code>${akun.vmess || akun.vmess_tls || akun.linkTls || "Cek Panel"}</code>\n\n`;
                        else if (protokol === 'VLESS') pesanSukses += `<b>Link TLS:</b>\n<code>${akun.vless || akun.vless_tls || akun.linkTls || "Cek Panel"}</code>\n\n`;
                        else if (protokol === 'TROJAN') pesanSukses += `<b>Link TLS:</b>\n<code>${akun.trojan || akun.trojan_tls || akun.linkTls || "Cek Panel"}</code>\n\n`;
                        
                        pesanSukses += `<i>Terima kasih telah berbelanja di MasD VPNStore!</i>`;
                        
                        bot.telegram.sendMessage(chatId, pesanSukses, { parse_mode: 'HTML' });
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

// ROUTE BANTUAN UNTUK SETTING WEBHOOK VERCEL
app.get('/api/setup', async (req, res) => {
    try {
        const domain = `https://${req.headers.host}`;
        await bot.telegram.setWebhook(`${domain}/api/telegram`);
        res.send(`Webhook berhasil disetting ke: ${domain}/api/telegram`);
    } catch (e) {
        res.send(`Gagal set webhook: ${e.message}`);
    }
});

module.exports = app;
    
