const { TelegramClient, Api } = require("telegram");
const { StringSession } = require("telegram/sessions");

const API_ID = parseInt(process.env.TELEGRAM_API_ID || "0");
const API_HASH = process.env.TELEGRAM_API_HASH || "";

const pendingAuths = new Map();

async function createClient(sessionString = "") {
  const stringSession = new StringSession(sessionString);
  const client = new TelegramClient(stringSession, API_ID, API_HASH, {
    connectionRetries: 5,
    useWSS: true,
  });
  await client.connect();
  return client;
}

async function sendCode(phoneNumber) {
  const client = await createClient();
  try {
    const result = await client.invoke(
      new Api.auth.SendCode({
        phoneNumber,
        apiId: API_ID,
        apiHash: API_HASH,
        settings: new Api.CodeSettings({ allowFlashcall: false, currentNumber: true, allowAppHash: true }),
      })
    );
    const sessionString = client.session.save();
    const authId = `auth_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    pendingAuths.set(authId, { phoneCodeHash: result.phoneCodeHash, phoneNumber, sessionString, createdAt: Date.now() });
    for (const [key, value] of pendingAuths.entries()) {
      if (Date.now() - value.createdAt > 600000) pendingAuths.delete(key);
    }
    await client.disconnect();
    return { success: true, authId, codeLength: result.type?.length || 5, codeType: result.type?.className || "SMS" };
  } catch (error) {
    await client.disconnect();
    throw error;
  }
}

async function verifyCode(authId, code) {
  const pending = pendingAuths.get(authId);
  if (!pending) throw new Error("AUTH_EXPIRED");
  const client = await createClient(pending.sessionString);
  try {
    await client.invoke(new Api.auth.SignIn({ phoneNumber: pending.phoneNumber, phoneCodeHash: pending.phoneCodeHash, phoneCode: code }));
    const me = await client.getMe();
    const finalSession = client.session.save();
    pendingAuths.delete(authId);
    await client.disconnect();
    return { success: true, sessionString: finalSession, user: { id: me.id?.toString(), firstName: me.firstName, lastName: me.lastName, username: me.username, phone: me.phone } };
  } catch (error) {
    if (error.message?.includes("SESSION_PASSWORD_NEEDED")) {
      pending.sessionString = client.session.save();
      pending.needs2FA = true;
      pendingAuths.set(authId, pending);
      await client.disconnect();
      return { success: true, needs2FA: true, authId };
    }
    await client.disconnect();
    throw error;
  }
}

async function verify2FA(authId, password) {
  const pending = pendingAuths.get(authId);
  if (!pending) throw new Error("AUTH_EXPIRED");
  const client = await createClient(pending.sessionString);
  try {
    const passwordInfo = await client.invoke(new Api.account.GetPassword());
    const srpResult = await client.computeSrpPassword(passwordInfo, password);
    await client.invoke(new Api.auth.CheckPassword({ password: srpResult }));
    const me = await client.getMe();
    const finalSession = client.session.save();
    pendingAuths.delete(authId);
    await client.disconnect();
    return { success: true, sessionString: finalSession, user: { id: me.id?.toString(), firstName: me.firstName, lastName: me.lastName, username: me.username, phone: me.phone } };
  } catch (error) {
    await client.disconnect();
    throw error;
  }
}

async function logout(sessionString) {
  if (!sessionString) return { success: true };
  try {
    const client = await createClient(sessionString);
    await client.invoke(new Api.auth.LogOut());
    await client.disconnect();
  } catch (error) {
    console.log("Logout error:", error.message);
  }
  return { success: true };
}

async function getDialogs(sessionString, limit = 50) {
  const client = await createClient(sessionString);
  try {
    const dialogs = await client.getDialogs({ limit });
    const dialogsData = dialogs.map((d) => ({ id: d.id?.toString(), title: d.title || d.name || "Unknown", unreadCount: d.unreadCount || 0, lastMessage: d.message?.message || "", date: d.message?.date ? new Date(d.message.date * 1000).toISOString() : null, isUser: d.isUser, isGroup: d.isGroup, isChannel: d.isChannel }));
    await client.disconnect();
    return { success: true, dialogs: dialogsData };
  } catch (error) {
    await client.disconnect();
    throw error;
  }
}

async function getUnreadMessages(sessionString) {
  const client = await createClient(sessionString);
  try {
    const dialogs = await client.getDialogs({ limit: 100 });
    const unreadDialogs = dialogs.filter((d) => (d.unreadCount || 0) > 0);
    const unreadMessages = [];
    for (const dialog of unreadDialogs.slice(0, 15)) {
      try {
        const messages = await client.getMessages(dialog.entity, { limit: Math.min(dialog.unreadCount || 5, 20) });
        unreadMessages.push({ dialogId: dialog.id?.toString() || "", dialogTitle: dialog.title || dialog.name || "Unknown", isGroup: dialog.isGroup, isChannel: dialog.isChannel, messages: messages.map((m) => ({ id: m.id?.toString() || "", text: m.message || "", date: m.date ? new Date(m.date * 1000).toISOString() : new Date().toISOString(), senderId: m.senderId?.toString() || "", senderName: m.sender?.firstName || m.sender?.title || "Unknown" })) });
      } catch (e) { console.log("Error:", e.message); }
    }
    await client.disconnect();
    return { success: true, unread: unreadMessages, totalUnreadDialogs: unreadDialogs.length };
  } catch (error) {
    await client.disconnect();
    throw error;
  }
}

module.exports = { sendCode, verifyCode, verify2FA, logout, getDialogs, getUnreadMessages };
