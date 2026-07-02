const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");
const crypto = require("crypto");
const Razorpay = require("razorpay");

admin.initializeApp();
const db = admin.firestore();

// Rate limiting map (in-memory, only applies to the specific Cloud Function instance)
const lastRequestTime = new Map();
const THROTTLE_DELAY = 1000;
const HISTORY_LIMIT = 5;
const PREMIUM_AMOUNT_PAISE = 9000;
const PREMIUM_DAYS = 30;

function envValue(name, configPath) {
    const value = process.env[name];
    if (value) return value;
    return configPath
        .split(".")
        .reduce((acc, key) => (acc && acc[key] ? acc[key] : undefined), functions.config());
}

function getRazorpayClient() {
    const keyId = envValue("RAZORPAY_KEY_ID", "razorpay.key_id");
    const keySecret = envValue("RAZORPAY_KEY_SECRET", "razorpay.key_secret");

    if (!keyId || !keySecret) {
        throw new functions.https.HttpsError(
            "failed-precondition",
            "Razorpay keys are not configured."
        );
    }

    return {
        keyId,
        client: new Razorpay({
            key_id: keyId,
            key_secret: keySecret
        })
    };
}

// Helper: Call Ollama (assuming it's hosted publicly or via a tunnel, or we simulate it if localhost)
// For Cloud Functions, accessing localhost:11434 will NOT work unless Ollama is public.
// We will use a mock response if we can't reach it, or assume the user has a public endpoint.
async function callLLM(messages, retries = 2) {
    const url = process.env.OLLAMA_URL || 'http://host.docker.internal:11434/api/chat'; // Placeholder, usually requires public IP/Ngrok
    const model = process.env.OLLAMA_MODEL || 'gemma:2b';
    
    // For local emulation testing, we can try to reach local ollama.
    // In production Firebase Functions, this needs a real public endpoint.
    // For now, to keep it working without crashing, we mock if we fail.
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            const response = await axios.post(url, {
                model: model,
                messages: messages,
                stream: false
            }, { timeout: 30000 });
            return response.data.message.content.trim();
        } catch (error) {
            console.error(`LLM Error (Attempt ${attempt+1}):`, error.message);
            if (attempt === retries - 1) {
                return `Error: Failed to connect to LLM. Using offline fallback response.`;
            }
            await new Promise(r => setTimeout(r, 1000));
        }
    }
}

// 1. Chat Function (Callable)
exports.chatWithSERENOVA = functions.https.onCall(async (data, context) => {
    // Ensure the user is authenticated
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'The function must be called while authenticated.'
        );
    }

    const { message, sessionId, emotion } = data;
    const uid = context.auth.uid;

    if (!message || message.trim() === "") {
        throw new functions.https.HttpsError('invalid-argument', 'Message cannot be empty.');
    }

    // Rate Limiting per UID
    const currentTime = Date.now();
    if (lastRequestTime.has(uid) && (currentTime - lastRequestTime.get(uid) < THROTTLE_DELAY)) {
        throw new functions.https.HttpsError('resource-exhausted', 'Too fast! Please wait.');
    }
    lastRequestTime.set(uid, currentTime);

    const actualSessionId = sessionId || `session_${uid}`;
    const chatRef = db.collection('chats').doc(uid).collection('sessions').doc(actualSessionId);
    
    let sessionDoc = await chatRef.get();
    let messages = [];
    if (sessionDoc.exists) {
        messages = sessionDoc.data().messages || [];
    }

    // Prepare system prompt
    let systemContent = "You are SERENOVA, a friendly AI Assistant. Keep answers brief and professional.";
    if (emotion === 'sad') systemContent += " The user seems sad, be empathetic.";
    if (emotion === 'angry') systemContent += " The user seems angry, be calm and helpful.";

    const systemPrompt = { role: "system", content: systemContent };
    
    const llmMessages = [
        systemPrompt,
        ...messages,
        { role: "user", content: message.trim() }
    ];

    let responseContent = await callLLM(llmMessages);
    
    // Fallback if LLM isn't accessible
    if (responseContent.startsWith("Error:")) {
        responseContent = "I'm currently unable to reach my neural core (LLM offline). How can I assist you otherwise?";
    }

    // Update History
    messages.push({ role: "user", content: message.trim(), timestamp: Date.now() });
    messages.push({ role: "assistant", content: responseContent, timestamp: Date.now() });
    
    // Keep within limits
    if (messages.length > HISTORY_LIMIT * 2) {
        messages = messages.slice(-(HISTORY_LIMIT * 2));
    }

    // Save back to Firestore
    await chatRef.set({ messages: messages, updatedAt: Date.now() }, { merge: true });

    // Store message in a global collection for analytics/history
    await db.collection('messages').add({
        uid,
        sessionId: actualSessionId,
        userMessage: message.trim(),
        botResponse: responseContent,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    return {
        response: responseContent,
        sessionId: actualSessionId
    };
});

// 2. Setup User Profile on Create
exports.onUserCreated = functions.auth.user().onCreate(async (user) => {
    await db.collection('users').doc(user.uid).set({
        email: user.email || null,
        phoneNumber: user.phoneNumber || null,
        displayName: user.displayName || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        plan: 'free',
        subscriptionStatus: 'free',
        features: {
            faceGestureAnalysis: false,
            mentalHealthScoring: false,
            heartRateEstimation: false,
            healthReports: false
        }
    });

    await db.collection('analytics_events').add({
        event: 'user_signup',
        userId: user.uid,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
});

// 3. Create a Razorpay order for the Premium plan.
exports.createPremiumOrder = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            "unauthenticated",
            "You must be signed in to upgrade."
        );
    }

    const { keyId, client } = getRazorpayClient();
    const uid = context.auth.uid;
    const receipt = `premium_${uid}_${Date.now()}`.slice(0, 40);

    const order = await client.orders.create({
        amount: PREMIUM_AMOUNT_PAISE,
        currency: "INR",
        receipt,
        payment_capture: 1,
        notes: {
            uid,
            plan: "premium",
            durationDays: String(PREMIUM_DAYS)
        }
    });

    await db.collection("payment_orders").doc(order.id).set({
        uid,
        orderId: order.id,
        amount: PREMIUM_AMOUNT_PAISE,
        currency: "INR",
        status: "created",
        createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return {
        id: order.id,
        amount: order.amount,
        currency: order.currency,
        keyId
    };
});

// 4. Verify Razorpay signature before unlocking Premium.
exports.verifyPremiumPayment = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            "unauthenticated",
            "You must be signed in to verify payment."
        );
    }

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = data || {};
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        throw new functions.https.HttpsError(
            "invalid-argument",
            "Missing Razorpay payment fields."
        );
    }

    const keySecret = envValue("RAZORPAY_KEY_SECRET", "razorpay.key_secret");
    if (!keySecret) {
        throw new functions.https.HttpsError(
            "failed-precondition",
            "Razorpay secret is not configured."
        );
    }

    const expectedSignature = crypto
        .createHmac("sha256", keySecret)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest("hex");

    if (expectedSignature !== razorpay_signature) {
        throw new functions.https.HttpsError(
            "permission-denied",
            "Payment signature verification failed."
        );
    }

    const uid = context.auth.uid;
    const now = Date.now();
    const expiresAt = now + PREMIUM_DAYS * 24 * 60 * 60 * 1000;
    const premiumPayload = {
        user_id: uid,
        status: "active",
        plan: "premium",
        planActivatedAt: now,
        planExpiresAt: expiresAt,
        expiry_date: new Date(expiresAt).toISOString(),
        paymentId: razorpay_payment_id,
        orderId: razorpay_order_id,
        updatedAt: admin.database.ServerValue.TIMESTAMP,
        features: {
            faceGestureAnalysis: true,
            mentalHealthScoring: true,
            heartRateEstimation: true,
            healthReports: true
        }
    };

    await Promise.all([
        db.collection("users").doc(uid).set({
            plan: "premium",
            subscriptionStatus: "active",
            planActivatedAt: now,
            planExpiresAt: expiresAt,
            paymentId: razorpay_payment_id,
            features: premiumPayload.features
        }, { merge: true }),
        db.collection("payment_orders").doc(razorpay_order_id).set({
            uid,
            status: "paid",
            paymentId: razorpay_payment_id,
            verifiedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true }),
        admin.database().ref(`subscriptions/${uid}`).set(premiumPayload)
    ]);

    return {
        status: "active",
        plan: "premium",
        planExpiresAt: expiresAt
    };
});
