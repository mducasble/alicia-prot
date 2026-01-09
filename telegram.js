const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");

const API_ID = parseInt(process.env.TELEGRAM_API_ID || "0", 10);
const API_HASH = process.env.TELEGRAM_API_HASH || "";

const pendingAuths = new Map();

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function createClient(sessionString = "") {
  const stringSession = new StringSession(sessionString);
  const client = new TelegramClient(stringSession, API_ID, API_HASH, {
    connectionRetries: 5,
    useWSS: true,
  });
  await client.connect();
  return client;
}

function cleanupExpiredAuths() {
  const now = Date.now();
  for (const [key, value] of pendingAuths.entries()) {
    if (now - (value.createdAt || 0) > 15 * 60 * 1000) {
      try {
        value?.codeDeferred?.reject?.(new Error("AUTH_EXPIRED"));
        value?.passwordDeferred?.reject?.(new Error("AUTH_EXPIRED"));
      } catch (_) {}
      try {
        value?.client?.disconnect?.();
      } catch (_) {}
      pendingAuths.delete(key);
    }
  }
}

async function sendCode(phoneNumber) {
  cleanupExpiredAuths();
  const authId = `auth_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  const client = await createClient("");
  const codeDeferred = deferred();
  const passwordDeferred = deferred();
  const passwordRequested = deferred();

  const startPromise = (async () => {
    try {
      await client.start({
        phoneNumber: async () => phoneNumber,
        phoneCode: async () => {
          const code = await codeDeferred.promise;
          return String(code);
        },
        password: async () => {
          passwordRequested.resolve(true);
          const pw = await passwordDeferred.promise;
          return String(pw);
        },
        onError: (err) => {
          console.error("Telegram start error:", err?.message || err);
        },
      });
      const me = await client.getMe();
      const finalSession = client.session.save();
      return {
        sessionString: finalSession,
        user: {
          id: me.id?.toString(),
          firstName: me.firstName,
          lastName: me.lastName,
          username: me.username,
          phone: me.phone,
        },
      };
    } finally {
      try {
        await client.disconnect();
      } catch (_) {}
    }
  })();

  pendingAuths.set(authId, {
    authId,
    phoneNumber,
    client,
    createdAt: Date.now(),
    codeDeferred,
    passwordDeferred,
    passwordRequested,
    startPromise,
  });

  return { success: true, authId, codeLength: 5, codeType: "SMS" };
}

async function verifyCode(authId, code) {
  const pending = pendingAuths.get(authId);
  if (!pending) throw new Error("AUTH_EXPIRED");
  pending.codeDeferred.resolve(code);
  try {
    const result = await Promise.race([
      pending.startPromise.then((r) => ({ type: "done", data: r })),
      pending.passwordRequested.promise.then(() => ({ type: "needs2fa" })),
    ]);
    if (result.type === "needs2fa") {
      return { success: true, needs2FA: true, authId };
    }
    pendingAuths.delete(authId);
    return { success: true, sessionString: result.data.sessionString, user: result.data.user };
  } catch (error) {
    pendingAuths.delete(authId);
    throw error;
  }
}

async function verify2FA(authId, password) {
  const pending = pendingAuths.get(authId);
  if (!pending) throw new Error("AUTH_EXPIRED");
  pending.passwordDeferred.resolve(password);
  try {
    const result = await pending.startPromise;
    pendingAuths.delete(authId);
    return { success: true, sessionString: result.sessionString, user: result.user };
  } catch (error) {
    pendingAuths.delete(authId);
    const msg = error?.message || String(error);
    if (msg.toUpperCase().includes("PASSWORD")) {
      throw new Error("PASSWORD_INVALID");
    }
    throw error;
  }
}

async function logout(sessionString) {
  if (!sessionString) return { success: true };
  try {
    const client = await createClient(sessionString);
    await client.logOut();
    await client.disconnect();
  } catch (error) {
    console.log("Logout error (may already be logged out):", error.message);
  }
  return { success: true };
}

async function getDialogs(sessionString, limit = 50) {
  const client = await createClient(sessionString);
  try {
    const dialogs = await client.getDialogs({ limit });
    const dialogsData = dialogs.map((dialog) => ({
      id: dialog.id?.toString(),
      title: dialog.title || dialog.name || "Unknown",
      unreadCount: dialog.unreadCount || 0,
      lastMessage: dialog.message?.message || "",
      date: dialog.message?.date ? new Date(dialog.message.date * 1000).toISOString() : null,
      isUser: dialog.isUser,
      isGroup: dialog.isGroup,
      isChannel: dialog.isChannel,
    }));
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
        const messages = await client.getMessages(dialog.entity, {
          limit: Math.min(dialog.unreadCount || 5, 20),
        });
        const formattedMessages = messages.map((msg) => ({
          id: msg.id?.toString() || "",
          text: msg.message || "",
          date: msg.date ? new Date(msg.date * 1000).toISOString() : new Date().toISOString(),
          senderId: msg.senderId?.toString() || "",
          senderName: msg.sender?.firstName || msg.sender?.title || "Unknown",
        }));
        unreadMessages.push({
          dialogId: dialog.id?.toString() || "",
          dialogTitle: dialog.title || dialog.name || "Unknown",
          isGroup: dialog.isGroup,
          isChannel: dialog.isChannel,
          messages: formattedMessages,
        });
      } catch (e) {
        console.log(`Error fetching messages for dialog ${dialog.id}:`, e.message);
      }
    }
    await client.disconnect();
    return { success: true, unread: unreadMessages, totalUnreadDialogs: unreadDialogs.length };
  } catch (error) {
    await client.disconnect();
    throw error;
  }
}

async function getRecentMessages(sessionString, days = 7) {
  const client = await createClient(sessionString);
  try {
    const cutoffDate = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;
    const dialogs = await client.getDialogs({ limit: 50 });
    const allMessages = [];
    for (const dialog of dialogs) {
      if (dialog.isChannel && !dialog.isGroup) continue;
      try {
        const messages = await client.getMessages(dialog.entity, { limit: 50, offsetDate: 0 });
        for (const msg of messages) {
          if (msg.date && msg.date >= cutoffDate) {
            allMessages.push({
              id: msg.id?.toString() || "",
              text: msg.message || "",
              date: msg.date,
              dialogId: dialog.id?.toString() || "",
              dialogTitle: dialog.title || dialog.name || "Unknown",
              isGroup: dialog.isGroup || false,
              isChannel: dialog.isChannel || false,
              senderId: msg.senderId?.toString() || "",
              senderName: msg.sender?.firstName || msg.sender?.title || "Unknown",
              isOutgoing: msg.out || false,
            });
          }
        }
      } catch (e) {
        console.log(`Error fetching messages for dialog ${dialog.id}:`, e.message);
      }
    }
    allMessages.sort((a, b) => b.date - a.date);
    await client.disconnect();
    return { success: true, messages: allMessages, totalCount: allMessages.length, cutoffDate: new Date(cutoffDate * 1000).toISOString() };
  } catch (error) {
    await client.disconnect();
    throw error;
  }
}

async function sendMessage(sessionString, dialogId, message, replyToMsgId = null) {
  const client = await createClient(sessionString);
  try {
    const dialogs = await client.getDialogs({ limit: 100 });
    const dialog = dialogs.find(d => d.id?.toString() === dialogId);
    if (!dialog) throw new Error("Dialog not found");
    const sendOptions = { message };
    if (replyToMsgId) sendOptions.replyTo = parseInt(replyToMsgId, 10);
    const result = await client.sendMessage(dialog.entity, sendOptions);
    await client.disconnect();
    return { success: true, messageId: result.id?.toString(), date: result.date };
  } catch (error) {
    await client.disconnect();
    throw error;
  }
}

module.exports = {
  sendCode,
  verifyCode,
  verify2FA,
  logout,
  getDialogs,
  getUnreadMessages,
  getRecentMessages,
  sendMessage,
};
