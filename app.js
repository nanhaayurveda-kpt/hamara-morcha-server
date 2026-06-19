// app.js
import express from "express";
import cors from "cors";
import { pool } from "./db.js";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/articles", async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM articles ORDER BY created_at DESC"
  );
  res.json(result.rows);
});

app.post("/articles", async (req, res) => {
  const { category, title, summary } = req.body;
  const result = await pool.query(
    "INSERT INTO articles (category, title, summary) VALUES ($1, $2, $3) RETURNING *",
    [category, title, summary]
  );
  res.json(result.rows[0]);
});

app.delete("/articles/:id", async (req, res) => {
  await pool.query("DELETE FROM articles WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

export default app;