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

app.get("/articles", async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM articles ORDER BY created_at DESC",
  );
  res.json(result.rows);
});

app.post("/articles", async (req, res) => {
  const { category, title, content, image_url, image_id } = req.body;
  const result = await pool.query(
    "INSERT INTO articles (category, title, content, image_url, image_id) VALUES ($1, $2, $3, $4, $5) RETURNING *",
    [category, title, content, image_url, image_id],
  );
  res.json(result.rows[0]);
});

app.delete("/articles/:id", async (req, res) => {
  const found = await pool.query(
    "SELECT image_id FROM articles WHERE id = $1",
    [req.params.id],
  );
  const imageId = found.rows[0]?.image_id;
  if (imageId) {
    await cloudinary.uploader.destroy(imageId);
  }
  await pool.query("DELETE FROM articles WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

export default app;
