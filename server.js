const express = require("express");
const admin = require("firebase-admin");

const app = express();
app.use(express.json());

let serviceAccount;
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } else {
    console.error("FIREBASE_SERVICE_ACCOUNT environment variable is missing!");
  }
} catch (err) {
  console.error("Failed to parse FIREBASE_SERVICE_ACCOUNT JSON:", err.message);
}

if (serviceAccount) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://hunde-family-default-rtdb.firebaseio.com"
  });
  console.log("Firebase Admin initialized successfully.");
}

app.get("/", (req, res) => {
  res.send("Hunde Family Call Backend is running online!");
});

app.post("/send-call", async (req, res) => {
  const { receiverId, callerName, channelName, callType, callId } = req.body;

  try {
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
