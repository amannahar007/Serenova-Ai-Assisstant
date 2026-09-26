const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const ChatSession = require('../models/ChatSession');
const Cache = require('../models/Cache');
const Memory = require('../models/Memory');
const { analyzeEmotion } = require('../utils/emotion');
const { executeAgentWorkflow } = require('../utils/agent');

const router = express.Router();

const HISTORY_LIMIT = 50;
const MAX_INPUT_LENGTH = 50000;
const THROTTLE_DELAY = 1000;

const lastRequestTime = new Map();

// Regex pattern for conversation exit / goodbye detection
const FAREWELL_REGEX = /\b(bye|goodbye|bye\s*bye|bbye|exit|quit|close|see\s+you|cya|catch\s+you\s+later|take\s+care|signing\s+off|good\s*night)\b/i;

function isFarewell(text) {
    if (!text) return false;
    const words = text.trim().split(/\s+/);
    return words.length <= 8 && FAREWELL_REGEX.test(text);
}

function getFarewellResponse() {
    const hour = new Date().getHours();
    const options = [
        "Goodbye! It was a pleasure assisting you. Feel free to reach back out whenever you need anything. Have a wonderful day!",
        "Take care! Our conversation state has been safely saved. Whenever you need support, I'll be right here.",
        "Signing off for now! Stay productive and have a great time ahead."
    ];
    if (hour >= 21 || hour < 5) {
        options.push("Goodnight! Wishing you restful sleep and a great day tomorrow. Take care!");
    }
    return options[Math.floor(Math.random() * options.length)];
}

function getWelcomeGreeting(name = "") {
    const hour = new Date().getHours();
    const nameStr = name ? ` ${name}` : "";
    let timeGreeting = "Hello";
    if (hour >= 5 && hour < 12) timeGreeting = "Good morning";
    else if (hour >= 12 && hour < 17) timeGreeting = "Good afternoon";
    else if (hour >= 17 && hour < 22) timeGreeting = "Good evening";

    const options = [
        `${timeGreeting}${nameStr}! I'm SERENOVA, your personal AI assistant. How can I help you today?`,
        `${timeGreeting}${nameStr}! SERENOVA is online and ready. What are we working on right now?`,
        `${timeGreeting}${nameStr}! Welcome back. What can I assist you with today?`
    ];
    return options[Math.floor(Math.random() * options.length)];
}

function getFallbackResponse(errorDetail = "") {
    const err = String(errorDetail).toLowerCase();
    if (err.includes("429") || err.includes("busy") || err.includes("quota")) {
        return "I am receiving a high volume of requests right now. Your conversation context is safely preserved—please wait a few seconds and try again.";
    }
    if (err.includes("timeout") || err.includes("timed out")) {
        return "The request timed out while contacting the neural engine. Please try asking your query again.";
    }
    return "I encountered a brief connection delay while generating a response. Your conversation history is preserved—please try sending your message again in a moment.";
}

// Helper: Call Ollama (Offline Mode)
async function callOllama(messages, retries = 2) {
    const url = process.env.OLLAMA_URL || 'http://localhost:11434/api/chat';
    const model = process.env.OLLAMA_MODEL || 'gemma:2b';
    
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            const response = await axios.post(url, {
                model: model,
                messages: messages,
                stream: false
            }, { timeout: 120000 });
            
            const content = response.data?.message?.content?.trim();
            if (content) return content;
            return getFallbackResponse("Empty response from Ollama");
        } catch (error) {
            console.error(`Ollama Error (Attempt ${attempt+1}):`, error.message);
            if (attempt === retries - 1) return getFallbackResponse(error.message);
            await new Promise(r => setTimeout(r, 1000));
        }
    }
}

// Helper: Call Gemini API with proper multi-turn role alternation
async function callGemini(messages) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return getFallbackResponse("GEMINI_API_KEY is not defined in the environment.");
    }
    
    const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    
    let systemPrompt = "";
    const rawContents = [];
    
    for (const msg of messages) {
        if (!msg || !msg.content) continue;
        if (msg.role === 'system') {
            systemPrompt = msg.content;
        } else {
            const role = (msg.role === 'assistant' || msg.role === 'model') ? 'model' : 'user';
            const text = String(msg.content).trim();
            if (!text) continue;

            // Ensure role alternation (merge consecutive turns of same role)
            if (rawContents.length > 0 && rawContents[rawContents.length - 1].role === role) {
                rawContents[rawContents.length - 1].parts[0].text += `\n\n${text}`;
            } else {
                rawContents.push({
                    role: role,
                    parts: [{ text: text }]
                });
            }
        }
    }

    // Ensure contents starts with 'user'
    while (rawContents.length > 0 && rawContents[0].role !== 'user') {
        rawContents.shift();
    }
    
    if (rawContents.length === 0) {
        return getFallbackResponse("No valid input turns provided.");
    }

    const payload = {
        contents: rawContents,
        generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 8192
        }
    };
    
    if (systemPrompt) {
        payload.systemInstruction = {
            parts: [{ text: systemPrompt }]
        };
    }
    
    try {
        const response = await axios.post(url, payload, { timeout: 45000 });
        if (response.status === 200 && response.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
            const output = response.data.candidates[0].content.parts[0].text.trim();
            if (output) return output;
        }
        return getFallbackResponse("Unexpected or empty response from Gemini");
    } catch (error) {
        console.error("Gemini API Error:", error.message);
        return getFallbackResponse(error.message);
    }
}

// Helper: Call Online LLM (Online Mode)
async function callOnlineLLM(messages) {
    if (process.env.GEMINI_API_KEY) {
        console.log("Using Gemini API for Online Mode");
        return await callGemini(messages);
    }
    console.log("Using Online Mode (Simulated Fallback to Ollama)");
    return await callOllama(messages); 
}

// Helper: Smart Memory Retrieval
async function retrieveMemories(message) {
    try {
        const words = message.toLowerCase().split(' ').filter(w => w.length > 3);
        if (words.length === 0) return "";
        
        const memories = await Memory.find({
            $or: words.map(w => ({ key: new RegExp(w, 'i') }))
        }).limit(3);
        
        if (memories.length > 0) {
            return memories.map(m => `(Remembered: ${m.value})`).join(' ');
        }
    } catch (err) {
        console.warn("Memory retrieval failed:", err.message);
    }
    return "";
}

// Helper: Smart Memory Storage
async function storeImportantFacts(message, response) {
    try {
        const patterns = [
            { regex: /my name is (.*)/i, category: 'fact' },
            { regex: /i like (.*)/i, category: 'preference' },
            { regex: /i live in (.*)/i, category: 'fact' }
        ];

        for (const p of patterns) {
            const match = message.match(p.regex);
            if (match) {
                const val = match[1].trim();
                await Memory.findOneAndUpdate(
                    { key: match[0].toLowerCase() },
                    { value: val, category: p.category, importance: 7 },
                    { upsert: true }
                );
            }
        }
    } catch (err) {
        console.warn("Memory storage error:", err.message);
    }
}

// Helper: Core Chat Logic
async function chatWithSERENOVA(message, sessionId, options = {}) {
    const { mode = 'offline', isAgent = false } = options;
    
    if (!sessionId) sessionId = crypto.randomUUID();
    
    // 1. Emotion Analysis
    const emotionData = analyzeEmotion(message);

    // 2. Check Conversation-Ending Intent
    if (isFarewell(message)) {
        const farewell = getFarewellResponse();
        try {
            let session = await ChatSession.findOne({ sessionId });
            if (!session) session = new ChatSession({ sessionId, messages: [] });
            session.messages.push({ role: "user", content: message });
            session.messages.push({ role: "assistant", content: farewell });
            await session.save();
        } catch (dbErr) {
            console.warn("Could not persist farewell to DB:", dbErr.message);
        }
        return { sessionId, response: farewell, emotion: emotionData, state: "concluded" };
    }
    
    // 3. Memory Retrieval
    const contextMemory = await retrieveMemories(message);
    
    // 4. Agent Workflow (if enabled)
    if (isAgent) {
        const llmCaller = (msgs) => (mode === 'online' ? callOnlineLLM(msgs) : callOllama(msgs));
        const agentResult = await executeAgentWorkflow(message, sessionId, llmCaller);
        return { 
            sessionId, 
            response: agentResult.finalResult, 
            emotion: emotionData, 
            agentLogs: agentResult.steps,
            state: "active"
        };
    }

    // 5. Standard LLM Call with Session History
    let session = null;
    try {
        session = await ChatSession.findOne({ sessionId });
    } catch (err) {
        console.warn("DB session lookup error:", err.message);
    }
    if (!session) session = new ChatSession({ sessionId, messages: [] });
    
    // Dynamic System Prompt based on Emotion & SERENOVA v2.0 Quantum Edition
    let systemContent = "You are SERENOVA (v2.0 Quantum Edition), an advanced, autonomous personal assistant and Universal Knowledge & Health AI. Lead directly with the answer in sentence 1 without filler phrases. Maintain multi-turn conversational context seamlessly. Use clean markdown formatting with bullet points and bold headers.";
    if (emotionData.emotion === 'sad') systemContent += " Detected tonality: Sad. Be supportive, calm, and empathetic.";
    if (emotionData.emotion === 'angry') systemContent += " Detected tonality: Frustrated. Be precise, calm, professional, and directly helpful.";
    if (emotionData.emotion === 'ecstatic' || emotionData.emotion === 'happy') systemContent += " Detected tonality: Positive. Be encouraging and proactive.";

    const systemPrompt = { role: "system", content: systemContent };
    const historyMessages = (session.messages || []).map(msg => ({ role: msg.role, content: msg.content }));
    const llmMessages = [
        systemPrompt, 
        ...historyMessages, 
        { role: "user", content: contextMemory ? `${contextMemory} ${message}` : message }
    ];
    
    const response = mode === 'online' ? await callOnlineLLM(llmMessages) : await callOllama(llmMessages);
    
    try {
        session.messages.push({ role: "user", content: message });
        session.messages.push({ role: "assistant", content: response });
        if (session.messages.length > HISTORY_LIMIT * 2) {
            session.messages = session.messages.slice(-(HISTORY_LIMIT * 2));
        }
        await session.save();
        await storeImportantFacts(message, response);
    } catch (saveErr) {
        console.warn("Session save warning:", saveErr.message);
    }
    
    return { sessionId, response, emotion: emotionData, state: "active" };
}

// POST /welcome Endpoint
router.post('/welcome', async (req, res) => {
    try {
        const { session_id, name } = req.body || {};
        const sid = session_id || crypto.randomUUID();
        const greeting = getWelcomeGreeting(name);
        res.json({ sessionId: sid, greeting, state: "active" });
    } catch (err) {
        console.error("Welcome endpoint error:", err);
        res.json({ sessionId: crypto.randomUUID(), greeting: "Hello! I'm SERENOVA. How can I help you today?", state: "active" });
    }
});

// POST /chat Endpoint
router.post('/chat', async (req, res) => {
    try {
        const { message, session_id, history, memory, preferred_language, mode, isAgent } = req.body;
        const userInput = message ? message.trim() : "";
        
        if (!userInput) return res.status(400).json({ detail: "Message cannot be empty" });
        if (userInput.length > MAX_INPUT_LENGTH) return res.status(400).json({ detail: "Input too long." });
        
        const userIp = req.ip;
        const currentTime = Date.now();
        if (lastRequestTime.has(userIp) && (currentTime - lastRequestTime.get(userIp) < THROTTLE_DELAY)) {
            return res.status(429).json({ detail: "Too fast!" });
        }
        lastRequestTime.set(userIp, currentTime);
        
        const sessionId = session_id || `session_${userIp.replace(/[^a-zA-Z0-9]/g, '_')}`;

        // Attempt proxying to Python FastAPI backend (which has full 8K+ continuation & multi-turn memory)
        const pythonBackendUrl = process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8000';
        try {
            const pyRes = await axios.post(`${pythonBackendUrl}/chat`, {
                message: userInput,
                session_id: sessionId,
                history: Array.isArray(history) ? history : [],
                memory: memory || {},
                preferred_language: preferred_language || 'auto',
                stream: false
            }, {
                headers: { 'Content-Type': 'application/json', 'Authorization': req.headers.authorization || 'Bearer dev_local_token' },
                timeout: 90000
            });
            if (pyRes.status === 200 && pyRes.data) {
                return res.json(pyRes.data);
            }
        } catch (pyErr) {
            console.warn(`[backend-node] Python backend proxy failed (${pyErr.message}), using internal engine...`);
        }

        const result = await chatWithSERENOVA(userInput, sessionId, { mode: 'online', isAgent });
        res.json(result);
    } catch (err) {
        console.error("Chat router caught error:", err);
        const fallback = getFallbackResponse(err.message);
        res.json({ sessionId: req.body?.session_id || crypto.randomUUID(), response: fallback, state: "active" });
    }
});

module.exports = { router, chatWithSERENOVA, getWelcomeGreeting, getFarewellResponse };
