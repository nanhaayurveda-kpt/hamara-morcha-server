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

function getClientIp(req) {
  const nf = req.headers["x-nf-client-connection-ip"];
  if (nf) return nf.trim();
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) return fwd.split(",")[0].trim();
  return "unknown";
}

const ALLOWED = (process.env.ALLOWED_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

async function verifyToken(token) {
  const r = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${token}`,
  );
  if (!r.ok) return null;
  const payload = await r.json();
  if (payload.aud !== process.env.GOOGLE_CLIENT_ID) return null;
  const verified =
    payload.email_verified === "true" || payload.email_verified === true;
  if (!verified) return null;
  return payload;
}

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return res.status(401).json({ error: "login ज़रूरी" });

    const payload = await verifyToken(token);
    if (!payload) return res.status(401).json({ error: "token गलत या expire" });

    const email = (payload.email || "").toLowerCase();
    if (!ALLOWED.includes(email)) {
      return res.status(403).json({ error: "अनुमति नहीं", email });
    }

    next();
  } catch (err) {
    return res.status(401).json({ error: "token जाँच fail", detail: err.message });
  }
}

async function verifyGoogle(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return res.status(401).json({ error: "login ज़रूरी" });

    const payload = await verifyToken(token);
    if (!payload) return res.status(401).json({ error: "token गलत या expire" });

    req.googleUser = {
      name: payload.name || "पाठक",
      email: (payload.email || "").toLowerCase(),
    };
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
  const id = req.params.id;
  const ip = getClientIp(req);

  const seen = await pool.query(
    "INSERT INTO article_views (article_id, ip) VALUES ($1, $2) ON CONFLICT (article_id, ip) DO NOTHING RETURNING article_id",
    [id, ip],
  );

  let article;
  if (seen.rowCount > 0) {
    const bumped = await pool.query(
      "UPDATE articles SET views = COALESCE(views, 0) + 1 WHERE id = $1 RETURNING *",
      [id],
    );
    article = bumped.rows[0];
  } else {
    const result = await pool.query("SELECT * FROM articles WHERE id = $1", [id]);
    article = result.rows[0];
  }

  if (!article) return res.json(null);

  const imgs = await pool.query(
    "SELECT id, image_url, image_id, caption FROM article_images WHERE article_id = $1 ORDER BY sort_order ASC, id ASC",
    [id],
  );
  article.images = imgs.rows;
  res.json(article);
});

app.get("/articles/:id/images", async (req, res) => {
  const result = await pool.query(
    "SELECT id, image_url, image_id, caption FROM article_images WHERE article_id = $1 ORDER BY sort_order ASC, id ASC",
    [req.params.id],
  );
  res.json(result.rows);
});

app.get("/articles/:id/comments", async (req, res) => {
  const result = await pool.query(
    "SELECT id, author_name, body, created_at FROM comments WHERE article_id = $1 AND approved = true ORDER BY created_at ASC",
    [req.params.id],
  );
  res.json(result.rows);
});

app.post("/articles", requireAuth, async (req, res) => {
  const { category, title, content, image_url, image_id, pdf_url, caption } =
    req.body;
  const result = await pool.query(
    "INSERT INTO articles (category, title, content, image_url, image_id, pdf_url, caption) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *",
    [category, title, content, image_url, image_id, pdf_url, caption],
  );
  res.json(result.rows[0]);
});

app.put("/articles/:id", requireAuth, async (req, res) => {
  const { category, title, content, image_url, image_id, pdf_url, caption } =
    req.body;
  const result = await pool.query(
    "UPDATE articles SET category = $1, title = $2, content = $3, image_url = $4, image_id = $5, pdf_url = $6, caption = $7 WHERE id = $8 RETURNING *",
    [category, title, content, image_url, image_id, pdf_url, caption, req.params.id],
  );
  res.json(result.rows[0]);
});

app.post("/articles/:id/images", requireAuth, async (req, res) => {
  const { image_url, image_id, caption } = req.body;
  const result = await pool.query(
    "INSERT INTO article_images (article_id, image_url, image_id, caption) VALUES ($1, $2, $3, $4) RETURNING *",
    [req.params.id, image_url, image_id || null, caption || null],
  );
  res.json(result.rows[0]);
});

app.delete("/article-images/:imageId", requireAuth, async (req, res) => {
  const found = await pool.query(
    "SELECT image_id FROM article_images WHERE id = $1",
    [req.params.imageId],
  );
  const imageId = found.rows[0]?.image_id;
  if (imageId) {
    try {
      await cloudinary.uploader.destroy(imageId);
    } catch (e) {
      console.error("cloudinary destroy failed:", e.message);
    }
  }
  await pool.query("DELETE FROM article_images WHERE id = $1", [
    req.params.imageId,
  ]);
  res.json({ ok: true });
});

app.post("/articles/:id/comments", verifyGoogle, async (req, res) => {
  const { body } = req.body;
  if (!body || !body.trim()) {
    return res.status(400).json({ error: "खाली टिप्पणी" });
  }
  const result = await pool.query(
    "INSERT INTO comments (article_id, author_name, author_email, body) VALUES ($1, $2, $3, $4) RETURNING id",
    [req.params.id, req.googleUser.name, req.googleUser.email, body.trim()],
  );
  res.json({ ok: true, id: result.rows[0].id });
});

app.get("/comments/pending", requireAuth, async (req, res) => {
  const result = await pool.query(
    "SELECT c.id, c.article_id, c.author_name, c.author_email, c.body, c.created_at, a.title AS article_title FROM comments c JOIN articles a ON a.id = c.article_id WHERE c.approved = false ORDER BY c.created_at ASC",
  );
  res.json(result.rows);
});

app.put("/comments/:id/approve", requireAuth, async (req, res) => {
  const result = await pool.query(
    "UPDATE comments SET approved = true WHERE id = $1 RETURNING *",
    [req.params.id],
  );
  res.json(result.rows[0]);
});

app.delete("/comments/:id", requireAuth, async (req, res) => {
  await pool.query("DELETE FROM comments WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
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

  const gallery = await pool.query(
    "SELECT image_id FROM article_images WHERE article_id = $1",
    [req.params.id],
  );
  for (const row of gallery.rows) {
    if (row.image_id) {
      try {
        await cloudinary.uploader.destroy(row.image_id);
      } catch (e) {
        console.error("cloudinary destroy failed:", e.message);
      }
    }
  }

  await pool.query("DELETE FROM articles WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

export default app;