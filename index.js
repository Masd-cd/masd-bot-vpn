const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

// Inisialisasi Environment & Library
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const app = express();
app.use(express.json());

// Inisialisasi Database Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Fungsi pembantu UUID untuk VPS Potato
function buatUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// ==========================================
// 1. MENU UTAMA BOT
// ==========================================
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

// Menangkap semua tombol klik dengan pola ORDER_PROTOKOL_SERVER
bot.action(/ORDER_([A-Z]+)_([A-Z]+)/, async (ctx) => {
    const protokol = ctx.match[1]; // contoh: VMESS
    const serverDipilih = ctx.match[2]; // contoh: SGDO
    const chatId = ctx.chat.id;
    
    // Setting Default (Bisa dikembangkan nanti agar user bisa input sendiri)
    const durasi = 30; 
    const harga = 10000;
    const usernameVpn = `masd${Math.floor(Math.random() * 1000)}`; 
    
    // Format Order ID: PROTOKOL-SERVER-DURASI-USER-CHATID-TIMESTAMP
    const orderId = `${protokol}-${serverDipilih}-${durasi}-${usernameVpn}-${chatId}-${Date.now()}`;
    const namaLayanan = `${protokol}-${serverDipilih}`;

    ctx.reply(`Mengecek sistem untuk ${namaLayanan}...\nMohon tunggu sebentar.`);

    try {
        // 1. Simpan ke Supabase status 'pending'
        await supabase.from('transaksi').insert([
            { order_id: orderId, chat_id: chatId, layanan: namaLayanan, durasi: durasi, username_vpn: usernameVpn, status: 'pending' }
        ]);

        // 2. Minta QRIS ke Pakasir (Pastikan URL ini sesuai dokumentasi Pakasir kamu)
        const reqQris = await fetch('https://api.pakasir.com/v1/qris/create', { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                api_key: process.env.PAKASIR_API,
                order_id: orderId, 
                amount: harga 
            })
        });
        const resQris = await reqQris.json();

        // 3. Kirim QRIS ke Telegram pembeli
        // Catatan: Sesuaikan 'resQris.qris_url' dengan respon asli JSON dari Pakasir
        ctx.replyWithPhoto({ url: resQris.qris_url || resQris.data.qr_image }, {
            caption: `Total Pembayaran: Rp ${harga}\nOrder ID: ${orderId}\n\nSilakan scan QRIS di atas.\nSistem akan otomatis mengirim akun VPN Anda ke chat ini setelah pembayaran berhasil.`
        });
    } catch (err) {
        console.error(err);
        ctx.reply('Gagal memuat QRIS. Server sedang sibuk, silakan coba lagi nanti.');
    }
});

// ==========================================
// 2. WEBHOOK PAKASIR (MENERIMA INFO PEMBAYARAN)
// ==========================================
app.post('/webhook/pakasir', async (req, res) => {
    const dataPakasir = req.body;
    
    if (dataPakasir.status === 'completed' || dataPakasir.status === 'success') {
        const orderId = dataPakasir.order_id;
        
        // Cari data transaksi di database Supabase
        const { data: trxData, error } = await supabase
            .from('transaksi')
            .select('*')
            .eq('order_id', orderId)
            .single();

        if (trxData && trxData.status === 'pending') {
            const chatId = trxData.chat_id;
            const username = trxData.username_vpn;
            const durasi = trxData.durasi;
            
            // Pecah layanan, misal "VMESS-SGDO"
            const potongLayanan = trxData.layanan.split('-');
            const protokol = potongLayanan[0];
            const serverDipilih = potongLayanan[1];

            try {
                bot.telegram.sendMessage(chatId, "✅ Pembayaran LUNAS! Sedang mengeksekusi pembuatan akun di VPS...");

                let vpsUrl = '';
                let fetchOptions = {};
                let passwordSsh = "1"; // Default untuk SSH

                // LOGIKA API POTATO (SGDO)
                if (serverDipilih === 'SGDO') {
                    let endpoint = protokol.toLowerCase() + 'all'; // vmessall, vlessall, trojanall
                    if (protokol === 'SSH') endpoint = 'sshvpn';

                    vpsUrl = `http://167.172.73.230/vps/${endpoint}`;
                    
                    let bodyData = { expired: durasi, limitip: 2, username: username };
                    if (protokol !== 'SSH') {
                        bodyData.kuota = 300;
                        bodyData.uuidv2 = buatUUID();
                    } else {
                        bodyData.password = passwordSsh;
                    }

                    fetchOptions = {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.POTATO_API_KEY}` },
                        body: JSON.stringify(bodyData)
                    };
                } 
                // LOGIKA API AGUNG (IDTECH)
                else if (serverDipilih === 'IDTECH') {
                    let endpoint = 'add' + protokol.toLowerCase(); // addvmess, addvless, addtrojan, addssh
                    vpsUrl = `https://www.agung-store.my.id/api/${endpoint}`;
                    
                    let bodyData = { server: "MASDVPN", username: username, ipLimit: 2, days: durasi };
                    if (protokol !== 'SSH') {
                        bodyData.quota = 300;
                    } else {
                        bodyData.password = passwordSsh;
                    }

                    fetchOptions = {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.AGUNG_API_KEY },
                        body: JSON.stringify(bodyData)
                    };
                }

                if (vpsUrl) {
                    const resVPS = await fetch(vpsUrl, fetchOptions);
                    const hasilVPS = await resVPS.json();
                    
                    if (resVPS.ok) {
                        const akun = hasilVPS.data || hasilVPS.akun || hasilVPS;
                        
                        // Update status di Supabase jadi 'sukses'
                        await supabase.from('transaksi').update({ status: 'sukses' }).eq('order_id', orderId);

                        // Susun pesan balasan berdasarkan protokol
                        let pesanSukses = `🎉 **AKUN ${protokol} BERHASIL DIBUAT** 🎉\n\n` +
                                          `Username: ${akun.username || akun.user || username}\n`;
                        
                        if (protokol === 'SSH') {
                            pesanSukses += `Password: ${akun.password || akun.pass || passwordSsh}\n`;
                        }
                        
                        pesanSukses += `Host: ${akun.hostname || akun.domain || akun.host || "id.masdvpnstore.web.id"}\n` +
                                       `Expired: ${durasi} Hari\n\n`;

                        // Tambahkan Link
                        if (protokol === 'VMESS') pesanSukses += `Link TLS: \`${akun.vmess || akun.vmess_tls || akun.linkTls || "Cek Panel"}\`\n\n`;
                        else if (protokol === 'VLESS') pesanSukses += `Link TLS: \`${akun.vless || akun.vless_tls || akun.linkTls || "Cek Panel"}\`\n\n`;
                        else if (protokol === 'TROJAN') pesanSukses += `Link TLS: \`${akun.trojan || akun.trojan_tls || akun.linkTls || "Cek Panel"}\`\n\n`;
                        
                        pesanSukses += `Terima kasih telah berbelanja di MasD VPNStore!`;

                        // Kirim ke Telegram pembeli
                        bot.telegram.sendMessage(chatId, pesanSukses, { parse_mode: 'Markdown' });
                    } else {
                        bot.telegram.sendMessage(chatId, "⚠️ Server VPN menolak permintaan. Saldo Anda aman, hubungi Admin.");
                    }
                }
            } catch (err) {
                console.error(err);
                bot.telegram.sendMessage(chatId, "⚠️ Terjadi kesalahan koneksi ke server VPN. Hubungi Admin.");
            }
        }
    }
    
    // Wajib balas 200 OK ke Pakasir
    res.status(200).send('OK');
});

// ==========================================
// JALANKAN SERVER UNTUK RENDER
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server VPN Bot jalan di port ${PORT}`);
    bot.launch(); 
});

// Penanganan agar bot mati dengan aman jika server restart
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
