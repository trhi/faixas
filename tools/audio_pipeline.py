#!/usr/bin/env python3
from __future__ import annotations

import argparse
import math
import json
import re
import shutil
import subprocess
import sys
import unicodedata
from array import array
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


DEFAULT_MODEL = "small"
DEFAULT_LANGUAGE = "pt"
DEFAULT_PAD_BEFORE_MS = 100
DEFAULT_PAD_AFTER_MS = 300
DEFAULT_FADE_IN_MS = 100
DEFAULT_FADE_OUT_MS = 300
DEFAULT_SAMPLE_RATE = 48000
DEFAULT_BITRATE = "128k"
DEFAULT_REFINE_WINDOW_MS = 180
DEFAULT_ALIGNMENT_MODE = "whisperx"
DEFAULT_SENTENCE_PAD_MS = 700
DEFAULT_ALIGN_DEVICE = "cpu"
ANALYSIS_SAMPLE_RATE = 16000
ANALYSIS_FRAME_MS = 10


@dataclass
class WordTiming:
    token: str
    raw: str
    start: float
    end: float


@dataclass
class FragmentSpec:
    sentence_id: int
    fragment_id: int
    line_number: int
    text: str
    tokens: list[str]


@dataclass
class SentenceSpec:
    sentence_id: int
    fragments: list[dict]
    text: str
    rough_start: float
    rough_end: float


def ensure_ffmpeg() -> None:
    if shutil.which("ffmpeg") is None:
        raise SystemExit("ffmpeg was not found in PATH.")


def load_whisper_model(model_name: str, device: str, compute_type: str):
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise SystemExit(
            "Missing dependency: faster-whisper. Install with "
            "`python3 -m pip install -r requirements-audio.txt`."
        ) from exc

    return WhisperModel(model_name, device=device, compute_type=compute_type)


def load_whisperx():
    try:
        import whisperx
    except ImportError as exc:
        raise SystemExit(
            "Missing dependency: whisperx. Install with "
            "`python3 -m pip install -r requirements-audio.txt`."
        ) from exc
    return whisperx


def normalize_text(text: str) -> str:
    text = text.lower()
    text = text.replace("’", "'").replace("`", "'")
    text = re.sub(r"[\.,!?;:\"()\[\]{}…/\\<>|@#$%^&*_+=~]", " ", text)
    text = text.replace("-", " ")
    text = text.replace("'", "")
    text = re.sub(r"\s+", " ", text).strip()
    return text


def slugify(text: str) -> str:
    text = normalize_text(text)
    text = unicodedata.normalize("NFKD", text)
    text = "".join(char for char in text if not unicodedata.combining(char))
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return text or "fragment"


def tokenize(text: str) -> list[str]:
    normalized = normalize_text(text)
    return normalized.split() if normalized else []


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def read_json(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


def list_mp3_files(input_dir: Path) -> list[Path]:
    return sorted(path for path in input_dir.rglob("*.mp3") if path.is_file())


def build_recording_id(path: Path) -> str:
    return slugify(path.stem)


def transcribe_file(model, audio_path: Path, language: str, vad_filter: bool) -> tuple[str, list[WordTiming], dict]:
    segments, info = model.transcribe(
        str(audio_path),
        language=language,
        vad_filter=vad_filter,
        word_timestamps=True,
        beam_size=5,
        best_of=5,
        condition_on_previous_text=False,
    )

    words: list[WordTiming] = []
    transcript_tokens: list[str] = []

    for segment in segments:
        for word in segment.words or []:
            token_parts = tokenize(word.word)
            if not token_parts:
                continue
            token = token_parts[0]
            words.append(
                WordTiming(
                    token=token,
                    raw=word.word.strip(),
                    start=float(word.start),
                    end=float(word.end),
                )
            )
            transcript_tokens.append(token)

    transcript = " ".join(transcript_tokens)
    info_payload = {
        "language": getattr(info, "language", language),
        "language_probability": getattr(info, "language_probability", None),
        "duration": getattr(info, "duration", None),
        "duration_after_vad": getattr(info, "duration_after_vad", None),
    }
    return transcript, words, info_payload


def save_transcription_outputs(
    output_root: Path,
    audio_path: Path,
    recording_id: str,
    transcript: str,
    words: list[WordTiming],
    info_payload: dict,
) -> None:
    transcript_path = output_root / "transcripts" / f"{recording_id}.txt"
    editable_path = output_root / "fragments_text" / f"{recording_id}.txt"
    words_path = output_root / "alignment" / f"{recording_id}.words.json"
    meta_path = output_root / "alignment" / f"{recording_id}.meta.json"

    write_text(transcript_path, transcript + "\n")
    write_text(editable_path, transcript + "\n")
    write_json(
        words_path,
        [
            {
                "token": word.token,
                "raw": word.raw,
                "start": word.start,
                "end": word.end,
            }
            for word in words
        ],
    )
    write_json(
        meta_path,
        {
            "recording_id": recording_id,
            "source_audio": str(audio_path),
            "transcript_path": str(transcript_path),
            "editable_fragments_path": str(editable_path),
            "words_path": str(words_path),
            "info": info_payload,
        },
    )


def parse_fragment_file(path: Path) -> list[FragmentSpec]:
    sentence_id = 1
    fragment_id = 0
    fragments: list[FragmentSpec] = []

    for line_number, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        text = raw_line.strip()
        if not text:
            sentence_id += 1
            fragment_id = 0
            continue

        tokens = tokenize(text)
        if not tokens:
            continue

        fragment_id += 1
        fragments.append(
            FragmentSpec(
                sentence_id=sentence_id,
                fragment_id=fragment_id,
                line_number=line_number,
                text=text,
                tokens=tokens,
            )
        )

    return fragments


def load_word_timings(path: Path) -> list[WordTiming]:
    payload = read_json(path)
    return [
        WordTiming(
            token=item["token"],
            raw=item["raw"],
            start=float(item["start"]),
            end=float(item["end"]),
        )
        for item in payload
    ]


def align_fragments(recording_id: str, words: list[WordTiming], fragments: list[FragmentSpec]) -> list[dict]:
    aligned: list[dict] = []
    cursor = 0

    for fragment in fragments:
        expected = fragment.tokens
        actual = [word.token for word in words[cursor : cursor + len(expected)]]
        if actual != expected:
            raise ValueError(
                f"{recording_id}: fragment on line {fragment.line_number} does not match transcript.\n"
                f"Expected: {' '.join(expected)}\n"
                f"Found: {' '.join(actual)}"
            )

        chunk = words[cursor : cursor + len(expected)]
        aligned.append(
            {
                "sentence_id": fragment.sentence_id,
                "fragment_id": fragment.fragment_id,
                "line_number": fragment.line_number,
                "text": fragment.text,
                "normalized_text": " ".join(fragment.tokens),
                "start": chunk[0].start,
                "end": chunk[-1].end,
                "token_count": len(expected),
                "tokens": expected,
            }
        )
        cursor += len(expected)

    if cursor != len(words):
        remainder = " ".join(word.token for word in words[cursor : cursor + 12])
        raise ValueError(
            f"{recording_id}: fragment file does not cover the full transcript. Remaining tokens: {remainder}"
        )

    return aligned


def group_fragments_by_sentence(aligned_fragments: list[dict]) -> list[SentenceSpec]:
    grouped: dict[int, list[dict]] = {}
    for fragment in aligned_fragments:
        grouped.setdefault(fragment["sentence_id"], []).append(fragment)

    sentences: list[SentenceSpec] = []
    for sentence_id in sorted(grouped):
        fragments = grouped[sentence_id]
        text = " ".join(fragment["normalized_text"] for fragment in fragments).strip()
        sentences.append(
            SentenceSpec(
                sentence_id=sentence_id,
                fragments=fragments,
                text=text,
                rough_start=fragments[0]["start"],
                rough_end=fragments[-1]["end"],
            )
        )
    return sentences


def format_seconds(value: float) -> str:
    return f"{value:.3f}"


def decode_audio_window(
    source_audio: Path,
    start_time: float,
    duration: float,
    sample_rate: int = ANALYSIS_SAMPLE_RATE,
) -> list[float]:
    command = [
        "ffmpeg",
        "-v",
        "error",
        "-ss",
        format_seconds(max(0.0, start_time)),
        "-i",
        str(source_audio),
        "-t",
        format_seconds(max(0.001, duration)),
        "-vn",
        "-ac",
        "1",
        "-ar",
        str(sample_rate),
        "-f",
        "f32le",
        "-",
    ]
    result = subprocess.run(command, check=True, capture_output=True)
    samples = array("f")
    samples.frombytes(result.stdout)
    return list(samples)


def smooth(values: list[float], radius: int) -> list[float]:
    if not values or radius <= 0:
        return values[:]
    smoothed: list[float] = []
    for index in range(len(values)):
        start = max(0, index - radius)
        end = min(len(values), index + radius + 1)
        smoothed.append(sum(values[start:end]) / (end - start))
    return smoothed


def frame_rms(samples: list[float], samples_per_frame: int) -> list[float]:
    if samples_per_frame <= 0:
        return []
    energies: list[float] = []
    for start in range(0, len(samples), samples_per_frame):
        frame = samples[start : start + samples_per_frame]
        if len(frame) < max(8, samples_per_frame // 4):
            break
        mean_square = sum(sample * sample for sample in frame) / len(frame)
        energies.append(math.sqrt(mean_square))
    return energies


def refine_start_boundary(
    energies: list[float],
    boundary_frame: int,
    search_frames: int,
) -> int:
    if not energies:
        return boundary_frame

    window_end = min(len(energies), boundary_frame + search_frames + 1)
    if boundary_frame >= window_end:
        return boundary_frame

    future = energies[boundary_frame:window_end]
    peak = max(future) if future else 0.0
    if peak <= 0.0:
        return boundary_frame

    threshold = max(peak * 0.3, 0.008)
    best_index = boundary_frame

    for index in range(boundary_frame, window_end):
        current = energies[index]
        previous = energies[index - 1] if index > 0 else 0.0
        if current >= threshold and current > previous * 1.15:
            best_index = index
            break

    return best_index


def refine_end_boundary(
    energies: list[float],
    boundary_frame: int,
    search_frames: int,
) -> int:
    if not energies:
        return boundary_frame

    peak = max(energies) if energies else 0.0
    if peak <= 0.0:
        return boundary_frame

    threshold = max(peak * 0.22, 0.006)
    window_end = min(len(energies), boundary_frame + search_frames + 1)
    if boundary_frame >= window_end:
        return boundary_frame

    for index in range(boundary_frame, window_end):
        current = energies[index]
        next_value = energies[index + 1] if index + 1 < len(energies) else current
        if current <= threshold and next_value <= threshold:
            return index

    return boundary_frame


def refine_fragment_boundaries(
    source_audio: Path,
    fragment_start: float,
    fragment_end: float,
    refine_window_ms: int,
) -> tuple[float, float]:
    window_seconds = refine_window_ms / 1000.0
    analysis_start = max(0.0, fragment_start - window_seconds)
    analysis_end = fragment_end + window_seconds
    samples = decode_audio_window(source_audio, analysis_start, analysis_end - analysis_start)
    samples_per_frame = max(1, int(ANALYSIS_SAMPLE_RATE * (ANALYSIS_FRAME_MS / 1000.0)))
    energies = smooth(frame_rms(samples, samples_per_frame), radius=2)
    if not energies:
      return fragment_start, fragment_end

    frames_per_second = 1000.0 / ANALYSIS_FRAME_MS
    start_frame = max(0, min(len(energies) - 1, int((fragment_start - analysis_start) * frames_per_second)))
    end_frame = max(start_frame, min(len(energies) - 1, int((fragment_end - analysis_start) * frames_per_second)))
    search_frames = max(1, int(window_seconds * frames_per_second))

    refined_start_frame = refine_start_boundary(energies, start_frame, search_frames)
    refined_end_frame = refine_end_boundary(energies, end_frame, search_frames)
    if refined_end_frame <= refined_start_frame:
        refined_end_frame = max(refined_start_frame + 1, end_frame)

    refined_start = analysis_start + (refined_start_frame * ANALYSIS_FRAME_MS / 1000.0)
    refined_end = analysis_start + (refined_end_frame * ANALYSIS_FRAME_MS / 1000.0)
    refined_end = max(refined_end, refined_start + 0.04)
    return refined_start, refined_end


def normalize_alignment_token(text: str) -> str:
    tokens = tokenize(text)
    return tokens[0] if tokens else ""


def align_sentence_with_whisperx(
    source_audio: Path,
    sentence: SentenceSpec,
    audio,
    whisperx,
    align_model,
    metadata,
    device: str,
    sentence_pad_ms: int,
) -> list[dict] | None:
    segment_start = max(0.0, sentence.rough_start - (sentence_pad_ms / 1000.0))
    segment_end = sentence.rough_end + (sentence_pad_ms / 1000.0)
    segment = {
        "start": segment_start,
        "end": segment_end,
        "text": sentence.text,
    }

    result = whisperx.align(
        [segment],
        align_model,
        metadata,
        audio,
        device,
        return_char_alignments=False,
    )
    segments = result.get("segments") or []
    if not segments:
        return None

    aligned_words = []
    for word in segments[0].get("words") or []:
        token = normalize_alignment_token(word.get("word", ""))
        if not token:
            continue
        start = word.get("start")
        end = word.get("end")
        if start is None or end is None:
            continue
        aligned_words.append(
            {
                "token": token,
                "start": float(start),
                "end": float(end),
            }
        )

    if not aligned_words:
        return None

    cursor = 0
    aligned_fragments: list[dict] = []
    for fragment in sentence.fragments:
        expected = fragment["tokens"]
        actual = [word["token"] for word in aligned_words[cursor : cursor + len(expected)]]
        if actual != expected:
            return None

        chunk = aligned_words[cursor : cursor + len(expected)]
        aligned_fragments.append(
            {
                **fragment,
                "aligned_start": chunk[0]["start"],
                "aligned_end": chunk[-1]["end"],
                "alignment_mode": "whisperx",
            }
        )
        cursor += len(expected)

    if cursor != len(aligned_words):
        trailing = [word["token"] for word in aligned_words[cursor:]]
        if trailing:
            return None

    return aligned_fragments


def align_fragments_with_whisperx(
    source_audio: Path,
    recording_id: str,
    aligned_fragments: list[dict],
    device: str,
    sentence_pad_ms: int,
    language_code: str,
) -> list[dict]:
    whisperx = load_whisperx()
    audio = whisperx.load_audio(str(source_audio))
    align_model, metadata = whisperx.load_align_model(language_code=language_code, device=device)

    resolved_fragments: list[dict] = []
    for sentence in group_fragments_by_sentence(aligned_fragments):
        sentence_fragments = align_sentence_with_whisperx(
            source_audio=source_audio,
            sentence=sentence,
            audio=audio,
            whisperx=whisperx,
            align_model=align_model,
            metadata=metadata,
            device=device,
            sentence_pad_ms=sentence_pad_ms,
        )

        if sentence_fragments is None:
            print(
                f"Warning: WhisperX alignment failed for sentence {sentence.sentence_id} in {recording_id}. "
                "Falling back to rough timings for that sentence.",
                file=sys.stderr,
            )
            for fragment in sentence.fragments:
                resolved_fragments.append(
                    {
                        **fragment,
                        "aligned_start": fragment["start"],
                        "aligned_end": fragment["end"],
                        "alignment_mode": "rough-fallback",
                    }
                )
            continue

        resolved_fragments.extend(sentence_fragments)

    return resolved_fragments


def run_ffmpeg_cut(
    source_audio: Path,
    destination: Path,
    start_time: float,
    end_time: float,
    fade_in_ms: int,
    fade_out_ms: int,
    sample_rate: int,
    bitrate: str,
) -> None:
    duration = max(0.001, end_time - start_time)
    fade_in_seconds = min(duration, fade_in_ms / 1000.0)
    fade_out_seconds = min(duration, fade_out_ms / 1000.0)
    fade_out_start = max(0.0, duration - fade_out_seconds)

    filter_chain = (
        f"afade=t=in:st=0:d={format_seconds(fade_in_seconds)},"
        f"afade=t=out:st={format_seconds(fade_out_start)}:d={format_seconds(fade_out_seconds)}"
    )

    command = [
        "ffmpeg",
        "-y",
        "-ss",
        format_seconds(start_time),
        "-i",
        str(source_audio),
        "-t",
        format_seconds(duration),
        "-vn",
        "-ac",
        "1",
        "-ar",
        str(sample_rate),
        "-af",
        filter_chain,
        "-codec:a",
        "libmp3lame",
        "-b:a",
        bitrate,
        str(destination),
    ]
    subprocess.run(command, check=True, capture_output=True, text=True)


def collect_manifest(output_root: Path) -> list[dict]:
    manifest_path = output_root / "manifest.json"
    if manifest_path.exists():
        payload = read_json(manifest_path)
        if isinstance(payload, list):
            return payload
    return []


def save_manifest(output_root: Path, manifest: list[dict]) -> None:
    write_json(output_root / "manifest.json", manifest)

    by_text: dict[str, list[str]] = {}
    for item in manifest:
        by_text.setdefault(item["normalized_text"], []).append(item["file"])

    write_json(output_root / "variants_by_text.json", by_text)


def cut_fragments(
    source_audio: Path,
    recording_id: str,
    aligned_fragments: list[dict],
    output_root: Path,
    pad_before_ms: int,
    pad_after_ms: int,
    fade_in_ms: int,
    fade_out_ms: int,
    sample_rate: int,
    bitrate: str,
    refine_window_ms: int,
    alignment_mode: str,
) -> list[dict]:
    snippets_root = output_root / "snippets" / recording_id
    snippets_root.mkdir(parents=True, exist_ok=True)
    manifest_entries: list[dict] = []

    for fragment in aligned_fragments:
        stem = (
            f"{recording_id}__s{fragment['sentence_id']:03d}"
            f"__f{fragment['fragment_id']:03d}__{slugify(fragment['normalized_text'])}"
        )
        destination = snippets_root / f"{stem}.mp3"

        aligned_start = fragment.get("aligned_start", fragment["start"])
        aligned_end = fragment.get("aligned_end", fragment["end"])

        if alignment_mode == "rough":
            refined_start, refined_end = refine_fragment_boundaries(
                source_audio=source_audio,
                fragment_start=aligned_start,
                fragment_end=aligned_end,
                refine_window_ms=refine_window_ms,
            )
        else:
            refined_start, refined_end = aligned_start, aligned_end

        padded_start = max(0.0, refined_start - (pad_before_ms / 1000.0))
        padded_end = refined_end + (pad_after_ms / 1000.0)

        run_ffmpeg_cut(
            source_audio=source_audio,
            destination=destination,
            start_time=padded_start,
            end_time=padded_end,
            fade_in_ms=fade_in_ms,
            fade_out_ms=fade_out_ms,
            sample_rate=sample_rate,
            bitrate=bitrate,
        )

        manifest_entries.append(
            {
                "recording_id": recording_id,
                "sentence_id": fragment["sentence_id"],
                "fragment_id": fragment["fragment_id"],
                "text": fragment["text"],
                "normalized_text": fragment["normalized_text"],
                "tokens": fragment["tokens"],
                "source_start": fragment["start"],
                "source_end": fragment["end"],
                "aligned_start": aligned_start,
                "aligned_end": aligned_end,
                "refined_start": refined_start,
                "refined_end": refined_end,
                "padded_start": padded_start,
                "padded_end": padded_end,
                "pad_before_ms": pad_before_ms,
                "pad_after_ms": pad_after_ms,
                "fade_in_ms": fade_in_ms,
                "fade_out_ms": fade_out_ms,
                "refine_window_ms": refine_window_ms,
                "alignment_mode": fragment.get("alignment_mode", alignment_mode),
                "file": str(destination.relative_to(output_root)),
            }
        )

    return manifest_entries


def command_transcribe(args: argparse.Namespace) -> None:
    ensure_ffmpeg()
    input_dir = Path(args.input_dir).resolve()
    output_root = Path(args.output_dir).resolve()
    output_root.mkdir(parents=True, exist_ok=True)

    files = list_mp3_files(input_dir)
    if not files:
        raise SystemExit(f"No .mp3 files found in {input_dir}")

    model = load_whisper_model(args.model, args.device, args.compute_type)

    for audio_path in files:
        recording_id = build_recording_id(audio_path)
        print(f"Transcribing {audio_path.name} -> {recording_id}")
        transcript, words, info_payload = transcribe_file(
            model=model,
            audio_path=audio_path,
            language=args.language,
            vad_filter=not args.disable_vad,
        )
        save_transcription_outputs(
            output_root=output_root,
            audio_path=audio_path,
            recording_id=recording_id,
            transcript=transcript,
            words=words,
            info_payload=info_payload,
        )


def command_cut(args: argparse.Namespace) -> None:
    ensure_ffmpeg()
    input_dir = Path(args.input_dir).resolve()
    output_root = Path(args.output_dir).resolve()
    manifest = collect_manifest(output_root)

    for audio_path in list_mp3_files(input_dir):
        recording_id = build_recording_id(audio_path)
        fragment_file = output_root / "fragments_text" / f"{recording_id}.txt"
        words_file = output_root / "alignment" / f"{recording_id}.words.json"
        aligned_file = output_root / "alignment" / f"{recording_id}.fragments.json"

        if not fragment_file.exists():
            raise SystemExit(f"Missing fragment file for {recording_id}: {fragment_file}")
        if not words_file.exists():
            raise SystemExit(f"Missing timing file for {recording_id}: {words_file}")

        words = load_word_timings(words_file)
        fragments = parse_fragment_file(fragment_file)
        rough_aligned = align_fragments(recording_id, words, fragments)

        if args.alignment_mode == "whisperx":
            aligned = align_fragments_with_whisperx(
                source_audio=audio_path,
                recording_id=recording_id,
                aligned_fragments=rough_aligned,
                device=args.align_device,
                sentence_pad_ms=args.sentence_pad_ms,
                language_code=args.language,
            )
        else:
            print(
                f"Warning: using legacy rough alignment mode for {recording_id}. "
                "This is kept for fallback/debug and is not the recommended workflow.",
                file=sys.stderr,
            )
            aligned = [
                {
                    **fragment,
                    "aligned_start": fragment["start"],
                    "aligned_end": fragment["end"],
                    "alignment_mode": "rough",
                }
                for fragment in rough_aligned
            ]

        write_json(aligned_file, aligned)

        print(f"Cutting {audio_path.name} -> {len(aligned)} fragments")
        manifest = [entry for entry in manifest if entry["recording_id"] != recording_id]
        manifest.extend(
            cut_fragments(
                source_audio=audio_path,
                recording_id=recording_id,
                aligned_fragments=aligned,
                output_root=output_root,
                pad_before_ms=args.pad_before_ms,
                pad_after_ms=args.pad_after_ms,
                fade_in_ms=args.fade_in_ms,
                fade_out_ms=args.fade_out_ms,
                sample_rate=args.sample_rate,
                bitrate=args.bitrate,
                refine_window_ms=args.refine_window_ms,
                alignment_mode=args.alignment_mode,
            )
        )

    manifest.sort(key=lambda item: (item["normalized_text"], item["recording_id"], item["sentence_id"], item["fragment_id"]))
    save_manifest(output_root, manifest)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Offline transcription and fragment cutting pipeline.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    transcribe_parser = subparsers.add_parser("transcribe", help="Transcribe every MP3 file in a folder.")
    transcribe_parser.add_argument("--input-dir", required=True, help="Folder containing source MP3 files.")
    transcribe_parser.add_argument(
        "--output-dir",
        default="data/audio/fragments",
        help="Workspace for transcripts, alignment files, and output metadata.",
    )
    transcribe_parser.add_argument("--model", default=DEFAULT_MODEL, help="faster-whisper model name.")
    transcribe_parser.add_argument("--language", default=DEFAULT_LANGUAGE, help="Language hint passed to Whisper.")
    transcribe_parser.add_argument("--device", default="auto", help="Whisper device, for example auto, cpu, or cuda.")
    transcribe_parser.add_argument(
        "--compute-type",
        default="auto",
        help="faster-whisper compute type, for example auto, int8, or float16.",
    )
    transcribe_parser.add_argument("--disable-vad", action="store_true", help="Disable voice activity detection.")
    transcribe_parser.set_defaults(func=command_transcribe)

    cut_parser = subparsers.add_parser("cut", help="Cut MP3 snippets from edited fragment files.")
    cut_parser.add_argument("--input-dir", required=True, help="Folder containing source MP3 files.")
    cut_parser.add_argument(
        "--output-dir",
        default="data/audio/fragments",
        help="Workspace created by the transcribe command.",
    )
    cut_parser.add_argument(
        "--alignment-mode",
        choices=("whisperx", "rough"),
        default=DEFAULT_ALIGNMENT_MODE,
        help="Alignment strategy for final cuts. Use whisperx unless you are debugging the legacy rough mode.",
    )
    cut_parser.add_argument(
        "--language",
        default=DEFAULT_LANGUAGE,
        help="Language code passed to WhisperX alignment.",
    )
    cut_parser.add_argument(
        "--align-device",
        default=DEFAULT_ALIGN_DEVICE,
        help="Device used by WhisperX alignment, for example cpu or cuda.",
    )
    cut_parser.add_argument(
        "--sentence-pad-ms",
        type=int,
        default=DEFAULT_SENTENCE_PAD_MS,
        help="Extra context added around each sentence before WhisperX alignment.",
    )
    cut_parser.add_argument(
        "--pad-before-ms",
        type=int,
        default=DEFAULT_PAD_BEFORE_MS,
        help="Padding added before each fragment onset.",
    )
    cut_parser.add_argument(
        "--pad-after-ms",
        type=int,
        default=DEFAULT_PAD_AFTER_MS,
        help="Padding added after each fragment end.",
    )
    cut_parser.add_argument(
        "--fade-in-ms",
        type=int,
        default=DEFAULT_FADE_IN_MS,
        help="Fade in duration.",
    )
    cut_parser.add_argument(
        "--fade-out-ms",
        type=int,
        default=DEFAULT_FADE_OUT_MS,
        help="Fade out duration.",
    )
    cut_parser.add_argument(
        "--refine-window-ms",
        type=int,
        default=DEFAULT_REFINE_WINDOW_MS,
        help="Local search window for onset/offset refinement used only by the legacy rough mode.",
    )
    cut_parser.add_argument(
        "--sample-rate",
        type=int,
        default=DEFAULT_SAMPLE_RATE,
        help="Output sample rate in Hz. Defaults to 48000 to preserve recording quality.",
    )
    cut_parser.add_argument("--bitrate", default=DEFAULT_BITRATE, help="Output MP3 bitrate.")
    cut_parser.set_defaults(func=command_cut)

    return parser


def main(argv: Iterable[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        args.func(args)
    except subprocess.CalledProcessError as exc:
        sys.stderr.write(exc.stderr or str(exc))
        return exc.returncode or 1
    except ValueError as exc:
        sys.stderr.write(f"{exc}\n")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
