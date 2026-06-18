// index.js
import express from "express";
import cors from "cors";
import { pool } from "./db.js";

const app = express();

app.use(cors());
app.use(express.json());

// सारी ख़बरें लाओ
app.get("/articles", async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM articles ORDER BY created_at DESC"
  );
  res.json(result.rows);
});

// नई ख़बर जोड़ो
app.post("/articles", async (req, res) => {
  const { category, title, summary } = req.body;
  const result = await pool.query(
    "INSERT INTO articles (category, title, summary) VALUES ($1, $2, $3) RETURNING *",
    [category, title, summary]
  );
  res.json(result.rows[0]);
});

app.listen(4000, () => {
  console.log("Server चालू: http://localhost:4000");
});