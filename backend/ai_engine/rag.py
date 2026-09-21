"""Per-user, opt-in local document retrieval.

Generic chat deliberately does not retrieve from uploaded files. Callers must use the
document endpoint, which keeps private uploads isolated per authenticated user.
"""

from __future__ import annotations

import hashlib
import logging
import os
import shutil
import threading
from pathlib import Path

from fastapi import UploadFile

logger = logging.getLogger(__name__)

MODEL_CACHE = Path(__file__).resolve().parent.parent / "models_cache"
CHROMA_DIR = Path(os.getenv("CHROMA_DIR", Path(__file__).resolve().parent.parent / "chroma_db"))
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", Path(__file__).resolve().parent.parent / "temp_uploads"))
MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
ALLOWED_EXTENSIONS = {".pdf", ".txt"}

_model_lock = threading.Lock()
cross_encoder = None
embeddings = None
MODELS_READY = False


def init_models() -> bool:
    """Lazily initialize heavy local models only when document RAG is requested."""
    global cross_encoder, embeddings, MODELS_READY
    if MODELS_READY:
        return True
    with _model_lock:
        if MODELS_READY:
            return True
        try:
            from langchain_huggingface import HuggingFaceEmbeddings
            from sentence_transformers import CrossEncoder

            MODEL_CACHE.mkdir(parents=True, exist_ok=True)
            cross_encoder = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2", cache_dir=str(MODEL_CACHE))
            embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2", cache_folder=str(MODEL_CACHE))
            MODELS_READY = True
            logger.info("Local document-retrieval models loaded")
            return True
        except Exception as exc:
            logger.exception("Document-retrieval model initialization failed: %s", exc)
            return False


def _collection_name(user_id: str) -> str:
    digest = hashlib.sha256(user_id.encode("utf-8")).hexdigest()
    return f"serenova_{digest[:24]}"


def _vector_store(user_id: str):
    if not init_models():
        raise RuntimeError("Document search is unavailable. Install the RAG dependencies and model runtime, then try again.")
    from langchain_chroma import Chroma

    CHROMA_DIR.mkdir(parents=True, exist_ok=True)
    return Chroma(
        collection_name=_collection_name(user_id),
        embedding_function=embeddings,
        persist_directory=str(CHROMA_DIR),
    )


def _safe_upload_path(filename: str) -> Path:
    safe_name = Path(filename or "").name
    extension = Path(safe_name).suffix.lower()
    if not safe_name or extension not in ALLOWED_EXTENSIONS:
        raise ValueError("Only PDF and TXT files are supported.")
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    return UPLOAD_DIR / f"{hashlib.sha256(os.urandom(32)).hexdigest()}{extension}"


def process_document(file: UploadFile, user_id: str) -> str:
    """Index one authenticated user's document into their isolated collection."""
    destination = _safe_upload_path(file.filename or "")
    copied = 0
    try:
        with destination.open("wb") as buffer:
            while chunk := file.file.read(1024 * 1024):
                copied += len(chunk)
                if copied > MAX_DOCUMENT_BYTES:
                    raise ValueError("The document is larger than the 10 MB limit.")
                buffer.write(chunk)

        from langchain_community.document_loaders import PyPDFLoader, TextLoader
        from langchain_text_splitters import RecursiveCharacterTextSplitter

        loader = PyPDFLoader(str(destination)) if destination.suffix == ".pdf" else TextLoader(str(destination), encoding="utf-8")
        documents = loader.load()
        chunks = RecursiveCharacterTextSplitter(chunk_size=1_000, chunk_overlap=150).split_documents(documents)
        if not chunks:
            raise ValueError("No readable text was found in that document.")
        for chunk in chunks:
            chunk.metadata = {**chunk.metadata, "source": Path(file.filename or "document").name}
        _vector_store(user_id).add_documents(chunks)
        return f"Indexed {len(chunks)} chunks from {Path(file.filename or 'document').name}."
    finally:
        if destination.exists():
            destination.unlink()


def retrieve_document_context(query: str, user_id: str, limit: int = 3) -> str:
    """Return the most relevant text, or an empty string when this user has no match."""
    store = _vector_store(user_id)
    docs = store.similarity_search(query, k=8)
    if not docs:
        return ""

    if cross_encoder is not None:
        scores = cross_encoder.predict([[query, doc.page_content] for doc in docs])
        docs = [doc for _, doc in sorted(zip(scores, docs), key=lambda item: item[0], reverse=True)]

    selected = docs[:limit]
    return "\n\n".join(
        f"[Source: {doc.metadata.get('source', 'uploaded document')}]\n{doc.page_content[:4_000]}"
        for doc in selected
    )
