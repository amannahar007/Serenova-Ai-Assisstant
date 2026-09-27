require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// Routes
const { router: chatRouter } = require('./routes/chat');
const multimodalRouter = require('./routes/multimodal');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/SERENOVA';

// â”€â”€â”€ DB state flag â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let isDbReady = false;

// Custom NoSQL Injection Sanitizer
const mongoSanitize = (req, res, next) => {
    const sanitize = (obj) => {
        if (obj instanceof Object) {
            for (let key in obj) {
                if (/^\$/.test(key)) {
                    delete obj[key];
                } else {
                    sanitize(obj[key]);
                }
            }
        }
    };
    sanitize(req.body);
    sanitize(req.query);
    sanitize(req.params);
    next();
};

// Middleware
app.use(helmet({
    crossOriginResourcePolicy: false,
}));
app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps, curl, or server-to-server)
        if (!origin) return callback(null, true);
        if (
            origin.includes('localhost') ||
            origin.includes('127.0.0.1') ||
            origin.endsWith('.vercel.app') ||
            origin.endsWith('.web.app') ||
            origin.endsWith('.firebaseapp.com') ||
            (process.env.FRONTEND_URL && origin === process.env.FRONTEND_URL)
        ) {
            return callback(null, true);
        }
        return callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));
app.use(express.json());
app.use(mongoSanitize);

// Global Rate Limiting (100 requests per minute per IP)
const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    message: { detail: "Too many requests from this IP, please try again after a minute" },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api', limiter);

// DB-readiness logging (allows stateless chat & fallback to proceed without 503 blocking)
app.use(['/api', '/'], (req, res, next) => {
    if (req.path === '/health' || req.path === '/api/health') return next();
    if (!isDbReady) {
        console.warn(`[API] Request received while DB is connecting: ${req.method} ${req.path}`);
    }
    next();
});

// Health check endpoint
app.get(['/api/health', '/health'], (req, res) => {
    res.json({ status: isDbReady ? 'ok' : 'connected_memory_fallback', db: isDbReady });
});

// Mount Routes under both /api and root / (prevents 404 whether caller uses /api/chat or /chat)
app.use('/api', chatRouter);
app.use('/api', multimodalRouter);
app.use('/', chatRouter);
app.use('/', multimodalRouter);

// Root Route
app.get('/', (req, res) => {
    res.json({ message: "Welcome to SERENOVA API (Node.js & MongoDB version)." });
});

// â”€â”€â”€ Start HTTP server IMMEDIATELY (before DB connects) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// This prevents the frontend from getting ECONNREFUSED even during startup.
app.listen(PORT, () => {
    console.log(`SERENOVA backend listening on http://localhost:${PORT}`);
    console.log('Connecting to MongoDB...');
});

// â”€â”€â”€ Resilient MongoDB connection with infinite retry â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const MAX_BACKOFF_MS = 30000; // cap at 30 s between retries

async function connectWithRetry(attempt = 1) {
    try {
        await mongoose.connect(MONGO_URI, {
            serverSelectionTimeoutMS: 5000, // fail fast per attempt
        });
        isDbReady = true;
        console.log('âœ… Connected to MongoDB successfully.');
    } catch (err) {
        const waitMs = Math.min(1000 * Math.pow(2, attempt - 1), MAX_BACKOFF_MS);
        console.warn(`âš ï¸  MongoDB not ready (attempt ${attempt}): ${err.message}`);
        console.warn(`   Retrying in ${waitMs / 1000}s...`);
        setTimeout(() => connectWithRetry(attempt + 1), waitMs);
    }
}

// Handle DB disconnects after initial connect (e.g., MongoDB service restart)
mongoose.connection.on('disconnected', () => {
    if (isDbReady) {
        isDbReady = false;
        console.warn('âš ï¸  MongoDB disconnected. Attempting to reconnect...');
        connectWithRetry();
    }
});

connectWithRetry();
