const express = require("express");
const admin = require("firebase-admin");

const app = express();
app.use(express.json());

// Firebase Admin initialization with safety fallback
try {
  const envKey = process.env.FIREBASE_SERVICE_ACCOUNT;

  if (envKey) {
    let serviceAccount;
    // Handle string or base64 if needed
    if (typeof envKey === "string") {
      serviceAccount = JSON.parse(envKey);
    } else {
      serviceAccount = envKey;
    }

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: "https://hunde-family-default-rtdb.firebaseio.com"
    });
    console.log("Firebase Admin initialized successfully!");
  } else {
    console.error("CRITICAL ERROR: FIREBASE_SERVICE_ACCOUNT environment variable is NOT set on Render!");
  }
} catch (error) {
  console.error("Failed to initialize Firebase Admin:", error.message);
}

app.get("/", (req, res) => {
  res.send("Hunde Family Backend is live and ready!");
});

app.post("/send-call", async (req, res) => {
  const { receiverId, callerName, channelName, callType, callId } = req.body;

  try {
    if (!admin.apps.length) {
      return res.status(500).json({ error: "Firebase Admin is not initialized properly on server." });
    }

    const userSnapshot = await admin.database().ref(`/Users/${receiverId}/fcmToken`).once("value");
    const receiverFcmToken = userSnapshot.val();

    if (!receiverFcmToken) {
      return res.status(404).json({ error: "Receiver FCM token not found" });
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
        callerName: String(callerName),
        receiverId: String(receiverId),
        callType: String(callType || "AUDIO")
      }
    };

    const response = await admin.messaging().send(message);
    return res.status(200).json({ success: true, response });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
