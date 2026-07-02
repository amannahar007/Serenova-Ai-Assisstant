import google.generativeai as genai
import httpx, os

genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
model = genai.GenerativeModel("gemini-2.5-flash")

async def analyze_health(user_msg: str, face_data: dict):
    prompt = f"""
    You are ARIA, Serenova's health AI for India.

    User message: {user_msg}

    Face analysis data:
    - Emotion detected: {face_data.get('emotion','unknown')}
    - Stress score: {face_data.get('stress', 'N/A')}/10
    - Fatigue score: {face_data.get('fatigue', 'N/A')}/10
    - Heart rate estimate: {face_data.get('heart_rate','N/A')} bpm

    Your task:
    1. Acknowledge what you see in their face + what they said
    2. Give ONE helpful wellness suggestion
    3. If stress > 7 or fatigue > 8: gently suggest rest or
       professional help
    4. If user mentions chest pain, shortness of breath,
       severe symptoms: immediately give emergency numbers
    5. ALWAYS end with the disclaimer below
    6. Reply in same language as user (Hindi/English/Hinglish)

    DISCLAIMER (always include):
    "Yeh Serenova ki AI wellness estimate hai —
    medical diagnosis nahi. Doctor se milna zaroori hai
    kisi bhi health concern ke liye."
    """

    result = model.generate_content(prompt)
    return result.text

async def get_drug_info(symptom: str):
    # OpenFDA free API — no key needed
    async with httpx.AsyncClient() as client:
        res = await client.get(
            "https://api.fda.gov/drug/label.json",
            params={"search": f"indications_and_usage:{symptom}",
                    "limit": 3}
        )
        if res.status_code == 200:
            return res.json()
    return None
