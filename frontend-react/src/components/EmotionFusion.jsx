import { useEffect, useRef, useState } from 'react';
import * as faceapi from '@vladmandic/face-api';
import { Camera, CheckCircle2, ExternalLink, LoaderCircle, ShieldCheck, Square, Video } from 'lucide-react';

const MODEL_URI = (import.meta.env.VITE_FACE_MODEL_URL || 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model').replace(/\/$/, '');
const SAMPLE_INTERVAL_MS = 2500;
const REQUIRED_SAMPLES = 8;
const NON_POSITIVE_EXPRESSIONS = new Set(['neutral', 'sad', 'angry', 'fearful', 'disgusted']);

function displayExpression(expressions) {
  const entries = Object.entries(expressions || {});
  if (!entries.length) return { label: 'neutral', confidence: 0 };
  const [label, confidence] = entries.reduce((best, entry) => (entry[1] > best[1] ? entry : best));
  return { label, confidence: Math.round(confidence * 100) };
}

function needsCheckIn(samples) {
  if (samples.length < REQUIRED_SAMPLES) return false;
  const nonPositive = samples.filter((sample) => NON_POSITIVE_EXPRESSIONS.has(sample.label) && sample.confidence >= 55);
  return nonPositive.length >= Math.ceil(REQUIRED_SAMPLES * 0.75);
}

function CrisisResources({ selfReport }) {
  const urgent = /(suicid|kill myself|end my life|self[- ]?harm|hurt myself|can't go on|immediate danger)/i.test(selfReport);
  if (!urgent) return null;
  return (
    <section className="mt-4 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-950">
      <p className="font-bold">You deserve immediate human support.</p>
      <p className="mt-1">If you may act on these thoughts or are in immediate danger, call your local emergency number now or go to the nearest emergency department.</p>
      <ul className="mt-3 space-y-1">
        <li>India: Tele-MANAS 24/7 at <a className="underline font-semibold" href="tel:14416">14416</a> or <a className="underline font-semibold" href="tel:18008914416">1800-89-14416</a>; emergency <a className="underline font-semibold" href="tel:112">112</a>.</li>
        <li>United States: call or text <a className="underline font-semibold" href="tel:988">988</a>.</li>
        <li>Elsewhere: <a className="underline font-semibold" href="https://findahelpline.com/" target="_blank" rel="noreferrer">find a verified local helpline <ExternalLink className="inline" size={13} /></a>.</li>
      </ul>
    </section>
  );
}

export default function EmotionFusion({ isPro = false }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const intervalRef = useRef(null);
  const inferenceInFlight = useRef(false);
  const samplesRef = useRef([]);

  const [consented, setConsented] = useState(false);
  const [modelsState, setModelsState] = useState('idle');
  const [cameraState, setCameraState] = useState('idle');
  const [expression, setExpression] = useState({ label: 'neutral', confidence: 0 });
  const [error, setError] = useState('');
  const [showCheckIn, setShowCheckIn] = useState(false);
  const [selfReport, setSelfReport] = useState('');
  const [supportRequested, setSupportRequested] = useState(false);

  const stopCamera = () => {
    if (intervalRef.current) window.clearInterval(intervalRef.current);
    intervalRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraState('stopped');
  };

  useEffect(() => () => stopCamera(), []);

  useEffect(() => {
    if (!consented) return undefined;
    let cancelled = false;

    async function start() {
      setError('');
      setModelsState('loading');
      try {
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URI),
          faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URI),
        ]);
        if (cancelled) return;
        setModelsState('ready');
        setCameraState('requesting');
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraState('active');

        const infer = async () => {
          if (inferenceInFlight.current || !videoRef.current || videoRef.current.readyState < 2) return;
          inferenceInFlight.current = true;
          try {
            const result = await faceapi
              .detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.45 }))
              .withFaceExpressions();
            if (!result) return;
            const next = displayExpression(result.expressions);
            setExpression(next);
            const nextSamples = [...samplesRef.current.slice(-(REQUIRED_SAMPLES - 1)), next];
            samplesRef.current = nextSamples;
            if (needsCheckIn(nextSamples)) setShowCheckIn(true);
          } catch (inferenceError) {
            console.warn('Expression inference failed', inferenceError);
          } finally {
            inferenceInFlight.current = false;
          }
        };
        await infer();
        intervalRef.current = window.setInterval(infer, SAMPLE_INTERVAL_MS);
      } catch (startError) {
        if (!cancelled) {
          console.error('Expression check-in unavailable', startError);
          setError(startError.name === 'NotAllowedError' ? 'Camera access was blocked. Allow it in your browser settings to run the optional check-in.' : 'Expression check-in could not start. Check your connection, then try again.');
          setModelsState('error');
          stopCamera();
        }
      }
    }

    start();
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [consented]);

  const restart = () => {
    samplesRef.current = [];
    setShowCheckIn(false);
    setSupportRequested(false);
    setConsented(false);
    window.setTimeout(() => setConsented(true), 0);
  };

  if (!consented) {
    return (
      <div className="flex-1 overflow-y-auto bg-neu-base p-6 lg:p-10">
        <section className="mx-auto max-w-2xl rounded-neu-xl neu-card p-8 border border-white/80">
          <div className="flex h-14 w-14 items-center justify-center rounded-neu-md neu-card-flat text-neu-teal shadow-neu-raised-sm">
            <Camera size={26} />
          </div>
          <h1 className="mt-5 text-3xl font-bold font-serif text-text-primary">Optional expression check-in</h1>
          <p className="mt-3 leading-relaxed text-text-dim">
            With your consent, your camera is analysed in this browser to classify one of seven basic facial expressions: happy, sad, angry, surprised, fearful, disgusted, or neutral. Video and inference results are not uploaded or stored.
          </p>
          <div className="mt-5 rounded-neu-md neu-inset p-4 text-sm text-amber-950 bg-[#faeccd]/60 border border-amber-900/15">
            <p className="font-bold">Important limits</p>
            <p className="mt-1 leading-relaxed">
              This is not a mood reader, lie detector, health tool, or diagnosis. It cannot detect anxiety, depression, stress, fatigue, or heart rate. Expression classifiers are affected by lighting, pose, culture, and individual differences; expect roughly 65-75% accuracy on standard webcam video, not a clinical diagnostic score.
            </p>
          </div>
          <button 
            onClick={() => setConsented(true)} 
            className="mt-6 inline-flex items-center gap-2.5 rounded-neu-md neu-btn-teal px-6 py-3.5 font-bold text-white focus-neu transition-all"
          >
            <ShieldCheck size={18} /> Start private check-in
          </button>
          {isPro && <p className="mt-4 text-xs text-text-muted">Premium can add future opt-in wellness journaling, but recognition itself is not gated by billing.</p>}
        </section>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-neu-base p-6 lg:p-10">
      <section className="mx-auto max-w-4xl">
        <header className="mb-6">
          <p className="text-xs font-bold uppercase tracking-wider text-neu-gold">Local-only camera check-in</p>
          <h1 className="mt-1 text-3xl font-bold font-serif text-text-primary">Basic expression recognition</h1>
          <p className="mt-1 text-sm text-text-dim">A lightweight model classifies facial expression only. It does not know how you feel.</p>
        </header>
        <div className="grid gap-6 lg:grid-cols-[1.25fr_0.75fr]">
          <div className="overflow-hidden rounded-neu-xl neu-card p-2.5 bg-neu-base border border-white/80">
            <div className="overflow-hidden rounded-neu-lg bg-black relative">
              <video ref={videoRef} autoPlay playsInline muted className="aspect-video w-full object-cover" />
              {cameraState !== 'active' && (
                <div className="absolute inset-0 flex items-center justify-center bg-[#1c2224] text-white">
                  <LoaderCircle className="mr-2 animate-spin text-neu-teal" size={20} /> 
                  <span>{modelsState === 'loading' ? 'Loading local model...' : 'Starting camera...'}</span>
                </div>
              )}
            </div>
          </div>
          <aside className="rounded-neu-xl neu-card p-6 bg-neu-base border border-white/80 flex flex-col justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-neu-gold">Current classification</p>
              <div className="mt-3 rounded-neu-md neu-inset p-4 bg-neu-dark border border-[#ded7c8]/40">
                <p className="text-3xl font-bold capitalize text-text-primary tracking-tight">{expression.label}</p>
                <p className="mt-1 text-sm font-semibold text-neu-teal">Model confidence: {expression.confidence}%</p>
              </div>
              <p className="mt-4 rounded-neu-md neu-card-flat p-3 text-xs leading-5 text-text-dim border border-white/60">
                Confidence is the model's ranking for this frame, not proof that the expression is correct and not a measure of wellbeing.
              </p>
            </div>
            <div className="mt-6 flex flex-wrap gap-2.5">
              <button 
                onClick={stopCamera} 
                disabled={cameraState !== 'active'} 
                className="inline-flex items-center gap-2 rounded-neu-sm neu-btn px-4 py-2.5 text-sm font-bold text-text-dim disabled:opacity-40 focus-neu transition-all"
              >
                <Square size={14} /> Stop camera
              </button>
              <button 
                onClick={restart} 
                className="inline-flex items-center gap-2 rounded-neu-sm neu-btn-teal px-4 py-2.5 text-sm font-bold text-white focus-neu transition-all"
              >
                <Video size={14} /> Restart
              </button>
            </div>
          </aside>
        </div>
        {error && <div className="mt-5 rounded-neu-md neu-inset p-4 text-sm text-red-800 bg-red-50 border border-red-200">{error}</div>}
        {showCheckIn && !supportRequested && (
          <section className="mt-6 rounded-neu-xl neu-card p-6 border border-amber-900/15 bg-[#faeccd]/40">
            <p className="font-bold text-amber-950">A quick human check-in</p>
            <p className="mt-1 text-sm text-amber-900">You've been using this tool for a little while. How are you doing? Only you can answer that.</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button onClick={() => setShowCheckIn(false)} className="rounded-neu-sm neu-btn px-4 py-2 text-sm font-bold text-amber-950 focus-neu">I'm okay</button>
              <button onClick={() => setSupportRequested(true)} className="rounded-neu-sm neu-btn-teal px-4 py-2 text-sm font-bold text-white focus-neu">I'd like support</button>
            </div>
          </section>
        )}
        {supportRequested && (
          <section className="mt-6 rounded-neu-xl neu-card p-6 border border-white/80 bg-neu-base">
            <p className="font-bold text-text-primary">Tell us in your own words, if you want to.</p>
            <textarea 
              value={selfReport} 
              onChange={(event) => setSelfReport(event.target.value)} 
              maxLength={1000} 
              placeholder="How are you feeling right now?" 
              className="mt-3 min-h-24 w-full rounded-neu-md neu-inset bg-neu-dark p-3.5 text-sm text-text-primary placeholder:text-text-muted outline-none focus-neu border border-[#ded7c8]/50" 
            />
            <p className="mt-2 text-xs text-text-muted">This stays in this browser and is not a diagnosis. For ongoing support, contact a licensed professional or someone you trust.</p>
            <CrisisResources selfReport={selfReport} />
          </section>
        )}
      </section>
    </div>
  );
}
