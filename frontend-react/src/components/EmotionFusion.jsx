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
      <div className="flex-1 overflow-y-auto bg-[#f7f4ec] p-6 lg:p-10">
        <section className="mx-auto max-w-2xl rounded-2xl border border-[#ded5c4] bg-white p-7 shadow-sm">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#e8f3ef] text-[#2f5d62]"><Camera size={25} /></div>
          <h1 className="mt-5 text-3xl font-bold text-[#24211e]">Optional expression check-in</h1>
          <p className="mt-3 leading-6 text-[#66615a]">With your consent, your camera is analysed in this browser to classify one of seven basic facial expressions: happy, sad, angry, surprised, fearful, disgusted, or neutral. Video and inference results are not uploaded or stored.</p>
          <div className="mt-5 rounded-xl bg-[#fbf1dc] p-4 text-sm text-[#664d20]">
            <p className="font-bold">Important limits</p>
            <p className="mt-1">This is not a mood reader, lie detector, health tool, or diagnosis. It cannot detect anxiety, depression, stress, fatigue, or heart rate. Expression classifiers are affected by lighting, pose, culture, and individual differences; expect roughly 65-75% accuracy on standard webcam video, not a clinical diagnostic score.</p>
          </div>
          <button onClick={() => setConsented(true)} className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[#2f5d62] px-5 py-3 font-bold text-white hover:bg-[#23494d]"><ShieldCheck size={18} /> Start private check-in</button>
          {isPro && <p className="mt-4 text-xs text-[#66615a]">Premium can add future opt-in wellness journaling, but recognition itself is not gated by billing.</p>}
        </section>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[#f7f4ec] p-6 lg:p-10">
      <section className="mx-auto max-w-4xl">
        <header className="mb-6">
          <p className="text-xs font-bold uppercase tracking-wider text-[#846a4e]">Local-only camera check-in</p>
          <h1 className="mt-1 text-3xl font-bold text-[#24211e]">Basic expression recognition</h1>
          <p className="mt-2 text-sm text-[#66615a]">A lightweight model classifies facial expression only. It does not know how you feel.</p>
        </header>
        <div className="grid gap-6 lg:grid-cols-[1.25fr_0.75fr]">
          <div className="overflow-hidden rounded-2xl border border-[#ded5c4] bg-black shadow-sm">
            <video ref={videoRef} autoPlay playsInline muted className="aspect-video w-full object-cover" />
            {cameraState !== 'active' && <div className="flex aspect-video items-center justify-center bg-[#24211e] text-white"><LoaderCircle className="mr-2 animate-spin" size={18} /> {modelsState === 'loading' ? 'Loading local model...' : 'Starting camera...'}</div>}
          </div>
          <aside className="rounded-2xl border border-[#ded5c4] bg-white p-6 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wider text-[#846a4e]">Current classification</p>
            <p className="mt-3 text-3xl font-bold capitalize text-[#24211e]">{expression.label}</p>
            <p className="mt-1 text-sm text-[#66615a]">Model confidence: {expression.confidence}%</p>
            <p className="mt-5 rounded-xl bg-[#fbfaf6] p-3 text-xs leading-5 text-[#66615a]">Confidence is the model's ranking for this frame, not proof that the expression is correct and not a measure of wellbeing.</p>
            <button onClick={stopCamera} disabled={cameraState !== 'active'} className="mt-5 inline-flex items-center gap-2 rounded-lg border border-[#ded5c4] px-3 py-2 text-sm font-semibold text-[#514d47] disabled:opacity-50"><Square size={15} /> Stop camera</button>
            <button onClick={restart} className="ml-2 mt-5 inline-flex items-center gap-2 rounded-lg border border-[#2f5d62] px-3 py-2 text-sm font-semibold text-[#2f5d62]"><Video size={15} /> Restart</button>
          </aside>
        </div>
        {error && <div className="mt-5 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
        {showCheckIn && !supportRequested && (
          <section className="mt-6 rounded-2xl border border-[#b58c42]/40 bg-[#fbf1dc] p-5">
            <p className="font-bold text-[#51401d]">A quick human check-in</p>
            <p className="mt-1 text-sm text-[#664d20]">You've been using this tool for a little while. How are you doing? Only you can answer that.</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button onClick={() => setShowCheckIn(false)} className="rounded-lg border border-[#9d7a39] px-3 py-2 text-sm font-semibold text-[#664d20]">I'm okay</button>
              <button onClick={() => setSupportRequested(true)} className="rounded-lg bg-[#664d20] px-3 py-2 text-sm font-semibold text-white">I'd like support</button>
            </div>
          </section>
        )}
        {supportRequested && (
          <section className="mt-6 rounded-2xl border border-[#ded5c4] bg-white p-5">
            <p className="font-bold text-[#24211e]">Tell us in your own words, if you want to.</p>
            <textarea value={selfReport} onChange={(event) => setSelfReport(event.target.value)} maxLength={1000} placeholder="How are you feeling right now?" className="mt-3 min-h-24 w-full rounded-xl border border-[#ded5c4] bg-[#fbfaf6] p-3 text-sm outline-none focus:border-[#2f5d62]" />
            <p className="mt-2 text-xs text-[#66615a]">This stays in this browser and is not a diagnosis. For ongoing support, contact a licensed professional or someone you trust.</p>
            <CrisisResources selfReport={selfReport} />
          </section>
        )}
      </section>
    </div>
  );
}
