const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const admin = require('firebase-admin');
const cron = require('node-cron');

const app = express();
app.use(bodyParser.json());
app.use(cors());

let db;

// Firebase Admin SDK servis hesabı JSON dosyanın yolu
const serviceAccount = require('./firebase-service-account.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// SQLite veritabanını aç ve tabloyu oluştur
(async () => {
  try {
    db = await open({
      filename: './tokens.db',
      driver: sqlite3.Database
    });

    await db.exec(`
      CREATE TABLE IF NOT EXISTS tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token TEXT UNIQUE
      )
    `);

    console.log('🗄️ SQLite veritabanı hazır.');
  } catch (err) {
    console.error('SQLite açma hatası:', err);
    process.exit(1);
  }
})();

// Tokenları topic'e abone eden fonksiyon
async function subscribeTokenToTopic(token, topic) {
  try {
    const response = await admin.messaging().subscribeToTopic(token, topic);
    console.log('Topic abonelik sonucu:', response);
    return response;
  } catch (error) {
    console.error('Topic abonelik hatası:', error);
    throw error;
  }
}

// Bildirim gönderme fonksiyonu
async function sendFCMNotification(title, body, icon) {
  const message = {
    topic: 'all',
    notification: {
      title,
      body,
      image: icon || undefined
    }
  };

  try {
    const response = await admin.messaging().send(message);
    console.log('📩 Bildirim gönderildi:', response);
    return response;
  } catch (error) {
    console.error('❌ Bildirim gönderme hatası:', error);
    throw error;
  }
}

// Token kayıt endpointi
app.post('/register-token', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ success: false, message: 'Token gerekli' });

  try {
    await db.run('INSERT OR IGNORE INTO tokens (token) VALUES (?)', token);
    await subscribeTokenToTopic(token, 'all');
    console.log('Gelen token:', token);
    res.json({ success: true, message: 'Token kaydedildi ve topic abone edildi' });
  } catch (error) {
    console.error('Token kayıt/abonelik hatası:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Anında bildirim gönderme
app.post('/send', async (req, res) => {
  const { title, body, icon } = req.body;
  if (!title || !body) return res.status(400).json({ success: false, message: 'Başlık ve mesaj gerekli' });

  try {
    const response = await sendFCMNotification(title, body, icon);
    res.json({ success: true, message: 'Bildirim gönderildi', response });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Zamanlı bildirim
app.post('/schedule', async (req, res) => {
  const { title, body, icon, time, daily } = req.body;
  if (!title || !body || !time) return res.status(400).json({ success: false, message: 'Başlık, mesaj ve zaman gerekli' });

  try {
    const date = new Date(time);

    if (daily) {
      const cronTime = `${date.getMinutes()} ${date.getHours()} * * *`;
      cron.schedule(cronTime, async () => {
        try {
          await sendFCMNotification(title, body, icon);
        } catch (err) {
          console.error('Zamanlı bildirim hatası:', err);
        }
      });
      console.log(`⏰ Günlük bildirim ayarlandı: ${cronTime}`);
      res.json({ success: true, message: 'Günlük bildirim zamanlandı' });
    } else {
      const now = Date.now();
      const delay = date.getTime() - now;

      if (delay <= 0) return res.status(400).json({ success: false, message: 'Geçmiş zaman seçilemez' });

      setTimeout(async () => {
        try {
          await sendFCMNotification(title, body, icon);
        } catch (err) {
          console.error('Tek seferlik bildirim hatası:', err);
        }
      }, delay);

      console.log(`📅 Tek seferlik bildirim ${time} için ayarlandı`);
      res.json({ success: true, message: 'Tek seferlik bildirim zamanlandı' });
    }
  } catch (error) {
    console.error('Schedule endpoint hatası:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Sunucu başlat
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Bildirim sunucusu ${PORT} portunda çalışıyor`);
});
      
