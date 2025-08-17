// index.js
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const admin = require("firebase-admin");
const fetch = require("node-fetch");
const cron = require("node-cron");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

// ========================
// Express Ayarları
// ========================
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public"))); // frontend dosyaları için

// ========================
// Firebase Admin Başlat
// ========================
const serviceAccount = require("./firebase-service-account.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// ========================
// SQLite Veritabanı
// ========================
const db = new sqlite3.Database("./database.db", (err) => {
  if (err) console.error("DB Hatası:", err.message);
  else console.log("SQLite bağlandı.");
});

// Token tablosunu oluştur (ilk çalıştırmada)
db.run(
  `CREATE TABLE IF NOT EXISTS tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT UNIQUE
  )`
);

// ========================
// Token Kaydetme Endpoint
// ========================
app.post("/register-token", (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: "Token gerekli" });

  const stmt = db.prepare("INSERT OR IGNORE INTO tokens(token) VALUES(?)");
  stmt.run(token, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Token kaydedildi!" });
  });
  stmt.finalize();
});

// ========================
// Push Bildirim Gönder
// ========================
app.post("/send-notification", async (req, res) => {
  const { title, body } = req.body;
  if (!title || !body)
    return res.status(400).json({ error: "Title ve body gerekli" });

  db.all("SELECT token FROM tokens", async (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    const tokens = rows.map((r) => r.token);
    if (tokens.length === 0) return res.json({ message: "Token yok" });

    const message = {
      notification: { title, body },
      tokens,
    };

    try {
      const response = await admin.messaging().sendMulticast(message);
      res.json({ success: true, response });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
});

// ========================
// Örnek Cron Görev (her gün 08:00)
// ========================
cron.schedule("0 8 * * *", () => {
  console.log("Cron çalıştı: Günaydın bildirimleri gönderilebilir");
});

// ========================
// Sunucu Başlat
// ========================
app.listen(PORT, () => {
  console.log(`Backend çalışıyor: http://localhost:${PORT}`);
});
