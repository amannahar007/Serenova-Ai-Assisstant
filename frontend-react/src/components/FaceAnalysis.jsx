import { useEffect, useRef, useState } from "react";
import { FaceMesh } from "@mediapipe/face_mesh";
import { Camera } from "@mediapipe/camera_utils";

const EMOTIONS = ["happy","sad","angry","fearful",
                  "disgusted","surprised","neutral"];

export default function FaceAnalysis({ onResult, isPremium }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [emotion, setEmotion]       = useState("neutral");
  const [stress, setStress]         = useState(0);
  const [fatigue, setFatigue]       = useState(0);
  const [heartRate, setHeartRate]   = useState(72);
  const [isActive, setIsActive]     = useState(false);
  const [consent, setConsent]       = useState(false);

  // Eye Aspect Ratio — detects fatigue/drowsiness
  const computeEAR = (landmarks) => {
    // Left eye landmarks: 159,145,33,133
    // Right eye landmarks: 386,374,362,263
    const L = {
      top: landmarks[159], bot: landmarks[145],
      left: landmarks[33], right: landmarks[133]
    };
    const vertical = Math.hypot(
      L.top.x - L.bot.x, L.top.y - L.bot.y
    );
    const horizontal = Math.hypot(
      L.left.x - L.right.x, L.left.y - L.right.y
    );
    return vertical / (horizontal + 0.001);
  };

  // Brow distance — detects stress/anger
  const computeBrowTension = (landmarks) => {
    const leftBrow  = landmarks[70];
    const rightBrow = landmarks[300];
    const leftEye   = landmarks[159];
    const rightEye  = landmarks[386];
    const leftDist  = Math.hypot(
      leftBrow.x - leftEye.x,
      leftBrow.y - leftEye.y
    );
    const rightDist = Math.hypot(
      rightBrow.x - rightEye.x,
      rightBrow.y - rightEye.y
    );
    return (leftDist + rightDist) / 2;
  };

  // Mouth curve — detects happiness/sadness
  const computeMouthCurve = (landmarks) => {
    const leftCorner  = landmarks[61];
    const rightCorner = landmarks[291];
    const topLip      = landmarks[13];
    const midX = (leftCorner.x + rightCorner.x) / 2;
    return topLip.y - midX; // positive = smile
  };

  // Classify emotion from geometry
  const classifyEmotion = (ear, brow, mouth) => {
    if (mouth > 0.02)  return "happy";
    if (brow < 0.04)   return "angry";
    if (ear < 0.15)    return "fearful";
    if (mouth < -0.02) return "sad";
    return "neutral";
  };

  useEffect(() => {
    if (!consent || !isPremium) return;

    const faceMesh = new FaceMesh({
      locateFile: (f) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}`
    });

    faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.6,
    });

    faceMesh.onResults((results) => {
      if (!results.multiFaceLandmarks?.length) return;
      const lm = results.multiFaceLandmarks[0];

      const ear    = computeEAR(lm);
      const brow   = computeBrowTension(lm);
      const mouth  = computeMouthCurve(lm);

      const detectedEmotion = classifyEmotion(ear, brow, mouth);
      const stressScore  = Math.max(0, Math.min(10,
        (1 - brow / 0.08) * 10
      ));
      const fatigueScore = Math.max(0, Math.min(10,
        (1 - ear / 0.25) * 10
      ));

      setEmotion(detectedEmotion);
      setStress(Math.round(stressScore * 10) / 10);
      setFatigue(Math.round(fatigueScore * 10) / 10);

      // Send results to parent / Gemini AI
      onResult?.({
        emotion: detectedEmotion,
        stress: stressScore,
        fatigue: fatigueScore,
        ear, brow, mouth,
        timestamp: Date.now()
      });
    });

    const camera = new Camera(videoRef.current, {
      onFrame: async () => {
        await faceMesh.send({ image: videoRef.current });
      },
      width: 640,
      height: 480,
    });

    camera.start();
    setIsActive(true);

    return () => { camera.stop(); setIsActive(false); };
  }, [consent, isPremium]);

  // Consent screen
  if (!consent) return (
    <div style={{ padding: "24px", textAlign: "center" }}>
      <h3>Serenova Face Analysis</h3>
      <p style={{ color: "var(--text-secondary)", fontSize: 14 }}>
        Aapka video kabhi store nahi hoga.
        Sirf real-time analysis hogi.
      </p>
      <button onClick={() => setConsent(true)}>
        Allow camera
      </button>
    </div>
  );

  return (
    <div>
      <video ref={videoRef} style={{ display: "none" }}/>
      <canvas ref={canvasRef} style={{ display: "none" }}/>

      {/* Health card display */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(130px,1fr))",
        gap: 12, padding: "16px 0"
      }}>
        {[
          { label: "Emotion",    value: emotion,         unit: "" },
          { label: "Stress",     value: `${stress}/10`,  unit: "" },
          { label: "Fatigue",    value: `${fatigue}/10`, unit: "" },
          { label: "Heart rate", value: heartRate,        unit: "bpm" },
        ].map(({ label, value, unit }) => (
          <div key={label} style={{
            background: "var(--surface-1)",
            borderRadius: 8, padding: "12px 16px"
          }}>
            <div style={{
              fontSize: 12,
              color: "var(--text-secondary)",
              marginBottom: 4
            }}>{label}</div>
            <div style={{ fontSize: 20, fontWeight: 500 }}>
              {value} <span style={{
                fontSize: 12,
                color: "var(--text-muted)"
              }}>{unit}</span>
            </div>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 11, color: "var(--text-muted)" }}>
        Wellness estimate only — not a medical diagnosis.
      </p>
    </div>
  );
}
