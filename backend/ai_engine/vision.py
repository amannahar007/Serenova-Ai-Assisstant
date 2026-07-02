import base64
import requests

def analyze_gesture(image_path: str) -> str:
    """
    Takes an image path (camera frame), encodes it, and asks LLaVA 
    to interpret the hand gesture and intent using direct HTTP call to Ollama.
    """
    # Read the image and encode it to base64
    with open(image_path, "rb") as image_file:
        image_base64 = base64.b64encode(image_file.read()).decode('utf-8')
        
    prompt = (
        "You are an accessibility AI. Look at this image containing a person making a hand gesture. "
        "Identify the gesture exactly, and state what it means (e.g., 'Thumbs up, meaning yes/approval' "
        "or 'ASL sign for Hello'). If no clear gesture is present, say 'No gesture detected'. Be concise. "
        "DO NOT attempt to predict the person's mental state, trustworthiness, intelligence, or personality."
    )
    
    url = "http://localhost:11434/api/generate"
    try:
        response = requests.post(url, json={
            "model": "llava",
            "prompt": prompt,
            "images": [image_base64],
            "stream": False,
            "options": {
                "temperature": 0.1
            }
        }, timeout=300.0)
        response.raise_for_status()
        return response.json().get("response", "No response from vision model").strip()
    except Exception as e:
        return f"Error analyzing gesture: {str(e)}"
