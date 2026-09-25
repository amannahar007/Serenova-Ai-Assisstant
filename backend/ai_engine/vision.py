"""Vision and Facial Expression Analysis Engine."""

from __future__ import annotations
import base64
import os
import sys
from typing import Dict, Any
import cv2
import numpy as np
import requests

# Lazy-loaded recognizer singleton
_fer_recognizer = None

def get_fer_recognizer():
    global _fer_recognizer
    if _fer_recognizer is None:
        try:
            # Add facial_expression directory to sys.path
            fe_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'facial_expression')
            if fe_dir not in sys.path:
                sys.path.insert(0, fe_dir)
            from realtime_fer import FacialExpressionRecognizer
            _fer_recognizer = FacialExpressionRecognizer(confidence_threshold=0.65)
        except Exception as e:
            print(f"[Vision] Warning: Failed to load FER recognizer: {e}")
            _fer_recognizer = None
    return _fer_recognizer

def analyze_facial_expression(image_path: str) -> Dict[str, Any]:
    """
    Takes an image path (camera frame), extracts face region,
    and classifies facial expression with confidence thresholding.
    Returns:
        {
            'expression': str,
            'raw_expression': str,
            'confidence': float,
            'is_recognized': bool,
            'status': str,
            'probabilities': dict[str, float],
            'bbox': tuple or None
        }
    """
    recognizer = get_fer_recognizer()
    if recognizer is None:
        return {
            'expression': 'uncertain / model unavailable',
            'raw_expression': 'unknown',
            'confidence': 0.0,
            'is_recognized': False,
            'status': 'error',
            'probabilities': {},
            'bbox': None
        }

    img = cv2.imread(image_path)
    if img is None:
        return {
            'expression': 'invalid image',
            'raw_expression': 'unknown',
            'confidence': 0.0,
            'is_recognized': False,
            'status': 'error',
            'probabilities': {},
            'bbox': None
        }

    return recognizer.predict_frame(img)

def analyze_gesture(image_path: str) -> str:
    """
    Takes an image path (camera frame), encodes it, and asks LLaVA 
    to interpret the hand gesture and intent using direct HTTP call to Ollama.
    """
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
