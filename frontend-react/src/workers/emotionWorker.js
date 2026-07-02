/* eslint-disable no-restricted-globals */

let isRunning = false;
let fusionInterval = null;

// Mock models representing the actual MediaPipe/TensorFlow logic
const emotions = ['Neutral', 'Happy', 'Focused', 'Stressed', 'Surprised', 'Calm'];

const runInferenceCycle = () => {
    if (!isRunning) return;

    // Simulate heavy inference computation
    const detected = emotions[Math.floor(Math.random() * emotions.length)];
    // Generate a confidence score between 80% and 99%
    const conf = Math.floor(Math.random() * 20) + 80;

    // Send the result back to the main UI thread
    self.postMessage({
        type: 'INFERENCE_RESULT',
        payload: {
            emotion: detected,
            confidence: conf,
            timestamp: Date.now()
        }
    });
};

self.addEventListener('message', (e) => {
    const { type, payload } = e.data;

    switch (type) {
        case 'START_ENGINE':
            if (!isRunning) {
                console.log("[Worker] Emotion/Gesture Engine Started");
                isRunning = true;
                // In production, this loop would be driven by requestAnimationFrame processing video frames
                fusionInterval = setInterval(runInferenceCycle, payload?.intervalMs || 3000);
            }
            break;

        case 'STOP_ENGINE':
            if (isRunning) {
                console.log("[Worker] Emotion/Gesture Engine Stopped");
                isRunning = false;
                if (fusionInterval) {
                    clearInterval(fusionInterval);
                    fusionInterval = null;
                }
            }
            break;

        default:
            console.warn(`[Worker] Unknown message type: ${type}`);
    }
});
