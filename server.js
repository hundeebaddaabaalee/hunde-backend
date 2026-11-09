
const express = require("express");

// ==========================================
// FIREBASE ADMIN SDK v14
// ==========================================

const {
  initializeApp,
  cert,
  getApps
} = require("firebase-admin/app");

const {
  getDatabase
} = require("firebase-admin/database");

const {
  getMessaging
} = require("firebase-admin/messaging");

const {
  getAuth
} = require("firebase-admin/auth");

// ==========================================
// AGORA TOKEN BUILDER
// ==========================================

const {
  RtcTokenBuilder,
  RtcRole
} = require("agora-token");

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
      "Service account JSON is invalid. Check Render environment variable."
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

  console.log(
    "Firebase Admin initialized successfully!"
  );

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
    firebase: firebaseReady
      ? "connected"
      : "not_initialized"
  });
});

// ==========================================
// 3. SECURE AGORA TOKEN ENDPOINT
// ==========================================

app.post(
  "/generate-agora-token",
  async (req, res) => {

    if (!firebaseReady || getApps().length === 0) {
      return res.status(503).json({
        success: false,
        error: "Firebase Admin is not initialized."
      });
    }

    try {

      // --------------------------------------
      // 1. VERIFY FIREBASE AUTHENTICATION
      // --------------------------------------

      const authHeader =
        req.headers.authorization || "";

      if (!authHeader.startsWith("Bearer ")) {
        return res.status(401).json({
          success: false,
          error: "Authentication required."
        });
      }

      const idToken =
        authHeader.substring(7).trim();

      if (!idToken) {
        return res.status(401).json({
          success: false,
          error: "Invalid authentication token."
        });
      }

      const decodedToken =
        await getAuth().verifyIdToken(idToken);

      const authenticatedUid = decodedToken.uid;

      // --------------------------------------
      // 2. VALIDATE REQUEST DATA
      // --------------------------------------

      const {
        callId,
        channelName
      } = req.body || {};

      if (
        typeof callId !== "string" ||
        !callId.trim() ||
        typeof channelName !== "string" ||
        !channelName.trim() ||
        Buffer.byteLength(channelName, "utf8") >= 64
      ) {
        return res.status(400).json({
          success: false,
          error: "Valid callId and channelName are required."
        });
      }

      const cleanCallId = callId.trim();
      const cleanChannelName = channelName.trim();

      // --------------------------------------
      // 3. READ CALL FROM FIREBASE
      // --------------------------------------

      const callSnapshot = await getDatabase()
        .ref(`/Calls/${cleanCallId}`)
        .once("value");

      if (!callSnapshot.exists()) {
        return res.status(404).json({
          success: false,
          error: "Call not found."
        });
      }

      const callData = callSnapshot.val();

      // --------------------------------------
      // 4. VERIFY CALL PARTICIPANTS
      // --------------------------------------

      const isCaller =
        callData.callerId === authenticatedUid;

      const isReceiver =
        callData.receiverId === authenticatedUid;

      if (!isCaller && !isReceiver) {
        return res.status(403).json({
          success: false,
          error: "You are not a participant in this call."
        });
      }

      // --------------------------------------
      // 5. VERIFY CHANNEL NAME
      // --------------------------------------

      if (callData.channelName !== cleanChannelName) {
        return res.status(403).json({
          success: false,
          error: "Channel name does not match this call."
        });
      }

      // --------------------------------------
      // 6. VERIFY CALL STATUS
      // --------------------------------------

      if (callData.status !== "accepted") {
        return res.status(403).json({
          success: false,
          error: "Call has not been accepted."
        });
      }

      // --------------------------------------
      // 7. CHECK AGORA CREDENTIALS
      // --------------------------------------

      const appId =
        process.env.AGORA_APP_ID;

      const appCertificate =
        process.env.AGORA_APP_CERTIFICATE;

      if (!appId || !appCertificate) {
        return res.status(500).json({
          success: false,
          error: "Agora credentials are not configured."
        });
      }

      // --------------------------------------
      // 8. GENERATE AGORA ACCESS TOKEN
      // --------------------------------------

      const uid = 0;

      const role = RtcRole.PUBLISHER;

      const expirationTimeInSeconds = 3600;

      const token = RtcTokenBuilder.buildTokenWithUid(
        appId,
        appCertificate,
        cleanChannelName,
        uid,
        role,
        expirationTimeInSeconds,
        expirationTimeInSeconds
      );

      if (!token || typeof token !== "string") {
        throw new Error(
          "Agora returned an invalid token."
        );
      }

      // --------------------------------------
      // 9. SUCCESS RESPONSE
      // --------------------------------------

      const expiresAt =
        Math.floor(Date.now() / 1000) +
        expirationTimeInSeconds;

      console.log(
        `Agora token generated for call: ${cleanCallId}`
      );

      return res.status(200).json({
        success: true,
        token: token,
        channelName: cleanChannelName,
        uid: uid,
        expiresAt: expiresAt
      });

    } catch (error) {

      console.error(
        "Generate Agora token error:",
        error.message
      );

      if (
        error.code === "auth/id-token-expired" ||
        error.code === "auth/invalid-id-token" ||
        error.code === "auth/argument-error"
      ) {
        return res.status(401).json({
          success: false,
          error: "Authentication failed."
        });
      }

      return res.status(500).json({
        success: false,
        error: "Token generation failed."
      });
    }
  }
);

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

    if (
      !receiverFcmToken ||
      typeof receiverFcmToken !== "string"
    ) {
      return res.status(404).json({
        success: false,
        error: "Receiver FCM token not found."
      });
    }

    const normalizedCallType =
      String(callType || "AUDIO").toUpperCase() === "VIDEO"
        ? "VIDEO"
        : "AUDIO";

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
        callerName: String(
          callerName || "Hunde Family User"
        ),
        receiverId: String(receiverId),
        callType: normalizedCallType
      }
    };

    const response =
      await getMessaging().send(message);

    return res.status(200).json({
      success: true,
      message: "Call notification sent successfully.",
      messageId: response
    });

  } catch (error) {

    console.error(
      "Send call notification error:",
      error.message
    );

    return res.status(500).json({
      success: false,
      error: "Call notification could not be sent."
    });
  }
});

// ==========================================
// 5. START SERVER
// ==========================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {

  console.log(
    `Hunde Family Backend running on port ${PORT}`
  );

  console.log(
    `Firebase status: ${firebaseReady ? "READY" : "NOT READY"}`
  );
});
