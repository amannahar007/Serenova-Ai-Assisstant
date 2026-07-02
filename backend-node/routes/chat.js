const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const ChatSession = require('../models/ChatSession');
const Cache = require('../models/Cache');
const Memory = require('../models/Memory');
const { analyzeEmotion } = require('../utils/emotion');
const { executeAgentWorkflow } = require('../utils/agent');

const router = express.Router();

const HISTORY_LIMIT = 5; 
const MAX_INPUT_LENGTH = 2000;
const THROTTLE_DELAY = 1000;

const lastRequestTime = new Map();

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
            
            return response.data.message.content.trim();
        } catch (error) {
            console.error(`Ollama Error (Attempt ${attempt+1}):`, error.message);
            if (attempt === retries - 1) return `Error: Failed to connect to Ollama. Details: ${error.message}`;
            await new Promise(r => setTimeout(r, 1000));
        }
    }
}

// Helper: Call Gemini API
async function callGemini(messages) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return "Error: GEMINI_API_KEY is not defined in the environment.";
    }
    
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    
    let systemPrompt = "";
    const contents = [];
    
    for (const msg of messages) {
        if (msg.role === 'system') {
            systemPrompt = msg.content;
        } else {
            const role = msg.role === 'user' ? 'user' : 'model';
            contents.push({
                role: role,
                parts: [{ text: msg.content }]
            });
        }
    }
    
    const payload = {
        contents: contents
    };
    
    if (systemPrompt) {
        payload.systemInstruction = {
            parts: [{ text: systemPrompt }]
        };
    }
    
    try {
        const response = await axios.post(url, payload);
        if (response.status === 200 && response.data.candidates && response.data.candidates[0]) {
            return response.data.candidates[0].content.parts[0].text.trim();
        } else {
            return `Error: Unexpected response format from Gemini API.`;
        }
    } catch (error) {
        console.error("Gemini API Error:", error.message);
        return `Error: Failed to connect to Gemini API. Details: ${error.message}`;
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
    // Basic keyword match for now
    const words = message.toLowerCase().split(' ').filter(w => w.length > 3);
    if (words.length === 0) return "";
    
    const memories = await Memory.find({
        $or: words.map(w => ({ key: new RegExp(w, 'i') }))
    }).limit(3);
    
    if (memories.length > 0) {
        return memories.map(m => `(Remembered: ${m.value})`).join(' ');
    }
    return "";
}

// Helper: Smart Memory Storage
async function storeImportantFacts(message, response) {
    // Simple logic: if user says "my name is...", "i like...", etc.
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
}

// Helper: Core Chat Logic
async function chatWithSERENOVA(message, sessionId, options = {}) {
    const { mode = 'offline', isAgent = false } = options;
    
    if (!sessionId) sessionId = crypto.randomUUID();
    
    // 1. Emotion Analysis
    const emotionData = analyzeEmotion(message);
    
    // 2. Memory Retrieval
    const contextMemory = await retrieveMemories(message);
    
    // 3. Agent Workflow (if enabled)
    if (isAgent) {
        const llmCaller = (msgs) => (mode === 'online' ? callOnlineLLM(msgs) : callOllama(msgs));
        const agentResult = await executeAgentWorkflow(message, sessionId, llmCaller);
        return { 
            sessionId, 
            response: agentResult.finalResult, 
            emotion: emotionData, 
            agentLogs: agentResult.steps 
        };
    }

    // 4. Standard LLM Call
    let session = await ChatSession.findOne({ sessionId });
    if (!session) session = new ChatSession({ sessionId, messages: [] });
    
    // Dynamic System Prompt based on Emotion
    let systemContent = "You are SERENOVA, a friendly AI Assistant.";
    if (emotionData.emotion === 'sad') systemContent += " The user seems sad, be extra supportive and empathetic.";
    if (emotionData.emotion === 'angry') systemContent += " The user seems frustrated, be calm, professional and helpful.";
    if (emotionData.emotion === 'ecstatic') systemContent += " The user is very happy, be energetic and celebratory!";

    const systemPrompt = { role: "system", content: systemContent };
    const historyMessages = session.messages.map(msg => ({ role: msg.role, content: msg.content }));
    const llmMessages = [
        systemPrompt, 
        ...historyMessages, 
        { role: "user", content: `${contextMemory} ${message}` }
    ];
    
    const response = mode === 'online' ? await callOnlineLLM(llmMessages) : await callOllama(llmMessages);
    
    if (!response.startsWith("Error:")) {
        session.messages.push({ role: "user", content: message });
        session.messages.push({ role: "assistant", content: response });
        if (session.messages.length > HISTORY_LIMIT * 2) session.messages = session.messages.slice(-(HISTORY_LIMIT * 2));
        await session.save();
        
        // 5. Memory Storage
        await storeImportantFacts(message, response);
    }
    
    return { sessionId, response, emotion: emotionData };
}

// POST /chat Endpoint
router.post('/chat', async (req, res) => {
    try {
        const { message, session_id, mode, isAgent } = req.body;
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
        const result = await chatWithSERENOVA(userInput, sessionId, { mode, isAgent });
        
        if (result.response.startsWith("Error:")) return res.status(503).json({ detail: result.response });
        
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).json({ detail: "Internal Server Error" });
    }
} );

module.exports = { router, chatWithSERENOVA };
