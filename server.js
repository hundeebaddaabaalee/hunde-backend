const express = require("express");

// Firebase Admin SDK v14 modular imports
const { initializeApp, cert, getApps } =
  require("firebase-admin/app");

const { getDatabase } =
  require("firebase-admin/database");

const { getMessaging } =
  require("firebase-admin/messaging");

// Agora Access Token Builder import gochuu
const { RtcTokenBuilder, RtcRole } = 
  require("agora-access-token");

const app = express();

app.use(express.json({ limit: "1mb" }));

// ==========================================
// 1. FIREBASE ADMIN INITIALIZATION
// ==========================================

let firebaseReady = false;

try {
  const envKey = process.env.FIREBASE_SERVICE_ACCOUNT;

  if (!envKey || !envKey.trim()) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT environment variable is missing."
    );
  }

  let serviceAccount;
  const trimmedKey = envKey.trim();

  try {
    if (trimmedKey.startsWith("{")) {
      serviceAccount = JSON.parse(trimmedKey);
    } else {
      const decodedKey = Buffer
        .from(trimmedKey, "base64")
        .toString("utf8");

      serviceAccount = JSON.parse(decodedKey);
    }
  } catch (parseError) {
    throw new Error(
      "Service account JSON is invalid. Check the Render environment variable."
    );
  }

  if (
    !serviceAccount.project_id ||
    !serviceAccount.client_email ||
    !serviceAccount.private_key
  ) {
    throw new Error(
      "Service account is missing required fields."
    );
  }

  if (getApps().length === 0) {
    initializeApp({
      credential: cert(serviceAccount),
      databaseURL:
        "https://hunde-family-default-rtdb.firebaseio.com"
    });
  }

  firebaseReady = true;
  console.log("Firebase Admin initialized successfully!");

} catch (error) {
  firebaseReady = false;
  console.error(
    "Failed to initialize Firebase Admin:",
    error.message
  );
}

// ==========================================
// 2. HOME / HEALTH CHECK
// ==========================================

app.get("/", (req, res) => {
  res.status(200).send(
    "Hunde Family Backend is live and ready!"
  );
});

app.get("/health", (req, res) => {
  res.status(firebaseReady ? 200 : 503).json({
    server: "online",
    firebase: firebaseReady ? "connected" : "not_initialized"
  });
});

// ==========================================
// 3. GENERATE AGORA TOKEN ENDPOINT
// ==========================================

app.post("/generate-agora-token", (req, res) => {
  const { channelName, uid } = req.body || {};

  if (!channelName) {
    return res.status(400).json({
      success: false,
      error: "Channel name is required."
    });
  }

  const appId = process.env.AGORA_APP_ID;
  const appCertificate = process.env.AGORA_APP_CERTIFICATE;

  if (!appId || !appCertificate) {
    return res.status(500).json({
      success: false,
      error: "Agora credentials are not configured on the server."
    });
  }

  try {
    const intUid = uid ? parseInt(uid, 10) : 0;
    const role = RtcRole.PUBLISHER;
    
    // Token sa'atii 1 (3600 seconds) akka turu godhamee qophaa'a
    const expirationTimeInSeconds = 3600;
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;

    const token = RtcTokenBuilder.buildTokenWithUid(
      appId,
      appCertificate,
      channelName,
      intUid,
      role,
      privilegeExpiredTs
    );

    return res.status(200).json({
      success: true,
      token: token
    });

  } catch (error) {
    console.error("Generate Agora token error:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ==========================================
// 4. SEND INCOMING CALL NOTIFICATION
// ==========================================

app.post("/send-call", async (req, res) => {
  if (!firebaseReady || getApps().length === 0) {
    return res.status(503).json({
      success: false,
      error: "Firebase Admin is not initialized."
    });
  }

  const {
    receiverId,
    callerName,
    channelName,
    callType,
    callId
  } = req.body || {};

  if (!receiverId || !channelName || !callId) {
    return res.status(400).json({
      success: false,
      error: "Missing required call information."
    });
  }

  try {
    const userSnapshot = await getDatabase()
      .ref(`/Users/${receiverId}/fcmToken`)
      .once("value");

    const receiverFcmToken = userSnapshot.val();

    if (!receiverFcmToken || typeof receiverFcmToken !== "string") {
      return res.status(404).json({
        success: false,
        error: "Receiver FCM token not found."
      });
    }

    const message = {
      token: receiverFcmToken,
      android: {
        priority: "high",
        ttl: 30 * 1000
      },
      data: {
        type: "CALL",
        callId: String(callId),
        channelName: String(channelName),
        callerName: String(callerName || "Hunde Family User"),
        receiverId: String(receiverId),
        callType: String(callType || "AUDIO")
      }
    };

    const response = await getMessaging().send(message);

    return res.status(200).json({
      success: true,
      message: "Call notification sent successfully.",
      messageId: response
    });

  } catch (error) {
    console.error("Send call notification error:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ==========================================
// 5. START SERVER
// ==========================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Hunde Family Backend running on port ${PORT}`);
  console.log(`Firebase status: ${firebaseReady ? "READY" : "NOT READY"}`);
});
  
