from sentence_transformers import SentenceTransformer, CrossEncoder
import os

MODEL_CACHE = os.path.join(os.path.dirname(__file__), 'models_cache')
os.makedirs(MODEL_CACHE, exist_ok=True)

print('Downloading bi-encoder...')
model = SentenceTransformer('all-MiniLM-L6-v2', cache_folder=MODEL_CACHE)

print('Downloading cross-encoder...')
ce = CrossEncoder('cross-encoder/ms-marco-MiniLM-L-6-v2', cache_dir=MODEL_CACHE)

print('All models downloaded and cached!')
