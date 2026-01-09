const express = require("express");
const cors = require("cors");
const telegram = require("./telegram");

const app = express();
const PORT = process.env.PORT || 3000;
const AUTH_SECRET = process.env.AUTH_SECRET || "";

app.use(cors());
app.use(express.json());

// Auth middleware
function authenticateRequest(req, res, next) {
  const authHeader = req.headers["x-auth-secret"];
  if (!AUTH_SECRET || authHeader !== AUTH_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Send verification code
app.post("/auth/send-code", authenticateRequest, async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    if (!phoneNumber) {
      return res.status(400).json({ error: "Phone number required" });
    }
    console.log(`Sending code to ${phoneNumber}`);
    const result = await telegram.sendCode(phoneNumber);
    res.json(result);
  } catch (error) {
    console.error("SendCode error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// Verify code
app.post("/auth/verify-code", authenticateRequest, async (req, res) => {
  try {
    const { authId, code } = req.body;
    if (!authId || !code) {
      return res.status(400).json({ error: "AuthId and code required" });
    }
    console.log(`Verifying code for ${authId}`);
    const result = await telegram.verifyCode(authId, code);
    res.json(result);
  } catch (error) {
    console.error("VerifyCode error:", error.message);
    if (error.message.includes("PHONE_CODE_INVALID")) {
      return res.status(400).json({ error: "Código inválido" });
    }
    if (error.message.includes("PHONE_CODE_EXPIRED")) {
      return res.status(400).json({ error: "Código expirado" });
    }
    if (error.message.includes("AUTH_EXPIRED")) {
      return res.status(400).json({ error: "Sessão expirada. Tente novamente." });
    }
    res.status(500).json({ error: error.message });
  }
});

// Verify 2FA password
app.post("/auth/verify-2fa", authenticateRequest, async (req, res) => {
  try {
    const { authId, password } = req.body;
    if (!authId || !password) {
      return res.status(400).json({ error: "AuthId and password required" });
    }
    console.log(`Verifying 2FA for ${authId}`);
    const result = await telegram.verify2FA(authId, password);
    res.json(result);
  } catch (error) {
    console.error("Verify2FA error:", error.message);
    if (error.message.includes("PASSWORD")) {
      return res.status(400).json({ error: "Senha incorreta" });
    }
    res.status(500).json({ error: error.message });
  }
});

// Logout
app.post("/auth/logout", authenticateRequest, async (req, res) => {
  try {
    const { sessionString } = req.body;
    const result = await telegram.logout(sessionString);
    res.json(result);
  } catch (error) {
    console.error("Logout error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get dialogs
app.post("/messages/dialogs", authenticateRequest, async (req, res) => {
  try {
    const { sessionString, limit } = req.body;
    if (!sessionString) {
      return res.status(400).json({ error: "Session string required" });
    }
    console.log("Fetching dialogs");
    const result = await telegram.getDialogs(sessionString, limit);
    res.json(result);
  } catch (error) {
    console.error("GetDialogs error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get unread messages
app.post("/messages/unread", authenticateRequest, async (req, res) => {
  try {
    const { sessionString } = req.body;
    if (!sessionString) {
      return res.status(400).json({ error: "Session string required" });
    }
    console.log("Fetching unread messages");
    const result = await telegram.getUnreadMessages(sessionString);
    res.json(result);
  } catch (error) {
    console.error("GetUnread error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get recent messages (last N days)
app.post("/messages/recent", authenticateRequest, async (req, res) => {
  try {
    const { sessionString, days } = req.body;
    if (!sessionString) {
      return res.status(400).json({ error: "Session string required" });
    }
    console.log(`Fetching messages from last ${days || 7} days`);
    const result = await telegram.getRecentMessages(sessionString, days || 7);
    res.json(result);
  } catch (error) {
    console.error("GetRecent error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// Send message
app.post("/messages/send", authenticateRequest, async (req, res) => {
  try {
    const { sessionString, dialogId, message, replyToMsgId } = req.body;
    if (!sessionString || !dialogId || !message) {
      return res.status(400).json({ error: "Session string, dialogId, and message required" });
    }
    console.log(`Sending message to dialog ${dialogId}`);
    const result = await telegram.sendMessage(sessionString, dialogId, message, replyToMsgId);
    res.json(result);
  } catch (error) {
    console.error("SendMessage error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Telegram MTProto server running on port ${PORT}`);
});

