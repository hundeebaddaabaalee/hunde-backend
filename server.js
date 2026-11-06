
const express = require("express");

// Firebase Admin SDK v14 modular imports
const { initializeApp, cert, getApps } =
  require("firebase-admin/app");

const { getDatabase } =
  require("firebase-admin/database");

const { getMessaging } =
  require("firebase-admin/messaging");

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

  // Support JSON or Base64 encoded JSON
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

  // Validate required service account fields
  if (
    !serviceAccount.project_id ||
    !serviceAccount.client_email ||
    !serviceAccount.private_key
  ) {
    throw new Error(
      "Service account is missing required fields."
    );
  }

  // Initialize only once
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
    firebase: firebaseReady ? "connected" : "not_initialized"
  });
});

// ==========================================
// 3. SEND INCOMING CALL NOTIFICATION
// ==========================================

app.post("/send-call", async (req, res) => {

  // Check Firebase initialization
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

  // Validate required information
  if (
    !receiverId ||
    !channelName ||
    !callId
  ) {
    return res.status(400).json({
      success: false,
      error: "Missing required call information."
    });
  }

  try {

    // Get receiver FCM token from Firebase Database
    const userSnapshot = await getDatabase()
      .ref(`/Users/${receiverId}/fcmToken`)
      .once("value");

    const receiverFcmToken = userSnapshot.val();

    if (
      !receiverFcmToken ||
      typeof receiverFcmToken !== "string"
    ) {
      console.log(
        "Receiver FCM token not found."
      );

      return res.status(404).json({
        success: false,
        error: "Receiver FCM token not found."
      });
    }

    // Prepare Firebase Cloud Messaging notification
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
        callType: String(
          callType || "AUDIO"
        )
      }
    };

    // Send notification
    const response = await getMessaging().send(message);

    console.log(
      "Call notification sent successfully:",
      response
    );

    return res.status(200).json({
      success: true,
      message: "Call notification sent successfully.",
      messageId: response
    });

  } catch (error) {

    console.error(
      "Send call notification error:",
      error.code || "",
      error.message
    );

    return res.status(500).json({
      success: false,
      error: error.message,
      errorCode: error.code || "UNKNOWN_ERROR"
    });
  }
});

// ==========================================
// 4. START SERVER
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
