"""
Automated Retraining Script for Facial Expression Recognition Pipeline.
Allows users to add new expression categories or additional labeled face images
and retrain the model with a single command.

Usage:
    python retrain.py --data_dir dataset --epochs 6 --lr 0.001 --output_dir models
"""

import os
import sys
import argparse
import json
import time
import copy
import random
import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader
from torchvision import transforms
from PIL import Image
from transformers import AutoImageProcessor, AutoModelForImageClassification

SEED = 42
random.seed(SEED)
np.random.seed(SEED)
torch.manual_seed(SEED)

BASE_MODEL_NAME = 'dima806/facial_emotions_image_detection'

class DynamicFacialDataset(Dataset):
    def __init__(self, root_dir: str, classes: list, transform=None):
        self.samples = []
        self.transform = transform
        self.class_to_idx = {cls: idx for idx, cls in enumerate(classes)}
        
        for cls in classes:
            cls_dir = os.path.join(root_dir, cls)
            if not os.path.isdir(cls_dir):
                continue
            cls_idx = self.class_to_idx[cls]
            for fname in os.listdir(cls_dir):
                if fname.lower().endswith(('.jpg', '.jpeg', '.png', '.webp', '.bmp')):
                    self.samples.append((os.path.join(cls_dir, fname), cls_idx))

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        path, label = self.samples[idx]
        image = Image.open(path).convert('RGB')
        if self.transform:
            image = self.transform(image)
        return image, label

def get_transforms():
    train_transform = transforms.Compose([
        transforms.Resize((224, 224)),
        transforms.RandomHorizontalFlip(p=0.5),
        transforms.RandomRotation(degrees=15),
        transforms.ColorJitter(brightness=0.2, contrast=0.2),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
    ])
    return train_transform

class FERClassifier(nn.Module):
    def __init__(self, base_model, num_classes: int):
        super().__init__()
        self.base_model = base_model
        for param in self.base_model.vit.parameters():
            param.requires_grad = False
            
        hidden_dim = self.base_model.classifier.in_features
        self.base_model.classifier = nn.Sequential(
            nn.Dropout(0.2),
            nn.Linear(hidden_dim, 256),
            nn.GELU(),
            nn.Dropout(0.2),
            nn.Linear(256, num_classes)
        )

    def forward(self, x):
        return self.base_model(x).logits

def retrain_model(
    data_dir: str,
    output_dir: str,
    epochs: int = 6,
    batch_size: int = 16,
    lr: float = 1e-3,
    threshold: float = 0.65
):
    os.makedirs(output_dir, exist_ok=True)
    
    # Discover all classes from subdirectories in data_dir
    classes = sorted([d for d in os.listdir(data_dir) if os.path.isdir(os.path.join(data_dir, d)) and not d.startswith('.')])
    if not classes:
        print(f"Error: No expression subdirectories found in '{data_dir}'!")
        sys.exit(1)
        
    print(f"Discovered {len(classes)} expression classes: {classes}")
    
    dataset = DynamicFacialDataset(data_dir, classes, transform=get_transforms())
    print(f"Total labeled images: {len(dataset)}")
    
    if len(dataset) == 0:
        print(f"Error: No valid images found in dataset directory '{data_dir}'!")
        sys.exit(1)
        
    loader = DataLoader(dataset, batch_size=batch_size, shuffle=True, drop_last=False)
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    print(f"Training on device: {device}")
    
    raw_base = AutoModelForImageClassification.from_pretrained(BASE_MODEL_NAME)
    model = FERClassifier(raw_base, num_classes=len(classes)).to(device)
    
    optimizer = torch.optim.AdamW(filter(lambda p: p.requires_grad, model.parameters()), lr=lr, weight_decay=1e-3)
    criterion = nn.CrossEntropyLoss()
    
    print("\n--- Training Model ---")
    model.train()
    start_t = time.time()
    for epoch in range(epochs):
        epoch_loss = 0.0
        correct = 0
        total = 0
        for images, targets in loader:
            images, targets = images.to(device), targets.to(device)
            optimizer.zero_grad()
            logits = model(images)
            loss = criterion(logits, targets)
            loss.backward()
            optimizer.step()
            
            epoch_loss += loss.item() * images.size(0)
            preds = torch.argmax(logits, dim=1)
            correct += (preds == targets).sum().item()
            total += targets.size(0)
            
        epoch_loss /= total
        acc = (correct / total) * 100
        print(f"  Epoch {epoch + 1}/{epochs} | Loss: {epoch_loss:.4f} | Training Accuracy: {acc:.2f}%")
        
    elapsed = time.time() - start_t
    print(f"\nTraining completed in {elapsed:.1f}s.")
    
    # Save compact and full checkpoints
    head_save_path = os.path.join(output_dir, 'fer_head.pt')
    class_to_idx = {cls: idx for idx, cls in enumerate(classes)}
    idx_to_class = {idx: cls for idx, cls in enumerate(classes)}
    
    torch.save({
        'classifier_state_dict': model.base_model.classifier.state_dict(),
        'classes': classes,
        'class_to_idx': class_to_idx,
        'idx_to_class': idx_to_class,
        'base_model': BASE_MODEL_NAME,
        'recommended_threshold': threshold,
        'retrained_at': time.strftime('%Y-%m-%d %H:%M:%S')
    }, head_save_path)

    full_save_path = os.path.join(output_dir, 'fer_model.pt')
    torch.save({
        'model_state_dict': model.base_model.state_dict(),
        'classes': classes,
        'class_to_idx': class_to_idx,
        'idx_to_class': idx_to_class,
        'base_model': BASE_MODEL_NAME,
        'recommended_threshold': threshold,
        'retrained_at': time.strftime('%Y-%m-%d %H:%M:%S')
    }, full_save_path)
    
    print(f"Saved compact fine-tuned checkpoint to: {head_save_path}")
    print(f"Saved full model checkpoint to: {full_save_path}")
    print(f"Ready for real-time inference with confidence threshold: {threshold}")

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Retrain Facial Expression Recognition model.")
    parser.add_argument('--data_dir', type=str, default=r'd:\Serenova-Ai-Assisstant-main\Serenova-Ai-Assisstant-main\backend\ai_engine\facial_expression\dataset', help="Path to labeled dataset directory")
    parser.add_argument('--output_dir', type=str, default=r'd:\Serenova-Ai-Assisstant-main\Serenova-Ai-Assisstant-main\backend\ai_engine\facial_expression\models', help="Directory to save model checkpoint")
    parser.add_argument('--epochs', type=int, default=6, help="Number of training epochs")
    parser.add_argument('--batch_size', type=int, default=16, help="Batch size")
    parser.add_argument('--lr', type=float, default=1e-3, help="Learning rate")
    parser.add_argument('--threshold', type=float, default=0.65, help="Confidence threshold")
    
    args = parser.parse_args()
    retrain_model(args.data_dir, args.output_dir, args.epochs, args.batch_size, args.lr, args.threshold)
