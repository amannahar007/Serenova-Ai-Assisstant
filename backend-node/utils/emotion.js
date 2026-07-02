const Sentiment = require('sentiment');
const sentiment = new Sentiment();

function analyzeEmotion(text) {
    const result = sentiment.analyze(text);
    const score = result.score;
    
    let emotion = 'neutral';
    let color = '#94a3b8'; // Neutral gray
    let emoji = '😐';

    if (score > 5) {
        emotion = 'ecstatic';
        color = '#fcd34d'; // Bright yellow
        emoji = '🤩';
    } else if (score > 1) {
        emotion = 'happy';
        color = '#4ade80'; // Green
        emoji = '😊';
    } else if (score < -5) {
        emotion = 'angry';
        color = '#ef4444'; // Red
        emoji = '😡';
    } else if (score < -1) {
        emotion = 'sad';
        color = '#3b82f6'; // Blue
        emoji = '😢';
    }

    return {
        emotion,
        score,
        color,
        emoji,
        comparative: result.comparative
    };
}

module.exports = { analyzeEmotion };
