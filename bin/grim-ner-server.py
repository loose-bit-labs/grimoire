#!/usr/bin/env python3
"""
grim-ner-server.py — Grimoire NER + Relation Extraction Service

Exposes GLiNER (zero-shot NER) and Rebel (relation extraction) via HTTP.
Runs on the KB host:3773.

Routes:
  GET  /health           → status + model load state
  POST /ner              → extract named entities (GLiNER)
  POST /relations        → extract relation triples (Rebel)
  POST /extract          → NER + relations in one call

Models are loaded lazily on first request (saves ~10s at startup).
"""

import json
import logging
import os
import sys
from contextlib import asynccontextmanager
from typing import Optional

import torch
import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("grim-ner")

PORT   = int(os.environ.get("GRIMOIRE_NER_PORT", "3773"))
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

GLINER_MODEL  = os.environ.get("GLINER_MODEL",  "urchade/gliner_medium-v2.1")
REBEL_MODEL   = os.environ.get("REBEL_MODEL",   "Babelscape/rebel-large")

DEFAULT_ENTITY_TYPES = [
    "person", "project", "software", "concept", "technology",
    "organization", "event", "location", "algorithm", "dataset",
    "library", "framework", "tool", "technique", "system",
]

# ── Model registry ────────────────────────────────────────────────────────────

_models: dict = {}

def load_gliner():
    if "gliner" not in _models:
        log.info(f"Loading GLiNER model: {GLINER_MODEL}")
        from gliner import GLiNER
        _models["gliner"] = GLiNER.from_pretrained(GLINER_MODEL)
        log.info("GLiNER ready")
    return _models["gliner"]

def load_rebel():
    if "rebel" not in _models:
        log.info(f"Loading Rebel model: {REBEL_MODEL}")
        from transformers import AutoTokenizer, AutoModelForSeq2SeqLM
        tok   = AutoTokenizer.from_pretrained(REBEL_MODEL)
        model = AutoModelForSeq2SeqLM.from_pretrained(REBEL_MODEL).to(DEVICE)
        _models["rebel"] = (tok, model)
        log.info(f"Rebel ready on {DEVICE}")
    return _models["rebel"]

# ── GLiNER extraction ─────────────────────────────────────────────────────────

def run_gliner(text: str, entity_types: list[str]) -> list[dict]:
    model    = load_gliner()
    entities = model.predict_entities(text, entity_types, threshold=0.5)
    seen     = set()
    results  = []
    for e in entities:
        key = (e["text"].lower(), e["label"])
        if key not in seen:
            seen.add(key)
            results.append({"text": e["text"], "type": e["label"], "score": round(e["score"], 3)})
    results.sort(key=lambda x: -x["score"])
    return results

# ── Rebel extraction ──────────────────────────────────────────────────────────

def parse_rebel_output(text: str) -> list[dict]:
    """Parse Rebel's linearized triplet output into structured dicts."""
    triplets = []
    current  = {}
    for token in text.replace("<s>", "").replace("<pad>", "").strip().split():
        if token == "<triplet>":
            if current.get("head") and current.get("type") and current.get("tail"):
                triplets.append(current)
            current = {}
            state   = "head"
        elif token == "<subj>":
            state = "head"
        elif token == "<obj>":
            state = "tail"
        elif token == "<rel>":
            state = "type"
        else:
            if state == "head":
                current["head"] = (current.get("head", "") + " " + token).strip()
            elif state == "tail":
                current["tail"] = (current.get("tail", "") + " " + token).strip()
            elif state == "type":
                current["type"] = (current.get("type", "") + " " + token).strip()
    if current.get("head") and current.get("type") and current.get("tail"):
        triplets.append(current)
    return triplets

def run_rebel(text: str, max_length: int = 256) -> list[dict]:
    tok, model = load_rebel()
    inputs = tok(
        text,
        return_tensors="pt",
        max_length=512,
        truncation=True,
        padding=True,
    ).to(DEVICE)
    with torch.no_grad():
        outputs = model.generate(
            **inputs,
            max_length=max_length,
            num_beams=3,
            num_return_sequences=1,
        )
    decoded  = tok.batch_decode(outputs, skip_special_tokens=False)[0]
    triplets = parse_rebel_output(decoded)
    return triplets

# ── Request / response models ─────────────────────────────────────────────────

class NERRequest(BaseModel):
    text:         str
    entity_types: Optional[list[str]] = None

class RelationsRequest(BaseModel):
    text:       str
    max_length: Optional[int] = 256

class ExtractRequest(BaseModel):
    text:         str
    entity_types: Optional[list[str]] = None
    max_length:   Optional[int]       = 256

# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(title="Grimoire NER Service", version="0.1.0")

@app.get("/health")
def health():
    return {
        "status":  "ok",
        "device":  DEVICE,
        "models":  list(_models.keys()),
        "port":    PORT,
    }

@app.post("/ner")
def ner(req: NERRequest):
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="text required")
    types    = req.entity_types or DEFAULT_ENTITY_TYPES
    entities = run_gliner(req.text, types)
    return {"entities": entities, "entity_types": types}

@app.post("/relations")
def relations(req: RelationsRequest):
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="text required")
    triplets = run_rebel(req.text, max_length=req.max_length or 256)
    return {"relations": triplets}

@app.post("/extract")
def extract(req: ExtractRequest):
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="text required")
    types    = req.entity_types or DEFAULT_ENTITY_TYPES
    entities = run_gliner(req.text, types)
    triplets = run_rebel(req.text, max_length=req.max_length or 256)
    return {"entities": entities, "relations": triplets, "entity_types": types}

# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    log.info(f"Grimoire NER Service starting on 0.0.0.0:{PORT} (device={DEVICE})")
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="warning")

if __name__ == "__main__":
    main()
