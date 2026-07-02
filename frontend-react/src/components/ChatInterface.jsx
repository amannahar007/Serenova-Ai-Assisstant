import { useState, useRef, useEffect, useCallback, memo } from 'react';
import { rtdb } from '../firebase';
import { ref, push, set, onValue, query, orderByChild, serverTimestamp } from 'firebase/database';
import { Send, Paperclip, Mic, Camera, Plus, MessageSquare, Square, Copy, Check, RefreshCw, Languages, Volume2, VolumeX } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

const languageOptions = [
  { code: 'auto', label: 'Auto', speechLang: 'hi-IN', voiceHint: '' },
  { code: 'hi-IN', label: 'Hindi', speechLang: 'hi-IN', voiceHint: 'hi' },
  { code: 'bn-IN', label: 'Bengali', speechLang: 'bn-IN', voiceHint: 'bn' },
  { code: 'ta-IN', label: 'Tamil', speechLang: 'ta-IN', voiceHint: 'ta' },
  { code: 'te-IN', label: 'Telugu', speechLang: 'te-IN', voiceHint: 'te' },
  { code: 'mr-IN', label: 'Marathi', speechLang: 'mr-IN', voiceHint: 'mr' },
  { code: 'en-IN', label: 'English', speechLang: 'en-IN', voiceHint: 'en' }
];

const uiTextByLanguage = {
  'hi-IN': {
    title: 'Chat',
    subtitle: 'Voice, memory, and regional language support',
    empty: 'Abhi koi message nahi. Baat shuru kijiye.',
    placeholder: 'Message likhiye ya mic dabaiye...',
    listening: 'Listening...',
    memory: 'Memory on'
  },
  'en-IN': {
    title: 'Chat',
    subtitle: 'Voice, memory, and regional language support',
    empty: 'No messages yet. Start the conversation!',
    placeholder: 'Type or tap mic to speak...',
    listening: 'Listening...',
    memory: 'Memory on'
  }
};

function getLanguageOption(code) {
  return languageOptions.find((option) => option.code === code) || languageOptions[0];
}

function detectMood(text) {
  const lower = text.toLowerCase();
  if (/(stress|stressed|anxiety|anxious|tension|panic|pressure)/.test(lower)) return 'stressed';
  if (/(sad|depressed|down|lonely|hopeless)/.test(lower)) return 'sad';
  if (/(happy|good|great|better|excited)/.test(lower)) return 'positive';
  if (/(sleepy|tired|fatigue|exhausted)/.test(lower)) return 'tired';
  return null;
}

function inferMemoryFromMessage(text, currentMemory, preferredLanguage) {
  const lower = text.toLowerCase();
  const nextMemory = {
    ...(currentMemory || {}),
    preferred_language: preferredLanguage,
    conversation_summary: text.slice(0, 180),
    updatedAt: Date.now()
  };

  const nameMatch = text.match(/\b(?:my name is|i am|i'm|mera naam|main)\s+([A-Za-z][A-Za-z ]{1,40})/i);
  if (nameMatch?.[1]) {
    nextMemory.name = nameMatch[1].trim().replace(/[.,!?].*$/, '');
  }

  const ageMatch = lower.match(/\b(?:i am|i'm|age is|umar|age)\s+(\d{1,3})\b/);
  if (ageMatch?.[1]) {
    nextMemory.age = Number(ageMatch[1]);
  }

  const conditionKeywords = ['anxiety', 'stress', 'poor sleep', 'insomnia', 'diabetes', 'bp', 'blood pressure', 'headache'];
  const rememberedConditions = new Set(nextMemory.health_conditions || []);
  conditionKeywords.forEach((condition) => {
    if (lower.includes(condition)) rememberedConditions.add(condition);
  });
  nextMemory.health_conditions = Array.from(rememberedConditions).slice(0, 8);

  const rememberedGoals = new Set(nextMemory.goals || []);
  if (/(sleep|insomnia|rest)/.test(lower)) rememberedGoals.add('better sleep');
  if (/(stress|anxiety|tension|calm)/.test(lower)) rememberedGoals.add('reduce stress');
  if (/(fitness|weight|exercise|walk)/.test(lower)) rememberedGoals.add('improve fitness');
  nextMemory.goals = Array.from(rememberedGoals).slice(0, 8);

  const mood = detectMood(text);
  if (mood) nextMemory.last_mood = mood;

  return nextMemory;
}

const MarkdownMessage = ({ content }) => {
  return (
    <div className="prose prose-sm max-w-none dark:prose-invert prose-p:leading-relaxed prose-pre:p-0 prose-pre:bg-transparent prose-pre:m-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
        code({node, inline, className, children, ...props}) {
          const match = /language-(\w+)/.exec(className || '')
          return !inline && match ? (
            <div className="rounded-md overflow-hidden my-2 border border-glass-border shadow-sm">
              <div className="bg-[#1e1e1e] px-4 py-1 text-xs text-slate-400 font-mono border-b border-gray-700/50 flex justify-between">
                <span>{match[1]}</span>
              </div>
              <SyntaxHighlighter
                style={vscDarkPlus}
                language={match[1]}
                PreTag="div"
                customStyle={{ margin: 0, padding: '1rem', background: '#1e1e1e' }}
                {...props}
              >
                {String(children).replace(/\n$/, '')}
              </SyntaxHighlighter>
            </div>
          ) : (
            <code className="bg-black/5 px-1.5 py-0.5 rounded-md font-mono text-[13px] text-neon-cyan border border-glass-border" {...props}>
              {children}
            </code>
          )
        },
        table({children}) {
          return <div className="overflow-x-auto my-4"><table className="min-w-full divide-y divide-glass-border border border-glass-border rounded-lg">{children}</table></div>
        },
        th({children}) {
          return <th className="px-4 py-2 bg-black/5 text-left text-xs font-semibold uppercase tracking-wider">{children}</th>
        },
        td({children}) {
          return <td className="px-4 py-2 whitespace-nowrap text-sm border-t border-glass-border">{children}</td>
        }
      }}
    >
      {content}
    </ReactMarkdown>
    </div>
  );
};

const MessageBubble = memo(({ msg, isLast, onCopy, onRegenerate, isCopied, isRegeneratingDisabled }) => {
  if (!msg) return null;
  const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content) || "";
  
  return (
    <div className={`flex gap-4 max-w-[80%] ${msg.role === 'user' ? 'self-end flex-row-reverse' : ''} animate-[slideIn_0.3s_ease-out]`}>
      <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm shrink-0 border border-glass-border font-serif ${msg.role === 'user' ? 'bg-neon-cyan text-white border-none' : 'bg-slate text-text-dim'}`}>
        {msg.role === 'user' ? 'U' : 'D'}
      </div>
      <div className="flex flex-col gap-1 w-full">
        <div className={`p-4 rounded-2xl text-[15px] leading-relaxed shadow-sm ${msg.role === 'user' ? 'bg-slate border border-glass-border rounded-tr-sm whitespace-pre-wrap' : 'bg-white border border-glass-border rounded-tl-sm w-full overflow-hidden'}`}>
          {msg.role === 'user' ? content : <MarkdownMessage content={content} />}
        </div>
        {msg.role === 'assistant' && (
          <div className="flex items-center gap-2 mt-1 ml-2">
            <button onClick={() => onCopy(msg.content, msg.id)} className="text-text-muted hover:text-text-primary transition-colors p-1 rounded-md hover:bg-slate">
              {isCopied ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
            </button>
            {isLast && (
              <button onClick={onRegenerate} disabled={isRegeneratingDisabled} className="text-text-muted hover:text-text-primary transition-colors p-1 rounded-md hover:bg-slate disabled:opacity-50">
                <RefreshCw size={14} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

export default function ChatInterface({ user, isPro }) {
  console.log("[ChatInterface] Render triggered");
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [hasLoadedInitialSessions, setHasLoadedInitialSessions] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [memory, setMemory] = useState({});
  const [preferredLanguage, setPreferredLanguage] = useState('auto');
  const [isListening, setIsListening] = useState(false);
  const [voiceOutputEnabled, setVoiceOutputEnabled] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);

  const handleCopy = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Chat Session Management
  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(() => uuidv4());
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const scrollRef = useRef(null);
  const abortControllerRef = useRef(null);
  const recognitionRef = useRef(null);
  const preferredLanguageRef = useRef(preferredLanguage);
  const memoryRef = useRef(memory);

  useEffect(() => {
    preferredLanguageRef.current = preferredLanguage;
  }, [preferredLanguage]);

  useEffect(() => {
    memoryRef.current = memory;
  }, [memory]);

  useEffect(() => {
    if (!user?.uid) return;
    const unsub = onValue(ref(rtdb, `users/${user.uid}/memory`), (snapshot) => {
      const savedMemory = snapshot.val() || {};
      setMemory(savedMemory);
      if (savedMemory.preferred_language) {
        setPreferredLanguage(savedMemory.preferred_language);
      }
    });
    return () => unsub();
  }, [user?.uid]);

  const handleStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  };

  // Load chat sessions
  useEffect(() => {
    if (!user || !user.uid) return;
    console.log("[ChatInterface] Setting up RTDB sessions listener...");
    const chatsRef = query(ref(rtdb, `users/${user.uid}/chats`), orderByChild('updatedAt'));
    const unsub = onValue(chatsRef, (snapshot) => {
      console.log("[ChatInterface] Received sessions snapshot");
      if (snapshot.exists()) {
        const data = snapshot.val();
        const s = Object.entries(data)
          .map(([id, val]) => ({ id, ...val }))
          .sort((a, b) => {
            const timeA = typeof a.updatedAt === 'number' ? a.updatedAt : 0;
            const timeB = typeof b.updatedAt === 'number' ? b.updatedAt : 0;
            return timeB - timeA;
          });
        
        setSessions(s);
        if (!hasLoadedInitialSessions) {
          setHasLoadedInitialSessions(true);
          if (s.length > 0) {
            setCurrentSessionId(s[0].id);
          }
        }
      } else {
        setSessions([]);
        setHasLoadedInitialSessions(true);
      }
    }, (error) => {
      console.error("[ChatInterface] RTDB sessions error:", error);
    });
    return () => unsub();
  }, [user, hasLoadedInitialSessions]);

  // Load messages for current session
  useEffect(() => {
    if (!user || !user.uid || !currentSessionId) return;
    console.log(`[ChatInterface] Setting up RTDB messages listener for session ${currentSessionId}...`);
    const msgsRef = query(ref(rtdb, `users/${user.uid}/chats/${currentSessionId}/messages`), orderByChild('timestamp'));
    const unsub = onValue(msgsRef, (snapshot) => {
      console.log(`[ChatInterface] Received messages snapshot for session ${currentSessionId}`);
      if (snapshot.exists()) {
        const data = snapshot.val();
        const msgs = Object.entries(data)
          .map(([id, val]) => ({ id: String(id), ...val }))
          .sort((a, b) => {
            const timeA = typeof a.timestamp === 'number' ? a.timestamp : (a.timestamp instanceof Date ? a.timestamp.getTime() : 0);
            const timeB = typeof b.timestamp === 'number' ? b.timestamp : (b.timestamp instanceof Date ? b.timestamp.getTime() : 0);
            return timeA - timeB;
          });
        setMessages(msgs);
        setTimeout(() => scrollRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
      } else {
        setMessages([]);
      }
    }, (error) => {
      console.error("[ChatInterface] RTDB messages error:", error);
    });
    return () => unsub();
  }, [user, currentSessionId]);

  const handleNewChat = () => {
    const newId = uuidv4();
    setCurrentSessionId(newId);
    setMessages([]);
  };

  const handleRegenerate = async () => {
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    if (!lastUserMsg || loading) return;
    await sendMessage(lastUserMsg.content);
  };

  const handleSend = async (e) => {
    e.preventDefault();
    if (!input.trim() || loading) return;
    const text = input.trim();
    setInput('');
    await sendMessage(text);
  };

  const persistMemory = async (userText) => {
    if (!user?.uid) return memoryRef.current || {};
    const nextMemory = inferMemoryFromMessage(userText, memoryRef.current, preferredLanguageRef.current);
    setMemory(nextMemory);
    memoryRef.current = nextMemory;
    set(ref(rtdb, `users/${user.uid}/memory`), nextMemory).catch((err) => {
      console.warn("[ChatInterface] Memory save failed", err);
    });
    return nextMemory;
  };

  const handleLanguageChange = (nextLanguage) => {
    setPreferredLanguage(nextLanguage);
    const nextMemory = {
      ...(memoryRef.current || {}),
      preferred_language: nextLanguage,
      updatedAt: Date.now()
    };
    setMemory(nextMemory);
    memoryRef.current = nextMemory;
    if (user?.uid) {
      set(ref(rtdb, `users/${user.uid}/memory`), nextMemory).catch((err) => {
        console.warn("[ChatInterface] Language preference save failed", err);
      });
    }
  };

  const speakText = (text) => {
    if (!voiceOutputEnabled || !text || !window.speechSynthesis) return;
    const cleanText = text
      .replace(/\*\*Suggested Follow-ups:\*\*[\s\S]*/i, '')
      .replace(/[#*_`>-]/g, ' ')
      .trim();
    if (!cleanText) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(cleanText.slice(0, 900));
    const languageOption = getLanguageOption(preferredLanguageRef.current);
    utterance.lang = languageOption.speechLang;
    const matchingVoice = window.speechSynthesis
      .getVoices()
      .find((voice) => voice.lang?.toLowerCase().startsWith(languageOption.voiceHint || languageOption.speechLang.slice(0, 2)));
    if (matchingVoice) utterance.voice = matchingVoice;
    window.speechSynthesis.speak(utterance);
  };

  const sendMessage = async (userText) => {
    console.log("[ChatInterface] sendMessage initiated with length:", userText?.length);
    setLoading(true);
    setStreamingContent('');

    // 1. Optimistic Update (Show user message instantly)
    const tempUserMsgId = `temp-user-${Date.now()}`;
    const newUserMessage = {
      id: tempUserMsgId,
      role: 'user',
      content: userText,
      timestamp: new Date()
    };
    console.log("[ChatInterface] Setting optimistic UI message");
    setMessages(prev => [...prev, newUserMessage]);
    setTimeout(() => scrollRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);

    let dbEnabled = true;

    try {
      console.log("[ChatInterface] Executing RTDB session update (Async)");
      // 2. Try RTDB: Ensure session exists (Asynchronous, no await to prevent UI blocking)
      set(ref(rtdb, `users/${user.uid}/chats/${currentSessionId}`), {
        updatedAt: serverTimestamp(),
        preview: userText.substring(0, 30) + '...'
      }).catch(err => console.warn("[ChatInterface] RTDB session update failed", err));

      console.log("[ChatInterface] Executing RTDB message push (Async)");
      // 3. Try RTDB: Save user message (Asynchronous, no await)
      push(ref(rtdb, `users/${user.uid}/chats/${currentSessionId}/messages`), {
        role: 'user',
        content: userText,
        timestamp: serverTimestamp()
      }).catch(err => {
        console.warn("[ChatInterface] RTDB message save failed", err);
        dbEnabled = false;
      });
    } catch (dbErr) {
      console.error("[ChatInterface] Database error (falling back to local memory):", dbErr);
      dbEnabled = false;
    }

    let fullResponse = "";
    try {
      const nextMemory = await persistMemory(userText);
      console.log("[ChatInterface] Fetching auth token");
      // Get auth token
      const token = await user.getIdToken();
      
      console.log("[ChatInterface] Filtering history context");
      // Get history (last 10 messages)
      const history = messages
        .filter(m => m?.id && typeof m.id === 'string' && !m.id.startsWith('temp-'))
        .slice(-10)
        .map(m => ({ role: m.role || 'user', content: typeof m.content === 'string' ? m.content : "" }));

      console.log("[ChatInterface] Dispatching POST request to AI Engine");
      // 4. Fetch Response from local/remote LLM backend
      abortControllerRef.current = new AbortController();
      const backendUrl = import.meta.env.VITE_AI_BACKEND_URL || `http://${window.location.hostname}:8000`;
      const chatUrl = `${backendUrl.replace(/\/$/, '')}/chat`;
      const response = await fetch(chatUrl, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ 
          message: userText, 
          session_id: currentSessionId, 
          stream: true,
          history: history,
          memory: nextMemory,
          preferred_language: preferredLanguageRef.current
        }),
        signal: abortControllerRef.current.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      console.log("[ChatInterface] Connection established, reading stream...");
      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        
        // Keep the last element (which might be incomplete) in the buffer
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ')) {
            const data = trimmed.slice(6);
            if (data === '[DONE]') {
              console.log("[ChatInterface] Stream received [DONE] signal");
              break;
            }
            try {
              const parsed = JSON.parse(`"${data}"`);
              fullResponse += parsed;
              setStreamingContent(prev => prev + parsed);
            } catch {
              fullResponse += data;
              setStreamingContent(prev => prev + data);
            }
            scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
          }
        }
      }

      console.log("[ChatInterface] Stream complete. Async saving AI response to RTDB...");
      // 5. Try to save complete AI response to RTDB (Asynchronous, no await)
      if (dbEnabled) {
        push(ref(rtdb, `users/${user.uid}/chats/${currentSessionId}/messages`), {
          role: 'assistant',
          content: fullResponse || "Error processing request.",
          timestamp: serverTimestamp()
        }).catch(dbErr => {
          console.error("[ChatInterface] Failed to save AI response to RTDB:", dbErr);
        });
      }

      // If database is disabled, update the local messages state directly
      if (!dbEnabled) {
        console.log("[ChatInterface] DB disabled. Saving AI response locally");
        const newAiMessage = {
          id: `temp-ai-${Date.now()}`,
          role: 'assistant',
          content: fullResponse || "Error: No response generated by the assistant.",
          timestamp: new Date()
        };
        // Remove duplicate temp user message if it's there, then append
        setMessages(prev => {
          const filtered = prev.filter(m => m.id !== tempUserMsgId);
          return [...filtered, { ...newUserMessage, id: `local-user-${Date.now()}` }, newAiMessage];
        });
      }

      speakText(fullResponse);

    } catch (err) {
      if (err.name === 'AbortError') {
        console.log('[ChatInterface] Stream aborted by user');
        if (dbEnabled && fullResponse) {
           push(ref(rtdb, `users/${user.uid}/chats/${currentSessionId}/messages`), {
             role: 'assistant',
             content: fullResponse + "\n\n*[Generation stopped by user]*",
             timestamp: serverTimestamp()
           }).catch(e => console.error(e));
        }
        return;
      }
      console.error("[ChatInterface] Chat error caught:", err);
      const errorContent = `Error: Could not connect to the assistant backend. Details: ${err.message}`;
      
      const errorAiMsg = {
        id: `temp-error-${Date.now()}`,
        role: 'assistant',
        content: errorContent,
        timestamp: new Date()
      };
      setMessages(prev => {
        const filtered = prev.filter(m => m?.id !== tempUserMsgId);
        return [...filtered, { ...newUserMessage, id: `local-user-${Date.now()}` }, errorAiMsg];
      });
    } finally {
      console.log("[ChatInterface] sendMessage execution finally block reached");
      setLoading(false);
      setStreamingContent('');
      setTimeout(() => scrollRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    }
  };

  const startVoiceInput = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSpeechSupported(false);
      return;
    }
    if (loading || isListening) return;

    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    recognition.lang = getLanguageOption(preferredLanguageRef.current).speechLang;
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setIsListening(true);
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);
    recognition.onresult = async (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript?.trim();
      if (!transcript) return;
      setInput('');
      await sendMessage(transcript);
    };

    recognition.start();
  };

  const stopVoiceInput = () => {
    recognitionRef.current?.stop();
    setIsListening(false);
  };

  const uiText = uiTextByLanguage[preferredLanguage] || uiTextByLanguage['en-IN'];

  const actionsRef = useRef({});
  useEffect(() => {
    actionsRef.current = { handleCopy, handleRegenerate };
  });
  const stableOnCopy = useCallback((text, id) => actionsRef.current.handleCopy(text, id), []);
  const stableOnRegenerate = useCallback(() => actionsRef.current.handleRegenerate(), []);

  return (
    <div className="flex h-full relative overflow-hidden w-full">
      {/* Sidebar for History */}
      <div className={`w-64 bg-slate border-r border-glass-border flex flex-col transition-all ${sidebarOpen ? 'ml-0' : '-ml-64'}`}>
        <div className="p-4 border-b border-glass-border">
          <button id="new-chat-button" onClick={handleNewChat} className="w-full py-2 px-4 bg-neon-cyan text-white rounded-lg text-sm font-bold flex items-center justify-center gap-2 hover:bg-[#2f4a48] transition-colors">
            <Plus size={16} /> New Chat
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {sessions.map(s => (
            <button
              key={s.id}
              onClick={() => setCurrentSessionId(s.id)}
              className={`w-full text-left p-3 rounded-lg text-sm truncate transition-colors mb-1 ${currentSessionId === s.id ? 'bg-white border border-glass-border text-text-primary shadow-sm' : 'text-text-muted hover:bg-black/5'}`}
            >
              <MessageSquare size={14} className="inline mr-2 opacity-50" />
              {s.preview || 'New Conversation'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col h-full relative">
        <header className="h-20 px-10 border-b border-glass-border flex items-center bg-white shrink-0">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="mr-4 text-text-muted hover:text-text-primary p-2">
            <MessageSquare size={20} />
          </button>
          <div>
            <h1 className="text-2xl font-bold font-serif text-text-primary tracking-tight">{uiText.title}</h1>
            <p className="text-[13px] text-text-muted">{uiText.subtitle}</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="flex items-center gap-2 rounded-lg border border-glass-border bg-slate px-3 py-2">
              <Languages size={16} className="text-text-muted" />
              <select
                value={preferredLanguage}
                onChange={(e) => handleLanguageChange(e.target.value)}
                className="bg-transparent text-xs font-bold text-text-primary outline-none"
                aria-label="Preferred language"
              >
                {languageOptions.map((option) => (
                  <option key={option.code} value={option.code}>{option.label}</option>
                ))}
              </select>
            </div>
            <span className="hidden lg:inline-flex rounded-full border border-neon-green/20 bg-neon-green/10 px-3 py-1 text-xs font-bold text-neon-green">
              {uiText.memory}
            </span>
            {isPro && <span className="bg-neon-amber/10 text-neon-amber px-3 py-1 rounded-full text-xs font-bold border border-neon-amber/20">PRO ACTIVE</span>}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-10 flex flex-col gap-6">
          {messages.length === 0 && !streamingContent && (
            <div className="text-center text-text-muted opacity-70 mt-20">
              <p>{uiText.empty}</p>
            </div>
          )}
          {messages.map((msg) => {
            if (!msg) return null;
            const isLast = msg.id === messages[messages.length - 1]?.id;
            return (
              <MessageBubble
                key={msg.id || `msg-${Math.random()}`}
                msg={msg}
                isLast={isLast}
                onCopy={stableOnCopy}
                onRegenerate={stableOnRegenerate}
                isCopied={copiedId === msg.id}
                isRegeneratingDisabled={isLast ? loading : false}
              />
            );
          })}
          {loading && (
            <div className="flex gap-4 max-w-[80%] animate-[slideIn_0.3s_ease-out]">
              <div className="w-9 h-9 rounded-full bg-slate border border-glass-border flex items-center justify-center font-bold text-sm text-text-dim font-serif shrink-0">D</div>
              <div className="p-4 bg-white border border-glass-border rounded-2xl rounded-tl-sm text-text-primary text-[15px] leading-relaxed shadow-sm flex flex-col gap-2 min-w-[60px] w-full overflow-hidden">
                {streamingContent ? <MarkdownMessage content={streamingContent} /> : (
                  <div className="flex items-center gap-2 h-6">
                    <div className="w-2 h-2 bg-text-muted rounded-full animate-bounce"></div>
                    <div className="w-2 h-2 bg-text-muted rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                    <div className="w-2 h-2 bg-text-muted rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                  </div>
                )}
              </div>
            </div>
          )}
          <div ref={scrollRef}></div>
        </div>

        <div className="p-8 pb-10 bg-void shrink-0">
          <form onSubmit={handleSend} className="glass-card p-2 shadow-sm flex items-center gap-3">
            <button type="button" className="w-10 h-10 flex items-center justify-center text-text-muted hover:text-neon-cyan transition-colors rounded-xl hover:bg-slate"><Paperclip size={18} /></button>
            <button type="button" className="w-10 h-10 flex items-center justify-center text-text-muted hover:text-neon-cyan transition-colors rounded-xl hover:bg-slate"><Camera size={18} /></button>

            <input
              id="chat-message-input"
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={loading}
              placeholder={isListening ? uiText.listening : uiText.placeholder}
              className="flex-1 bg-transparent border-none outline-none text-text-primary text-base font-main px-2 disabled:opacity-50"
            />

            <button
              type="button"
              onClick={() => setVoiceOutputEnabled((enabled) => !enabled)}
              className={`w-10 h-10 flex items-center justify-center transition-colors rounded-xl hover:bg-slate ${voiceOutputEnabled ? 'text-neon-cyan bg-slate' : 'text-text-muted hover:text-neon-cyan'}`}
              aria-label="Toggle voice output"
              title="Toggle voice output"
            >
              {voiceOutputEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
            </button>
            <button
              type="button"
              onClick={isListening ? stopVoiceInput : startVoiceInput}
              disabled={loading}
              className={`w-10 h-10 flex items-center justify-center transition-colors rounded-xl hover:bg-slate disabled:opacity-50 ${isListening ? 'bg-red-500/10 text-red-500' : 'text-text-muted hover:text-neon-cyan'}`}
              aria-label="Voice input"
              title={speechSupported ? 'Voice input' : 'Voice input is not supported in this browser'}
            >
              <Mic size={18} />
            </button>
            {loading ? (
              <button id="chat-stop-button" type="button" onClick={handleStopGeneration} className="w-10 h-10 flex items-center justify-center bg-red-500/10 text-red-500 rounded-xl hover:bg-red-500/20 transition-all shadow-sm">
                <Square size={16} fill="currentColor" />
              </button>
            ) : (
              <button id="chat-send-button" type="submit" disabled={!input.trim()} className="w-10 h-10 flex items-center justify-center bg-neon-cyan text-white rounded-xl hover:bg-[#2f4a48] transition-all disabled:opacity-50 hover:-translate-y-px shadow-sm">
                <Send size={18} />
              </button>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
