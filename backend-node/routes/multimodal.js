const express = require('express');
const multer = require('multer');
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const { chatWithSERENOVA } = require('./chat');

const router = express.Router();
const upload = multer({ dest: 'temp_uploads/' });

const PYTHON_BACKEND_URL = process.env.PYTHON_BACKEND_URL || 'http://localhost:8000';

// Helper to extract Auth Token
const extractToken = (req) => req.headers.authorization || '';

// POST /upload (Proxy to Python RAG upload)
router.post('/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ detail: "No file uploaded" });
        }
        
        const form = new FormData();
        form.append('file', fs.createReadStream(req.file.path));

        const response = await axios.post(`${PYTHON_BACKEND_URL}/upload`, form, {
            headers: {
                ...form.getHeaders(),
                'Authorization': extractToken(req)
            }
        });
        
        fs.unlinkSync(req.file.path); // clean up local temp file
        res.json(response.data);
    } catch (err) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(err.response?.status || 500).json({ detail: err.response?.data?.detail || err.message });
    }
});

// POST /chat-rag (Proxy to Python RAG chat)
router.post('/chat-rag', async (req, res) => {
    try {
        const { message, session_id, history } = req.body;
        
        const response = await axios.post(`${PYTHON_BACKEND_URL}/chat-rag`, {
            message,
            session_id,
            history
        }, {
            headers: { 'Authorization': extractToken(req) }
        });
        
        res.json(response.data);
    } catch (err) {
        res.status(err.response?.status || 500).json({ detail: err.response?.data?.detail || err.message });
    }
});

// POST /speech-to-speech
router.post('/speech-to-speech', upload.single('audio'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ detail: "No audio file uploaded" });
        }
        
        const form = new FormData();
        form.append('audio', fs.createReadStream(req.file.path));
        if (req.body.session_id) {
            form.append('session_id', req.body.session_id);
        }

        const response = await axios.post(`${PYTHON_BACKEND_URL}/speech-to-speech`, form, {
            headers: {
                ...form.getHeaders(),
                'Authorization': extractToken(req)
            },
            responseType: 'stream'
        });
        
        fs.unlinkSync(req.file.path); // clean up local temp file
        
        // Pass headers forward
        if (response.headers['x-transcript']) res.set('X-Transcript', response.headers['x-transcript']);
        if (response.headers['x-ai-response']) res.set('X-AI-Response', response.headers['x-ai-response']);
        if (response.headers['content-type']) res.set('Content-Type', response.headers['content-type']);
        
        response.data.pipe(res);
        
    } catch (err) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(err.response?.status || 500).json({ detail: err.response?.data?.detail || err.message });
    }
});

// POST /gesture-chat
router.post('/gesture-chat', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ detail: "No image file uploaded" });
        }
        
        const form = new FormData();
        form.append('image', fs.createReadStream(req.file.path));
        if (req.body.session_id) {
            form.append('session_id', req.body.session_id);
        }

        const response = await axios.post(`${PYTHON_BACKEND_URL}/gesture-chat`, form, {
            headers: {
                ...form.getHeaders(),
                'Authorization': extractToken(req)
            }
        });
        
        fs.unlinkSync(req.file.path); // clean up local temp file
        res.json(response.data);
    } catch (err) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(err.response?.status || 500).json({ detail: err.response?.data?.detail || err.message });
    }
});

module.exports = router;
