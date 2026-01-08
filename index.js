const express = require("express");
const cors = require("cors");
const telegram = require("./telegram");

const app = express();
const PORT = process.env.PORT || 3000;
const AUTH_SECRET = process.env.AUTH_SECRET || "";

app.use(cors());
app.use(express.json());

function authenticateRequest(req, res, next) {
  const authHeader = req.headers["x-auth-secret"];
  if (!AUTH_SECRET || authHeader !== AUTH_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.post("/auth/send-code", authenticateRequest, async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    if (!phoneNumber) return res.status(400).json({ error: "Phone number required" });
    const result = await telegram.sendCode(phoneNumber);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/auth/verify-code", authenticateRequest, async (req, res) => {
  try {
    const { authId, code } = req.body;
    if (!authId || !code) return res.status(400).json({ error: "AuthId and code required" });
    const result = await telegram.verifyCode(authId, code);
    res.json(result);
  } catch (error) {
    if (error.message.includes("PHONE_CODE_INVALID")) return res.status(400).json({ error: "Código inválido" });
    if (error.message.includes("PHONE_CODE_EXPIRED")) return res.status(400).json({ error: "Código expirado" });
    if (error.message.includes("AUTH_EXPIRED")) return res.status(400).json({ error: "Sessão expirada" });
    res.status(500).json({ error: error.message });
  }
});

app.post("/auth/verify-2fa", authenticateRequest, async (req, res) => {
  try {
    const { authId, password } = req.body;
    if (!authId || !password) return res.status(400).json({ error: "AuthId and password required" });
    const result = await telegram.verify2FA(authId, password);
    res.json(result);
  } catch (error) {
    if (error.message.includes("PASSWORD")) return res.status(400).json({ error: "Senha incorreta" });
    res.status(500).json({ error: error.message });
  }
});

app.post("/auth/logout", authenticateRequest, async (req, res) => {
  try {
    const { sessionString } = req.body;
    const result = await telegram.logout(sessionString);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/messages/dialogs", authenticateRequest, async (req, res) => {
  try {
    const { sessionString, limit } = req.body;
    if (!sessionString) return res.status(400).json({ error: "Session string required" });
    const result = await telegram.getDialogs(sessionString, limit);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/messages/unread", authenticateRequest, async (req, res) => {
  try {
    const { sessionString } = req.body;
    if (!sessionString) return res.status(400).json({ error: "Session string required" });
    const result = await telegram.getUnreadMessages(sessionString);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Telegram MTProto server running on port ${PORT}`);
});
