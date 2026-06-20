import express from "express";
import cors from "cors";
import { v2 as cloudinary } from "cloudinary";
import { pool } from "./db.js";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const app = express();

app.use(cors());
app.use(express.json());

const ALLOWED = (process.env.ALLOWED_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return res.status(401).json({ error: "login ज़रूरी" });

    const r = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${token}`,
    );
    if (!r.ok) {
      return res.status(401).json({ error: "token गलत या expire" });
    }

    const payload = await r.json();

    if (payload.aud !== process.env.GOOGLE_CLIENT_ID) {
      return res.status(403).json({ error: "गलत app (Client ID मेल नहीं)" });
    }

    const email = (payload.email || "").toLowerCase();
    const verified =
      payload.email_verified === "true" || payload.email_verified === true;

    if (!verified || !ALLOWED.includes(email)) {
      return res.status(403).json({ error: "अनुमति नहीं", email });
    }

    next();
  } catch (err) {
    return res.status(401).json({ error: "token जाँच fail", detail: err.message });
  }
}

app.get("/articles", async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM articles ORDER BY created_at DESC",
  );
  res.json(result.rows);
});

app.get("/articles/:id", async (req, res) => {
  const result = await pool.query("SELECT * FROM articles WHERE id = $1", [
    req.params.id,
  ]);
  res.json(result.rows[0]);
});

app.post("/articles", requireAuth, async (req, res) => {
  const { category, title, content, image_url, image_id } = req.body;
  const result = await pool.query(
    "INSERT INTO articles (category, title, content, image_url, image_id) VALUES ($1, $2, $3, $4, $5) RETURNING *",
    [category, title, content, image_url, image_id],
  );
  res.json(result.rows[0]);
});

app.put("/articles/:id", requireAuth, async (req, res) => {
  const { category, title, content, image_url, image_id } = req.body;
  const result = await pool.query(
    "UPDATE articles SET category = $1, title = $2, content = $3, image_url = $4, image_id = $5 WHERE id = $6 RETURNING *",
    [category, title, content, image_url, image_id, req.params.id],
  );
  res.json(result.rows[0]);
});

app.delete("/articles/:id", requireAuth, async (req, res) => {
  const found = await pool.query("SELECT image_id FROM articles WHERE id = $1", [
    req.params.id,
  ]);
  const imageId = found.rows[0]?.image_id;
  if (imageId) {
    try {
      await cloudinary.uploader.destroy(imageId);
    } catch (e) {
      console.error("cloudinary destroy failed:", e.message);
    }
  }
  await pool.query("DELETE FROM articles WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

export default app;