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
    <div className="prose prose-sm max-w-none prose-p:leading-relaxed prose-pre:p-0 prose-pre:bg-transparent prose-pre:m-0 text-text-primary">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
        code({node, inline, className, children, ...props}) {
          const match = /language-(\w+)/.exec(className || '')
          return !inline && match ? (
            <div className="rounded-neu-md overflow-hidden my-3 neu-card-flat border border-[#ded7c8]">
              <div className="bg-[#1c2224] px-4 py-1.5 text-xs text-slate-300 font-mono border-b border-gray-700/60 flex justify-between items-center">
                <span>{match[1]}</span>
              </div>
              <SyntaxHighlighter
                style={vscDarkPlus}
                language={match[1]}
                PreTag="div"
                customStyle={{ margin: 0, padding: '1rem', background: '#1c2224' }}
                {...props}
              >
                {String(children).replace(/\n$/, '')}
              </SyntaxHighlighter>
            </div>
          ) : (
            <code className="neu-inset px-2 py-0.5 rounded-md font-mono text-[13px] text-neu-teal font-semibold border border-[#ded7c8]/50" {...props}>
              {children}
            </code>
          )
        },
        table({children}) {
          return <div className="overflow-x-auto my-4 rounded-neu-md neu-card-flat p-2"><table className="min-w-full divide-y divide-[#ded7c8] text-text-primary">{children}</table></div>
        },
        th({children}) {
          return <th className="px-4 py-2.5 bg-neu-dark text-left text-xs font-bold uppercase tracking-wider text-text-dim">{children}</th>
        },
        td({children}) {
          return <td className="px-4 py-2.5 whitespace-nowrap text-sm border-t border-[#ded7c8] text-text-primary">{children}</td>
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
    <div className={`flex gap-4 max-w-[85%] ${msg.role === 'user' ? 'self-end flex-row-reverse' : ''} animate-[slideIn_0.3s_ease-out]`}>
      <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm shrink-0 shadow-neu-raised-sm ${msg.role === 'user' ? 'bg-gradient-to-br from-neu-teal-light to-neu-teal text-white' : 'bg-neu-base text-neu-teal border border-white/80 font-serif'}`}>
        {msg.role === 'user' ? 'U' : 'D'}
      </div>
      <div className="flex flex-col gap-1.5 w-full">
        <div className={`p-4 rounded-neu-lg text-[15px] leading-relaxed ${msg.role === 'user' ? 'bg-[#e4e0d4] neu-card-flat rounded-tr-sm whitespace-pre-wrap text-text-primary border border-white/40' : 'bg-neu-base neu-card rounded-tl-sm w-full overflow-hidden text-text-primary border border-white/80'}`}>
          {msg.role === 'user' ? content : <MarkdownMessage content={content} />}
        </div>
        {msg.role === 'assistant' && (
          <div className="flex items-center gap-2 mt-1 ml-2">
            <button 
              onClick={() => onCopy(msg.content, msg.id)} 
              className="neu-btn text-text-dim hover:text-neu-teal p-1.5 rounded-neu-sm focus-neu transition-all"
              aria-label="Copy message to clipboard"
            >
              {isCopied ? <Check size={14} className="text-emerald-700" /> : <Copy size={14} />}
            </button>
            {isLast && (
              <button 
                onClick={onRegenerate} 
                disabled={isRegeneratingDisabled} 
                className="neu-btn text-text-dim hover:text-neu-teal p-1.5 rounded-neu-sm focus-neu disabled:opacity-40 transition-all"
                aria-label="Regenerate response"
              >
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
  const [currentSessionId, setCurrentSessionId] = useState(() => {
    return sessionStorage.getItem('serenova_active_session_id') || uuidv4();
  });
  const [sidebarOpen, setSidebarOpen] = useState(() => typeof window !== 'undefined' && window.innerWidth > 1150);

  const scrollRef = useRef(null);
  const abortControllerRef = useRef(null);
  const recognitionRef = useRef(null);
  const preferredLanguageRef = useRef(preferredLanguage);
  const memoryRef = useRef(memory);
  const activeSessionRef = useRef(currentSessionId);

  useEffect(() => {
    activeSessionRef.current = currentSessionId;
    if (currentSessionId) {
      sessionStorage.setItem('serenova_active_session_id', currentSessionId);
    }
  }, [currentSessionId]);

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
          const savedActiveId = sessionStorage.getItem('serenova_active_session_id');
          if (!savedActiveId && s.length > 0) {
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
      }
      // If snapshot doesn't exist yet, do NOT wipe local optimistic messages!
    }, (error) => {
      console.error("[ChatInterface] RTDB messages error:", error);
    });
    return () => unsub();
  }, [user, currentSessionId]);

  const handleSelectSession = (sid) => {
    if (sid === currentSessionId) return;
    setCurrentSessionId(sid);
    setMessages([]);
  };

  const handleNewChat = () => {
    const newId = uuidv4();
    sessionStorage.setItem('serenova_active_session_id', newId);
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
      let token = '';
      try {
        if (user && typeof user.getIdToken === 'function') {
          token = await user.getIdToken();
        }
      } catch (authErr) {
        console.warn("[ChatInterface] Auth token retrieval skipped/failed", authErr);
      }
      
      console.log("[ChatInterface] Filtering history context");
      // Include all prior completed messages in the current session (excluding the current optimistic message)
      const history = messages
        .filter(m => m && m.id !== tempUserMsgId && typeof m.content === 'string' && m.content.trim())
        .slice(-50)
        .map(m => ({
          role: m.role === 'assistant' || m.role === 'model' ? 'assistant' : 'user',
          content: m.content.trim()
        }));

      console.log("[ChatInterface] Dispatching POST request to AI Engine with history count:", history.length);
      abortControllerRef.current = new AbortController();

      // Candidate backend URLs in priority order (Local Python FastAPI is primary)
      const candidateBases = [
        'http://127.0.0.1:8000',
        'http://localhost:8000',
        import.meta.env.VITE_AI_BACKEND_URL,
        import.meta.env.VITE_PYTHON_BACKEND_URL,
        `http://${window.location.hostname}:8000`,
        import.meta.env.VITE_NODE_BACKEND_URL,
        'http://localhost:3000/api'
      ].filter(Boolean);

      // Remove duplicates
      const uniqueBases = Array.from(new Set(candidateBases.map(b => b.replace(/\/$/, ''))));

      let response = null;
      let lastFetchErr = null;

      for (const base of uniqueBases) {
        const targetUrl = base.endsWith('/chat') ? base : `${base}/chat`;
        try {
          console.log(`[ChatInterface] Attempting connection to: ${targetUrl}`);
          const res = await fetch(targetUrl, {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': token ? `Bearer ${token}` : 'Bearer dev_local_token'
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

          if (res.ok) {
            response = res;
            break;
          } else {
            console.warn(`[ChatInterface] ${targetUrl} returned status ${res.status}`);
            lastFetchErr = new Error(`HTTP ${res.status}`);
          }
        } catch (fetchErr) {
          if (fetchErr.name === 'AbortError') throw fetchErr;
          console.warn(`[ChatInterface] Connection failed to ${targetUrl}:`, fetchErr.message);
          lastFetchErr = fetchErr;
        }
      }

      if (!response) {
        throw new Error(lastFetchErr ? lastFetchErr.message : 'All backend targets unreachable');
      }

      console.log("[ChatInterface] Connection established, reading response...");
      const contentType = response.headers.get('content-type') || '';

      if (!contentType.includes('text/event-stream') && !contentType.includes('stream')) {
        // Handle standard JSON response
        const jsonResult = await response.json();
        fullResponse = jsonResult.response || jsonResult.detail || JSON.stringify(jsonResult);
        setStreamingContent(fullResponse);
      } else {
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
            if (trimmed.startsWith('data:')) {
              const rawData = trimmed.slice(5).trim();
              if (!rawData || rawData === '[DONE]') {
                continue;
              }
              try {
                const payload = JSON.parse(rawData);
                if (typeof payload === 'object' && payload !== null) {
                  if (payload.text) {
                    fullResponse += payload.text;
                    setStreamingContent(prev => prev + payload.text);
                  } else if (payload.message) {
                    throw new Error(payload.message);
                  }
                } else if (typeof payload === 'string') {
                  fullResponse += payload;
                  setStreamingContent(prev => prev + payload);
                }
              } catch (jsonErr) {
                if (jsonErr.message && !jsonErr.message.includes('JSON')) {
                  throw jsonErr;
                }
                // Raw text chunk fallback
                fullResponse += rawData;
                setStreamingContent(prev => prev + rawData);
              }
              scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
            }
          }
        }
      }

      console.log("[ChatInterface] Stream complete. Updating state & RTDB...");
      const finalAssistantContent = fullResponse || "Error: No response generated by the assistant.";

      // 1. Immediately update local state so subsequent turns have full conversation context
      const newAiMessage = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: finalAssistantContent,
        timestamp: new Date()
      };
      setMessages(prev => {
        const withoutTempUser = prev.filter(m => m.id !== tempUserMsgId);
        const hasUserMsg = withoutTempUser.some(m => m.role === 'user' && m.content === userText);
        const userPart = hasUserMsg ? [] : [newUserMessage];
        return [...withoutTempUser, ...userPart, newAiMessage];
      });
      setStreamingContent('');

      // 2. Persist to RTDB if available
      if (user?.uid && dbEnabled) {
        push(ref(rtdb, `users/${user.uid}/chats/${currentSessionId}/messages`), {
          role: 'assistant',
          content: finalAssistantContent,
          timestamp: serverTimestamp()
        }).catch(dbErr => {
          console.warn("[ChatInterface] RTDB push failed:", dbErr);
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
    <div className="flex h-full relative overflow-hidden w-full bg-neu-base min-h-0">
      {/* Sidebar for History */}
      <div className={`w-64 bg-neu-base border-r border-[#ded7c8] flex flex-col transition-all shadow-[4px_0_14px_rgba(185,177,163,0.22)] min-h-0 ${sidebarOpen ? 'ml-0' : '-ml-64'}`}>
        <div className="p-4 border-b border-[#ded7c8] shrink-0">
          <button id="new-chat-button" onClick={handleNewChat} className="w-full py-2.5 px-4 neu-btn-teal text-white rounded-neu-sm text-sm font-bold flex items-center justify-center gap-2 focus-neu">
            <Plus size={16} /> New Chat
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-1.5 min-h-0">
          {sessions.map(s => (
            <button
              key={s.id}
              onClick={() => handleSelectSession(s.id)}
              className={`w-full text-left p-3 rounded-neu-sm text-sm truncate transition-all focus-neu ${currentSessionId === s.id ? 'neu-nav-active' : 'neu-nav-idle'}`}
            >
              <MessageSquare size={14} className="inline mr-2 opacity-60" />
              {s.preview || 'New Conversation'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col h-full relative bg-neu-base min-h-0">
        <header className="h-20 px-8 border-b border-[#ded7c8] flex items-center bg-neu-base shrink-0 shadow-[0_3px_10px_rgba(185,177,163,0.18)] z-10">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="mr-4 text-text-muted hover:text-neu-teal neu-btn p-2.5 rounded-neu-sm focus-neu transition-all" aria-label="Toggle chat history drawer">
            <MessageSquare size={18} />
          </button>
          <div>
            <h1 className="text-2xl font-bold font-serif text-text-primary tracking-tight">{uiText.title}</h1>
            <p className="text-[12px] text-text-muted">{uiText.subtitle}</p>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-neu-sm neu-card-flat px-3.5 py-1.5 border border-white/60">
              <Languages size={15} className="text-neu-teal" />
              <select
                value={preferredLanguage}
                onChange={(e) => handleLanguageChange(e.target.value)}
                className="bg-transparent text-xs font-bold text-text-primary outline-none cursor-pointer focus-neu"
                aria-label="Preferred language"
              >
                {languageOptions.map((option) => (
                  <option key={option.code} value={option.code} className="bg-neu-base text-text-primary">{option.label}</option>
                ))}
              </select>
            </div>
            <span className="hidden lg:inline-flex rounded-neu-full neu-inset px-3.5 py-1 text-xs font-bold text-emerald-800 border border-emerald-900/10">
              {uiText.memory}
            </span>
            {isPro && <span className="neu-card-flat text-amber-800 px-3.5 py-1 rounded-neu-full text-xs font-bold border border-amber-800/20">PRO ACTIVE</span>}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8 lg:p-10 flex flex-col gap-6 bg-neu-base min-h-0">
          {messages.length === 0 && !streamingContent && (
            <div className="text-center text-text-muted mt-20 neu-card-flat max-w-md mx-auto p-8 rounded-neu-lg border border-white/60">
              <MessageSquare className="mx-auto text-neu-teal opacity-40 mb-3" size={36} />
              <p className="text-base font-semibold text-text-dim">{uiText.empty}</p>
              <p className="text-xs text-text-muted mt-1">Ask questions, request study plans, or seek wellness guidance.</p>
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
            <div className="flex gap-4 max-w-[85%] animate-[slideIn_0.3s_ease-out]">
              <div className="w-9 h-9 rounded-full bg-neu-base text-neu-teal border border-white/80 shadow-neu-raised-sm flex items-center justify-center font-bold text-sm font-serif shrink-0">D</div>
              <div className="p-5 bg-neu-base neu-card rounded-neu-lg rounded-tl-sm text-text-primary text-[15px] leading-relaxed shadow-neu-raised flex flex-col gap-2 min-w-[60px] w-full overflow-hidden border border-white/80">
                {streamingContent ? <MarkdownMessage content={streamingContent} /> : (
                  <div className="flex items-center gap-2.5 h-6">
                    <div className="w-2.5 h-2.5 bg-neu-teal/60 rounded-full animate-bounce"></div>
                    <div className="w-2.5 h-2.5 bg-neu-teal/60 rounded-full animate-bounce" style={{ animationDelay: '0.15s' }}></div>
                    <div className="w-2.5 h-2.5 bg-neu-teal/60 rounded-full animate-bounce" style={{ animationDelay: '0.3s' }}></div>
                  </div>
                )}
              </div>
            </div>
          )}
          <div ref={scrollRef}></div>
        </div>

        <div className="p-6 pb-8 bg-neu-base shrink-0 border-t border-[#ded7c8]/50">
          <form onSubmit={handleSend} className="neu-card-elevated p-2 sm:p-2.5 px-3 sm:px-4 flex items-center gap-2 sm:gap-3 bg-neu-base border border-white/80 w-full max-w-4xl mx-auto">
            <button type="button" className="hidden sm:flex w-10 h-10 items-center justify-center text-text-dim hover:text-neu-teal transition-all neu-btn rounded-neu-sm focus-neu" aria-label="Attach file" title="Attach file"><Paperclip size={18} /></button>
            <button type="button" className="hidden sm:flex w-10 h-10 items-center justify-center text-text-dim hover:text-neu-teal transition-all neu-btn rounded-neu-sm focus-neu" aria-label="Camera" title="Camera"><Camera size={18} /></button>

            <div className="flex-1 min-w-0 neu-inset flex items-center px-4 py-2 bg-neu-dark border border-[#ded7c8]/40">
              <input
                id="chat-message-input"
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={loading}
                placeholder={isListening ? uiText.listening : uiText.placeholder}
                className="w-full min-w-0 bg-transparent border-none outline-none text-text-primary text-base font-main placeholder:text-text-muted/70 disabled:opacity-50 focus-neu"
              />
            </div>

            <button
              type="button"
              onClick={() => setVoiceOutputEnabled((enabled) => !enabled)}
              className={`w-10 h-10 flex items-center justify-center transition-all neu-btn rounded-neu-sm focus-neu ${voiceOutputEnabled ? 'neu-nav-active text-neu-teal' : 'text-text-dim hover:text-neu-teal'}`}
              aria-label="Toggle voice output"
              title="Toggle voice output"
            >
              {voiceOutputEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
            </button>
            <button
              type="button"
              onClick={isListening ? stopVoiceInput : startVoiceInput}
              disabled={loading}
              className={`w-10 h-10 flex items-center justify-center transition-all neu-btn rounded-neu-sm focus-neu disabled:opacity-40 ${isListening ? 'neu-inset text-red-600 bg-red-100' : 'text-text-dim hover:text-neu-teal'}`}
              aria-label="Voice input"
              title={speechSupported ? 'Voice input' : 'Voice input is not supported in this browser'}
            >
              <Mic size={18} />
            </button>
            {loading ? (
              <button id="chat-stop-button" type="button" onClick={handleStopGeneration} className="w-11 h-11 flex items-center justify-center neu-btn text-red-600 bg-red-50 rounded-neu-sm focus-neu">
                <Square size={16} fill="currentColor" />
              </button>
            ) : (
              <button id="chat-send-button" type="submit" disabled={!input.trim()} className="w-11 h-11 flex items-center justify-center neu-btn-teal text-white rounded-neu-sm focus-neu disabled:opacity-40">
                <Send size={18} />
              </button>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
