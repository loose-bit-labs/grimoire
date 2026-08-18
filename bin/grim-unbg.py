#!/usr/bin/env python3
"""
grim-unbg — Grimoire background remover (images + video), part of project_grimoire.

BiRefNet AI matting combined with ffmpeg frame split/rejoin. Based on
https://huggingface.co/spaces/not-lain/background-removal (ZhengPeng7/BiRefNet).

Features:
- Single images: jpg, png, webp -> transparent png
- Multi-frame: gif, mp4, mkv, mov, avi, webm, m4v -> split, remove bg per frame, rejoin (alpha)
- Two backends (default: local):
    --mode local : runs BiRefNet locally (torch + transformers) — the default
    --mode api   : calls the HF Space via gradio_client using HF_TOKEN
- ffmpeg drives frame extraction / re-encoding with alpha support (VP9/webm, ProRes4444/mov, gif)

Requirements (shares the `grimoire-ner` pyenv env — see deploy/setup-ner.sh + requirements.txt):
    torch torchvision transformers Pillow gradio_client tqdm
    ffmpeg + ffprobe on PATH ( https://ffmpeg.org/ )
    Local mode: ~2GB VRAM recommended, CPU also works.

Usage (from the repo root so the grimoire-ner pyenv env is active):
    # Single image, local (default)
    pyenv exec python bin/grim-unbg.py input.jpg -o output.png

    # Video -> transparent webm (VP9 alpha), local
    pyenv exec python bin/grim-unbg.py clip.mp4

    # GIF -> transparent GIF
    pyenv exec python bin/grim-unbg.py animation.gif -o animation_nobg.gif

    # Batch a folder
    pyenv exec python bin/grim-unbg.py ./inputs/

    # Force output codec
    pyenv exec python bin/grim-unbg.py clip.mp4 --out-codec webm
    pyenv exec python bin/grim-unbg.py clip.mp4 --out-codec mov   # ProRes 4444 alpha (for editing)

    # HF API backend instead of local
    export HF_TOKEN=hf_xxx
    pyenv exec python bin/grim-unbg.py clip.mp4 --mode api
"""

import os
import sys
import argparse
import shutil
import subprocess
import tempfile
import json
from pathlib import Path
from typing import Tuple, Optional

from PIL import Image
import PIL
from tqdm import tqdm

# --- CONFIG ---
IMAGE_EXTS = {'.jpg','.jpeg','.png','.webp','.bmp','.tiff'}
VIDEO_EXTS = {'.mp4','.mkv','.mk4','.mov','.avi','.webm','.m4v','.gif'} # mk4 treated as mkv/mp4
ALL_EXTS = IMAGE_EXTS | VIDEO_EXTS

def check_ffmpeg():
    if shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None:
        print("[ERROR] ffmpeg/ffprobe not found in PATH. Install ffmpeg: https://ffmpeg.org/")
        sys.exit(1)

def get_video_info(path: Path):
    """Returns dict with fps, width, height, has_audio, duration via ffprobe"""
    cmd = [
        "ffprobe","-v","error",
        "-select_streams","v:0",
        "-show_entries","stream=avg_frame_rate,width,height,duration,codec_name",
        "-show_entries","format=duration",
        "-of","json",
        str(path)
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {result.stderr}")
    data = json.loads(result.stdout)
    stream = data['streams'][0] if data.get('streams') else {}
    # fps
    fps_str = stream.get('avg_frame_rate','25/1')
    try:
        num, den = fps_str.split('/')
        fps = float(num)/float(den) if float(den)!=0 else 25.0
    except Exception:
        fps = 25.0
    # audio check
    cmd_a = ["ffprobe","-v","error","-select_streams","a","-show_entries","stream=index","-of","csv",str(path)]
    r_a = subprocess.run(cmd_a, capture_output=True, text=True)
    has_audio = bool(r_a.stdout.strip())
    return {
        "fps": fps,
        "width": int(stream.get('width',0)),
        "height": int(stream.get('height',0)),
        "has_audio": has_audio,
        "duration": float(stream.get('duration') or data.get('format',{}).get('duration',0) or 0)
    }

# --- LOCAL BACKEND (BiRefNet) ---
class LocalRemover:
    def __init__(self):
        import torch
        from transformers import AutoModelForImageSegmentation
        from torchvision import transforms

        self.torch = torch
        self.device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
        print(f"[local] Loading BiRefNet on {self.device}...")
        self.model = AutoModelForImageSegmentation.from_pretrained(
            "ZhengPeng7/BiRefNet", trust_remote_code=True
        )
        if self.device == "cuda":
            self.model.to("cuda")
            torch.set_float32_matmul_precision("high")
        else:
            self.model.to(self.device)
        self.model.eval()

        self.transform = transforms.Compose([
            transforms.Resize((1024,1024)),
            transforms.ToTensor(),
            transforms.Normalize([0.485,0.456,0.406],[0.229,0.224,0.225]),
        ])
        print("[local] Model loaded.")

    def remove(self, image: Image.Image) -> Image.Image:
        """image -> RGBA with transparency"""
        orig_size = image.size
        im = image.convert("RGB")
        input_tensor = self.transform(im).unsqueeze(0).to(self.device)
        # Match model weight dtype (BiRefNet may load in float16 on CUDA)
        if self.model.dtype != input_tensor.dtype:
            input_tensor = input_tensor.to(dtype=self.model.dtype)
        with self.torch.no_grad():
            preds = self.model(input_tensor)[-1].sigmoid().cpu()
        pred = preds[0].squeeze()
        from torchvision import transforms as T
        mask_pil = T.ToPILImage()(pred).resize(orig_size)
        im.putalpha(mask_pil)
        return im

# --- API BACKEND (HF Space) ---
class ApiRemover:
    def __init__(self, hf_token: Optional[str]=None):
        from gradio_client import Client
        token = hf_token or os.getenv("HF_TOKEN") or os.getenv("HUGGINGFACE_HUB_TOKEN")
        if not token:
            print("[WARN] No HF_TOKEN found. API may be rate-limited. Set HF_TOKEN env var.")
        print("[api] Connecting to not-lain/background-removal...")
        # client handles token internally via env or param
        self.client = Client("not-lain/background-removal", hf_token=token)
        print("[api] Connected.")

    def remove(self, image: Image.Image) -> Image.Image:
        """Uses /png endpoint - needs file on disk"""
        from gradio_client import handle_file
        import tempfile, os
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
            image.convert("RGB").save(tmp.name)
            tmp_path = tmp.name
        try:
            # api_name="/png" returns path to transparent png
            result_path = self.client.predict(
                f=handle_file(tmp_path),
                api_name="/png"
            )
            # result_path is a local file path downloaded by gradio_client
            out_img = Image.open(result_path).convert("RGBA")
            return out_img
        finally:
            try: os.remove(tmp_path)
            except OSError: pass

    def remove_file(self, input_path: Path) -> Image.Image:
        from gradio_client import handle_file
        result_path = self.client.predict(
            f=handle_file(str(input_path)),
            api_name="/png"
        )
        return Image.open(result_path).convert("RGBA")

# --- PROCESSING HELPERS ---

def process_single_image(input_path: Path, output_path: Path, remover):
    img = Image.open(input_path)
    # handle gif single frame? If gif with multiple frames, we go video path
    if getattr(img, "is_animated", False) and img.n_frames > 1:
        raise ValueError("animated")
    out = remover.remove(img)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    out.save(output_path, "PNG")
    print(f"[image] {input_path.name} -> {output_path} ({out.size})")

def extract_frames(video_path: Path, tmp_dir: Path, target_fps: Optional[float]=None):
    info = get_video_info(video_path)
    fps = target_fps or info['fps']
    # Extract frames as PNG
    pattern = str(tmp_dir / "frame_%06d.png")
    cmd = [
        "ffmpeg","-y","-hide_banner","-loglevel","error",
        "-i", str(video_path),
        "-vf", f"fps={fps}",
        pattern
    ]
    print(f"[ffmpeg] Extracting frames at {fps:.2f} fps -> {tmp_dir}")
    subprocess.run(cmd, check=True)
    frames = sorted(tmp_dir.glob("frame_*.png"))
    # Extract audio if exists
    audio_path = None
    if info['has_audio']:
        audio_path = tmp_dir / "audio.aac"
        cmd_a = ["ffmpeg","-y","-hide_banner","-loglevel","error","-i",str(video_path),"-vn","-c:a","aac",str(audio_path)]
        subprocess.run(cmd_a, check=True)
        if not audio_path.exists() or audio_path.stat().st_size==0:
            audio_path = None
    return frames, fps, audio_path, info

def reencode_webm(frames_dir: Path, output_path: Path, fps: float, audio_path: Optional[Path]=None):
    pattern = str(frames_dir / "frame_%06d.png")
    cmd = [
        "ffmpeg","-y","-hide_banner","-loglevel","error",
        "-framerate", str(fps),
        "-i", pattern,
    ]
    if audio_path and audio_path.exists():
        cmd += ["-i", str(audio_path), "-c:v","libvpx-vp9","-b:v","0","-crf","32","-pix_fmt","yuva420p","-auto-alt-ref","0","-c:a","aac","-shortest", str(output_path)]
    else:
        cmd += ["-c:v","libvpx-vp9","-b:v","0","-crf","32","-pix_fmt","yuva420p","-auto-alt-ref","0", str(output_path)]
    print(f"[ffmpeg] Re-encoding to {output_path} (VP9 yuva420p)")
    subprocess.run(cmd, check=True)

def reencode_mov_prores(frames_dir: Path, output_path: Path, fps: float, audio_path: Optional[Path]=None):
    pattern = str(frames_dir / "frame_%06d.png")
    cmd = [
        "ffmpeg","-y","-hide_banner","-loglevel","error",
        "-framerate", str(fps),
        "-i", pattern,
    ]
    if audio_path and audio_path.exists():
        cmd += ["-i", str(audio_path)]
    cmd += ["-c:v","prores_ks","-profile:v","4444","-pix_fmt","yuva444p10le","-vendor","ap10"]
    if audio_path and audio_path.exists():
        cmd += ["-c:a","aac","-shortest", str(output_path)]
    else:
        cmd += [str(output_path)]
    print(f"[ffmpeg] Re-encoding to {output_path} (ProRes 4444)")
    subprocess.run(cmd, check=True)

def reencode_gif_pillow(frames_dir: Path, output_path: Path, fps: float):
    frames = sorted(frames_dir.glob("frame_*.png"))
    images = [Image.open(f).convert("RGBA") for f in frames]
    # For GIF transparency: create binary alpha threshold
    # Pillow needs palette + transparency
    # We'll save with disposal=2
    print(f"[pillow] Re-encoding {len(images)} frames to GIF {output_path} at {fps}fps")
    # Convert RGBA to P with transparency for smaller GIF
    # Use alpha threshold 128 for binary transparency
    gif_frames = []
    for im in images:
        # create background composite for palette generation
        alpha = im.split()[3]
        # threshold
        mask = alpha.point(lambda p: 255 if p>128 else 0)
        im_p = im.convert("RGB").convert("P", palette=Image.ADAPTIVE, colors=255)
        gif_frames.append(im_p)

    duration = int(1000 / fps) if fps>0 else 100
    gif_frames[0].save(
        str(output_path),
        save_all=True,
        append_images=gif_frames[1:],
        duration=duration,
        loop=0,
        disposal=2,
        transparency=0
    )
    # Better quality version using ffmpeg palette for binary transparency
    # Fallback to ffmpeg if pillow result looks bad
    try:
        pattern = str(frames_dir / "frame_%06d.png")
        # ffmpeg gif with transparency: first generate palette including alpha?
        # Use paletteuse with transparency
        cmd = [
            "ffmpeg","-y","-hide_banner","-loglevel","error",
            "-framerate",str(fps),"-i",pattern,
            "-vf",f"fps={fps},split[s0][s1];[s0]palettegen=max_colors=255:reserve_transparent=1[p];[s1][p]paletteuse=alpha_threshold=128",
            str(output_path)
        ]
        subprocess.run(cmd, check=True)
        print(f"[ffmpeg] GIF re-encoded with transparent palette")
    except Exception as e:
        print(f"[WARN] ffmpeg gif palette failed ({e}), using pillow version")

def process_video(input_path: Path, output_path: Path, remover, out_codec: str, target_fps: Optional[float]=None, keep_audio: bool=True):
    with tempfile.TemporaryDirectory() as tmp_root:
        tmp_root = Path(tmp_root)
        raw_dir = tmp_root / "raw"
        proc_dir = tmp_root / "processed"
        raw_dir.mkdir()
        proc_dir.mkdir()

        frames, fps, audio_path, info = extract_frames(input_path, raw_dir, target_fps)
        if not frames:
            raise RuntimeError("No frames extracted")
        print(f"[video] {len(frames)} frames extracted from {input_path.name}")

        # Process each frame
        print(f"[process] Removing background frame by frame...")
        for i, f in enumerate(tqdm(frames, desc="removing bg")):
            img = Image.open(f)
            out_img = remover.remove(img)
            out_path = proc_dir / f.name
            out_img.save(out_path, "PNG")

        # Decide output codec/path
        output_path.parent.mkdir(parents=True, exist_ok=True)
        # If output is gif but input was mp4, honor gif
        ext = output_path.suffix.lower()
        if out_codec == "auto":
            if ext in [".gif"]:
                out_codec = "gif"
            elif ext in [".mov"]:
                out_codec = "mov"
            else:
                out_codec = "webm"  # default transparent video

        # Audio handling
        if not keep_audio:
            audio_path = None

        if out_codec == "gif":
            reencode_gif_pillow(proc_dir, output_path, fps)
        elif out_codec == "mov":
            reencode_mov_prores(proc_dir, output_path, fps, audio_path)
        else: # webm
            if output_path.suffix.lower() != ".webm":
                # force webm extension if auto
                if ext not in [".webm",".mov",".gif"]:
                    output_path = output_path.with_suffix(".webm")
            reencode_webm(proc_dir, output_path, fps, audio_path)

        print(f"[done] Video saved -> {output_path}")

def main():
    parser = argparse.ArgumentParser(description="Grimoire background remover for images, gifs, mp4/mkv - local or HF API")
    parser.add_argument("input", type=str, help="Input file or folder")
    parser.add_argument("-o","--output", type=str, default=None, help="Output file or folder (default: <input>_nobg.<ext>)")
    parser.add_argument("--mode", choices=["local","api"], default="local", help="local BiRefNet or HF API via gradio_client (default: local)")
    parser.add_argument("--hf-token", type=str, default=None, help="HF token (or set HF_TOKEN env var) for API mode")
    parser.add_argument("--out-codec", choices=["auto","webm","mov","gif"], default="auto", help="Output codec for videos: webm (VP9 alpha, smallest), mov (ProRes4444, editing), gif (transparent gif). auto picks based on output extension or webm")
    parser.add_argument("--fps", type=float, default=None, help="Override fps for video output")
    parser.add_argument("--no-audio", action="store_true", help="Drop audio track from video")
    parser.add_argument("--batch", action="store_true", help="Process folder in batch mode")
    args = parser.parse_args()

    check_ffmpeg()

    input_path = Path(args.input)
    if not input_path.exists():
        print(f"[ERROR] Input not found: {input_path}")
        sys.exit(1)

    # init remover
    if args.mode == "local":
        remover = LocalRemover()
    else:
        remover = ApiRemover(hf_token=args.hf_token)

    # collect files
    if input_path.is_dir() or args.batch:
        files = [p for p in (input_path.rglob("*") if input_path.is_dir() else [input_path]) if p.suffix.lower() in ALL_EXTS]
        if not files:
            print("[ERROR] No supported files found")
            sys.exit(1)
        out_root = Path(args.output) if args.output else input_path / "nobg_output"
        out_root.mkdir(parents=True, exist_ok=True)
        print(f"[batch] {len(files)} files -> {out_root}")
        for f in files:
            try:
                if f.suffix.lower() in VIDEO_EXTS:
                    # For GIF/video, output .webm by default unless gif input
                    if f.suffix.lower() == ".gif":
                        out_path = out_root / (f.stem + "_nobg.gif")
                    else:
                        # auto webm
                        out_path = out_root / (f.stem + "_nobg.webm")
                    process_video(f, out_path, remover, args.out_codec, args.fps, keep_audio=not args.no_audio)
                else:
                    out_path = out_root / (f.stem + "_nobg.png")
                    process_single_image(f, out_path, remover)
            except Exception as e:
                print(f"[ERROR] Failed {f}: {e}")
                import traceback; traceback.print_exc()
    else:
        # single file
        f = input_path
        suffix = f.suffix.lower()
        if suffix not in ALL_EXTS:
            print(f"[WARN] Unknown extension {suffix}, trying as image")
            suffix = ".png"

        if args.output:
            out_path = Path(args.output)
        else:
            if suffix in VIDEO_EXTS:
                if suffix == ".gif":
                    out_path = f.with_name(f.stem + "_nobg.gif")
                else:
                    out_path = f.with_name(f.stem + "_nobg.webm")
            else:
                out_path = f.with_name(f.stem + "_nobg.png")

        if suffix in VIDEO_EXTS:
            # check if gif but actually single frame? process_video handles gif
            # special: if gif with 1 frame, treat as image
            try:
                with Image.open(f) as im:
                    if suffix == ".gif" and getattr(im, "n_frames", 1) == 1:
                        process_single_image(f, out_path.with_suffix(".png"), remover)
                        return
            except Exception:
                pass
            process_video(f, out_path, remover, args.out_codec, args.fps, keep_audio=not args.no_audio)
        else:
            try:
                process_single_image(f, out_path, remover)
            except ValueError as ve:
                if str(ve) == "animated":
                    # fallback to video path for animated gif/webp
                    print("[info] Animated image detected, switching to video pipeline")
                    process_video(f, out_path.with_suffix(".gif"), remover, "gif", args.fps)
                else:
                    raise

if __name__ == "__main__":
    main()
