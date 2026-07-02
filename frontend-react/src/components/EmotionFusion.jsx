import { useEffect, useRef, useState } from 'react';
import { rtdb } from '../firebase';
import { ref, push, serverTimestamp } from 'firebase/database';

export default function EmotionFusion({ user }) {
  const videoRef = useRef(null);
  const [emotion, setEmotion] = useState('Calibrating...');
  const [confidence, setConfidence] = useState(0);
  const [isScanning, setIsScanning] = useState(true);

  const workerRef = useRef(null);

  useEffect(() => {
    let stream;
    const startCamera = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        
        // Initialize WebWorker
        if (!workerRef.current) {
          workerRef.current = new Worker(new URL('../workers/emotionWorker.js', import.meta.url), { type: 'module' });
          
          workerRef.current.onmessage = async (e) => {
            const { type, payload } = e.data;
            if (type === 'INFERENCE_RESULT') {
              setEmotion(payload.emotion);
              setConfidence(payload.confidence);

              // Log to analytics asynchronously
              if (user?.uid) {
                try {
                  await push(ref(rtdb, 'analytics_events'), {
                    event: 'emotion_feature_used',
                    userId: user.uid,
                    detectedEmotion: payload.emotion,
                    confidence: payload.confidence,
                    timestamp: serverTimestamp()
                  });
                } catch (err) {
                  console.warn("Analytics error:", err);
                }
              }
            }
          };
        }

        // Send start signal to Worker
        workerRef.current.postMessage({
          type: 'START_ENGINE',
          payload: { intervalMs: 3000 }
        });
      } catch (err) {
        console.error("Fusion Core Error:", err);
        setEmotion("Camera/Mic access denied");
      }
    };

    startCamera();
    return () => {
      if (stream) stream.getTracks().forEach(t => t.stop());
      if (workerRef.current) {
        workerRef.current.postMessage({ type: 'STOP_ENGINE' });
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, [isScanning, user.uid]);

  return (
    <div className="flex-1 p-10 flex flex-col">
      <header className="mb-8">
        <h1 className="text-2xl font-bold font-serif text-text-primary">Emotion Core Fusion</h1>
        <p className="text-sm text-text-muted">AI-powered mood & wellness insights</p>
      </header>

      <div className="flex gap-8">
        <div className="flex-1 glass-card overflow-hidden relative shadow-lg border-neon-cyan/30">
          <video ref={videoRef} autoPlay playsInline muted className="w-full h-[400px] object-cover bg-black" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent pointer-events-none flex flex-col justify-end p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/70 text-xs font-mono uppercase tracking-wider mb-1">Current State</p>
                <p className="text-3xl font-bold text-white tracking-wide">{emotion}</p>
              </div>
              <div className="text-right">
                <p className="text-white/70 text-xs font-mono uppercase tracking-wider mb-1">Confidence</p>
                <p className="text-2xl font-mono text-neon-green">{confidence}%</p>
              </div>
            </div>
          </div>
          {isScanning && (
            <div className="absolute top-4 right-4 flex items-center gap-2 bg-black/50 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div>
              <span className="text-white text-xs font-mono uppercase tracking-widest">Scanning</span>
            </div>
          )}
        </div>

        <div className="w-80 flex flex-col gap-6">
          <div className="glass-card p-6">
            <h3 className="text-sm font-bold uppercase text-text-muted mb-4 tracking-wider">Fusion Metrics</h3>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-xs mb-1"><span className="text-text-dim">Facial Tracking</span><span className="text-neon-cyan font-bold">Active</span></div>
                <div className="h-1.5 w-full bg-slate rounded-full overflow-hidden"><div className="h-full bg-neon-cyan w-[95%]"></div></div>
              </div>
              <div>
                <div className="flex justify-between text-xs mb-1"><span className="text-text-dim">Voice Pitch Analysis</span><span className="text-neon-cyan font-bold">Active</span></div>
                <div className="h-1.5 w-full bg-slate rounded-full overflow-hidden"><div className="h-full bg-neon-cyan w-[88%]"></div></div>
              </div>
            </div>
          </div>
          
          <div className="glass-card p-6 border-l-4 border-l-neon-amber">
            <h3 className="text-sm font-bold text-text-primary mb-2">Privacy Disclaimer</h3>
            <p className="text-xs text-text-muted leading-relaxed">
              Raw video and audio streams are processed locally in your browser. No raw biometric data is sent to our servers. Emotion insights are approximate and not medical advice.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
