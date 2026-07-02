let admin;
try {
    admin = require('firebase-admin');
} catch (e) {
    console.warn("⚠️ firebase-admin is not installed. Run 'npm install firebase-admin' to enable JWT Security.");
}

// Note: For production, you must download your Service Account JSON from the Firebase Console
// and initialize it here. If deployed on Google Cloud/Firebase, initializeApp() works automatically.
try {
    admin.initializeApp();
    console.log("Firebase Admin Initialized successfully.");
} catch (error) {
    console.warn("⚠️ Firebase Admin could not initialize. Provide service account credentials in production.", error.message);
}

const verifyFirebaseToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: Missing or invalid Authorization header' });
    }
    
    const idToken = authHeader.split('Bearer ')[1];
    
    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        req.user = decodedToken; // Attach verified user payload to the request
        next();
    } catch (error) {
        console.error("🛡️ Firebase Token Verification Error:", error.message);
        return res.status(401).json({ error: 'Unauthorized: Invalid or expired Firebase Token' });
    }
};

module.exports = { verifyFirebaseToken };
