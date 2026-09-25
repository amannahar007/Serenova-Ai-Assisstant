"""
Dataset Builder & Standardization Script.
Extracts faces from archive/facial, assigns verified emotion labels,
and organizes into standard dataset/ folder hierarchy for training and cross-validation.
"""

from __future__ import annotations
import os
import re
import shutil
import cv2
import torch
import numpy as np
from PIL import Image
from transformers import AutoImageProcessor, AutoModelForImageClassification
from face_detector import FaceDetector

JAFFE_MAP = {
    'AN': 'anger',
    'DI': 'disgust',
    'FE': 'fear',
    'HA': 'happy',
    'NE': 'neutral',
    'SA': 'sad',
    'SU': 'surprise'
}

BASE_MODEL_NAME = 'dima806/facial_emotions_image_detection'

def build_dataset(
    source_dir: str = r'd:\Serenova-Ai-Assisstant-main\Serenova-Ai-Assisstant-main\archive\facial',
    output_dir: str = r'd:\Serenova-Ai-Assisstant-main\Serenova-Ai-Assisstant-main\backend\ai_engine\facial_expression\dataset'
):
    detector = FaceDetector()
    processor = AutoImageProcessor.from_pretrained(BASE_MODEL_NAME)
    model = AutoModelForImageClassification.from_pretrained(BASE_MODEL_NAME)
    model.eval()

    classes = ['anger', 'disgust', 'fear', 'happy', 'neutral', 'sad', 'surprise']
    for cls in classes:
        os.makedirs(os.path.join(output_dir, cls), exist_ok=True)

    files = [f for f in os.listdir(source_dir) if f.lower().endswith(('.jpg', '.jpeg', '.png'))]
    print(f'Found {len(files)} images to process.')

    stats = {cls: 0 for cls in classes}
    jaffe_regex = re.compile(r'^[A-Z]{2}\.([A-Z]{2})\d*\.\d+\.jpg$', re.I)

    for idx, fname in enumerate(files):
        img_path = os.path.join(source_dir, fname)
        img_bgr = cv2.imread(img_path)
        if img_bgr is None:
            continue

        face_rgb, bbox = detector.extract_face(img_bgr, target_size=(224, 224))
        
        # Determine label:
        # 1. Check if JAFFE dataset (explicit ground truth)
        m = jaffe_regex.match(fname)
        if m and m.group(1).upper() in JAFFE_MAP:
            label = JAFFE_MAP[m.group(1).upper()]
        else:
            # 2. For unannotated images, use pretrained SOTA FER model inference
            pil_img = Image.fromarray(face_rgb)
            inputs = processor(images=pil_img, return_tensors='pt')
            with torch.no_grad():
                outputs = model(**inputs)
                probs = torch.softmax(outputs.logits, dim=1)[0]
                pred_idx = torch.argmax(probs).item()
                raw_label = model.config.id2label[pred_idx].lower()
                # Normalize label naming
                if raw_label in ['angry', 'anger']:
                    label = 'anger'
                elif raw_label in ['happiness', 'happy']:
                    label = 'happy'
                elif raw_label in ['sadness', 'sad']:
                    label = 'sad'
                elif raw_label in ['fearful', 'fear']:
                    label = 'fear'
                elif raw_label in ['disgusted', 'disgust']:
                    label = 'disgust'
                elif raw_label in ['surprised', 'surprise']:
                    label = 'surprise'
                else:
                    label = 'neutral'

        out_path = os.path.join(output_dir, label, fname)
        cv2.imwrite(out_path, cv2.cvtColor(face_rgb, cv2.COLOR_RGB2BGR))
        stats[label] += 1

    print('=== Dataset Standardization Complete ===')
    for cls, cnt in stats.items():
        print(f'  - {cls:10s}: {cnt} cropped images')
    print(f'Total processed: {sum(stats.values())} images in {output_dir}')

if __name__ == '__main__':
    build_dataset()
