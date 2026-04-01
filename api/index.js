const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

// Inisialisasi Environment
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const app = express();
app.use(express.json());

// Inisialisasi Database Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

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

bot.action(/ORDER_([A-Z]+)_([A-Z]+)/, async (ctx) => {
    const protokol = ctx.match[1];
    const serverDipilih = ctx.match[2];
    const chatId = ctx.chat.id;
    const durasi = 30; 
    const harga = 10000;
    const usernameVpn = `masd${Math.floor(Math.random() * 1000)}`; 
    
    const orderId = `${protokol}-${serverDipilih}-${durasi}-${usernameVpn}-${chatId}-${Date.now()}`;
    const namaLayanan = `${protokol}-${serverDipilih}`;

    ctx.reply(`Mengecek sistem untuk ${namaLayanan}...\nMohon tunggu sebentar.`);

    try {
        await supabase.from('transaksi').insert([
            { order_id: orderId, chat_id: chatId, layanan: namaLayanan, durasi: durasi, username_vpn: usernameVpn, status: 'pending' }
        ]);

        const reqQris = await fetch('https://api.pakasir.com/v1/qris/create', { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key: process.env.PAKASIR_API, order_id: orderId, amount: harga })
        });
        const resQris = await reqQris.json();

        ctx.replyWithPhoto({ url: resQris.qris_url || resQris.data.qr_image }, {
            caption: `Total Pembayaran: Rp ${harga}\nOrder ID: ${orderId}\n\nSilakan scan QRIS di atas. Akun otomatis dikirim ke chat ini setelah pembayaran berhasil.`
        });
    } catch (err) {
        ctx.reply('Gagal memuat QRIS. Server sedang sibuk, silakan coba lagi nanti.');
    }
});

// ==========================================
// 2. ENDPOINT KHUSUS VERCEL
// ==========================================

// A. Endpoint Webhook untuk Telegram (Menerima chat)
app.use(bot.webhookCallback('/api/telegram'));

// B. Endpoint Webhook untuk Pakasir (Menerima info lunas)
app.post('/api/pakasir', async (req, res) => {
    const dataPakasir = req.body;
    
    if (dataPakasir.status === 'completed' || dataPakasir.status === 'success') {
        const orderId = dataPakasir.order_id;
        const { data: trxData } = await supabase.from('transaksi').select('*').eq('order_id', orderId).single();

        if (trxData && trxData.status === 'pending') {
            const chatId = trxData.chat_id;
            const username = trxData.username_vpn;
            const durasi = trxData.durasi;
            const potongLayanan = trxData.layanan.split('-');
            const protokol = potongLayanan[0];
            const serverDipilih = potongLayanan[1];

                try {
        await supabase.from('transaksi').insert([
            { order_id: orderId, chat_id: chatId, layanan: namaLayanan, durasi: durasi, username_vpn: usernameVpn, status: 'pending' }
        ]);

        // 1. Minta QRIS ke Pakasir (Pastikan URL API ini sesuai dengan yang kamu pakai di web lama)
        const reqQris = await fetch('https://app.pakasir.com/api/v1/payment', { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                api_key: process.env.PAKASIR_API, 
                project: process.env.PAKASIR_SLUG || "masd", // <-- INI YANG KEMARIN KELUPAAN
                order_id: orderId, 
                amount: harga,
                payment_method: "qris" 
            })
        });
        
        const resQris = await reqQris.json();

        // Jika Pakasir menolak, bot akan mengirimkan pesan error aslinya agar gampang kita lacak
        if (!reqQris.ok) {
            return ctx.reply(`⚠️ Ditolak Pakasir: ${JSON.stringify(resQris)}`);
        }

        // 2. Ambil Teks QRIS dari balasan Pakasir (Sesuaikan path JSON-nya jika berbeda)
        // Berdasarkan standar Pakasir, biasanya ada di resQris.payment.payment_number
        const teksQris = resQris.payment?.payment_number || resQris.qris_string || resQris.data?.qr_string;

        if (!teksQris) {
             return ctx.reply(`⚠️ Gagal membaca teks QRIS: ${JSON.stringify(resQris)}`);
        }

        // 3. Sulap Teks QRIS jadi Link Gambar pakai API gratis
        const linkGambarQr = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(teksQris)}`;

        // 4. Kirim Gambar ke Telegram
        ctx.replyWithPhoto({ url: linkGambarQr }, {
            caption: `Total Pembayaran: Rp ${harga}\nOrder ID: ${orderId}\n\nSilakan scan QRIS di atas.\nSistem otomatis mengirim akun VPN Anda ke chat ini setelah pembayaran lunas.`
        });
        
    } catch (err) {
        // Tampilkan error aslinya di chat biar kita tahu letak masalahnya
        ctx.reply(`⚠️ Terjadi Error Sistem: ${err.message}`);
    }
        }
    }
    res.status(200).send('OK');
});

// C. Trik Setup Otomatis Telegram (Tinggal dikunjungi via browser)
app.get('/api/setup', async (req, res) => {
    const urlVercel = `https://${req.headers.host}`;
    try {
        await bot.telegram.setWebhook(`${urlVercel}/api/telegram`);
        res.send(`<h1>✅ Berhasil!</h1><p>Bot Telegram sudah nyambung ke Vercel: ${urlVercel}/api/telegram</p>`);
    } catch (e) {
        res.send(`Gagal: ${e.message}`);
    }
});

// PENTING UNTUK VERCEL: Export app tanpa .listen()
module.exports = app;
                            
