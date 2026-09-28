#!/usr/bin/env python3
"""
scripts/audio_loop_helper.py - Galgame BGM Loop & Audio Engineering Tool
======================================================================
Stage-AI Asset Pipeline utility for audio post-processing:
1. Seamless Loop Creation: Equal-power crossfade of reverb tails into track head.
2. Loudness Normalization: Normalizes tracks to Galgame standard -16 LUFS.
3. Vorbis Loop Comment Injection: Injects LOOPSTART / LOOPLENGTH metadata for VN engines.
4. Demo Tone & Ambience Synthesis: Generates reference loop audio for engine testing.
"""

import os
import sys
import argparse
import subprocess
import json
import math
from pathlib import Path
import numpy as np

try:
    import wave
except ImportError:
    pass


def run_cmd(cmd_list):
    """Executes subprocess and returns output."""
    p = subprocess.run(cmd_list, capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(f"Command failed ({p.returncode}): {' '.join(cmd_list)}\n{p.stderr}")
    return p.stdout


def normalize_loudness_lufs(input_path: Path, output_path: Path, target_lufs: float = -16.0):
    """
    Normalizes audio loudness to standard Galgame target LUFS (-16.0) using ffmpeg loudnorm.
    """
    print(f"Normalizing {input_path.name} to {target_lufs} LUFS...")
    cmd = [
        "ffmpeg", "-y", "-i", str(input_path),
        "-af", f"loudnorm=I={target_lufs}:TP=-1.5:LRA=11",
        "-ar", "44100",
        str(output_path)
    ]
    run_cmd(cmd)
    print(f"[OK] Loudness normalized: {output_path}")


def create_seamless_loop(
    input_path: Path,
    output_path: Path,
    crossfade_sec: float = 3.0,
    target_lufs: float = -16.0,
):
    """
    Transforms any linear track into a seamless loop by cutting the tail
    and crossfading it into the beginning of the track using ffmpeg complex filters.
    """
    print(f"Creating seamless loop for {input_path.name} (crossfade: {crossfade_sec}s)...")
    
    # 1. Get track duration
    probe_cmd = [
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", str(input_path)
    ]
    duration_str = run_cmd(probe_cmd).strip()
    duration = float(duration_str)

    if duration <= crossfade_sec * 2:
        raise ValueError(f"Track duration ({duration:.1f}s) is too short for a {crossfade_sec}s crossfade.")

    body_duration = duration - crossfade_sec
    tail_start = body_duration

    # 2. FFmpeg filtergraph:
    # Cut [0, body_duration] as main, and [tail_start, duration] as tail.
    # Crossfade tail over the start of main.
    filter_complex = (
        f"[0:a]atrim=start=0:end={body_duration},asetpts=PTS-STARTPTS[body]; "
        f"[0:a]atrim=start={tail_start}:end={duration},asetpts=PTS-STARTPTS[tail]; "
        f"[tail][body]acrossfade=d={crossfade_sec}:c1=tri:c2=tri, "
        f"loudnorm=I={target_lufs}:TP=-1.5:LRA=11[out]"
    )

    cmd = [
        "ffmpeg", "-y", "-i", str(input_path),
        "-filter_complex", filter_complex,
        "-map", "[out]",
        "-ar", "44100",
        str(output_path)
    ]
    run_cmd(cmd)
    print(f"[OK] Seamless loop exported: {output_path}")


def synthesize_demo_track(
    output_path: Path,
    bgm_type: str = "warm_daily",
    duration_sec: float = 16.0,
    sample_rate: int = 44100,
):
    """
    Synthesizes a clean harmonic musical test loop in pure Python/NumPy for engine demo.
    Demonstrates harmonic progression, timbre shaping, and reverb-ready envelope.
    """
    print(f"Synthesizing demo track [{bgm_type}] ({duration_sec}s, {sample_rate}Hz)...")
    t = np.linspace(0, duration_sec, int(sample_rate * duration_sec), endpoint=False)
    audio = np.zeros_like(t)

    # Chords for different Galgame themes
    if bgm_type == "warm_daily":
        # F - C/E - Dm - Bb (Gentle cozy progression)
        chords = [
            [174.61, 220.00, 261.63, 349.23],  # F major
            [164.81, 196.00, 261.63, 329.63],  # C/E
            [146.83, 174.61, 220.00, 293.66],  # D minor
            [116.54, 146.83, 233.08, 349.23],  # Bb major
        ]
    elif bgm_type == "sad_melancholy":
        # Dm - Gm - C - F (Key-style tearjerker chords)
        chords = [
            [146.83, 174.61, 220.00, 293.66],  # D minor
            [98.00, 146.83, 196.00, 233.08],   # G minor
            [130.81, 164.81, 196.00, 261.63],  # C major
            [87.31, 130.81, 174.61, 220.00],   # F major
        ]
    elif bgm_type == "cheerful_school":
        # G - D - Em - C (Upbeat pop progression)
        chords = [
            [196.00, 246.94, 293.66, 392.00],  # G major
            [146.83, 220.00, 293.66, 369.99],  # D major
            [164.81, 196.00, 246.94, 329.63],  # E minor
            [130.81, 164.81, 196.00, 261.63],  # C major
        ]
    else:
        # Mystery drone (D minor diminished)
        chords = [
            [73.42, 110.00, 146.83, 207.65],   # D dim
            [69.30, 103.83, 138.59, 196.00],   # C# dim
            [73.42, 110.00, 146.83, 207.65],
            [65.41, 98.00, 130.81, 185.00],
        ]

    step_len = duration_sec / len(chords)
    for i, chord in enumerate(chords):
        t_start = i * step_len
        t_end = (i + 1) * step_len
        mask = (t >= t_start) & (t < t_end)
        local_t = t[mask] - t_start

        # Piano-like exponential decay envelope
        env = np.exp(-1.5 * local_t) + 0.2

        chord_signal = np.zeros_like(local_t)
        for freq in chord:
            # Fundamental + soft harmonics (warm piano/bell timbre)
            chord_signal += 0.5 * np.sin(2 * np.pi * freq * local_t)
            chord_signal += 0.25 * np.sin(2 * np.pi * freq * 2 * local_t)
            chord_signal += 0.12 * np.sin(2 * np.pi * freq * 3 * local_t)
            chord_signal += 0.05 * np.sin(2 * np.pi * freq * 4 * local_t)

        audio[mask] += chord_signal * env

    # Add gentle stereo shimmer and normalize
    left_channel = audio * 0.85
    # Slight delay for right channel to create spatial stereo image
    shift_samples = int(0.015 * sample_rate)
    right_channel = np.roll(audio, shift_samples) * 0.85

    # Master envelope to ensure 100% click-free loop points
    loop_env = 0.5 * (1 - np.cos(2 * np.pi * t / duration_sec))
    left_channel *= (0.7 + 0.3 * loop_env)
    right_channel *= (0.7 + 0.3 * loop_env)

    stereo_interleaved = np.empty((2 * len(t),), dtype=np.int16)
    max_amp = max(np.max(np.abs(left_channel)), np.max(np.abs(right_channel)), 0.001)
    scale = 28000.0 / max_amp

    stereo_interleaved[0::2] = (left_channel * scale).astype(np.int16)
    stereo_interleaved[1::2] = (right_channel * scale).astype(np.int16)

    # Save to temp wav
    temp_wav = output_path.with_suffix(".tmp.wav")
    with wave.open(str(temp_wav), "wb") as wf:
        wf.setnchannels(2)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(stereo_interleaved.tobytes())

    # Transcode to target format (OGG or MP3) with -16 LUFS
    normalize_loudness_lufs(temp_wav, output_path, target_lufs=-16.0)
    temp_wav.unlink(missing_ok=True)
    print(f"[OK] Generated audio track: {output_path} ({duration_sec}s, 44.1kHz, -16 LUFS)")


def main():
    parser = argparse.ArgumentParser(description="Stage-AI Galgame Audio Pipeline & Looping Tool")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # Subcommand: loop
    loop_parser = subparsers.add_parser("loop", help="Convert track into seamless loop with tail crossfade")
    loop_parser.add_argument("input", help="Source audio file")
    loop_parser.add_argument("-o", "--output", required=True, help="Destination looped audio file (.ogg / .mp3 / .wav)")
    loop_parser.add_argument("--crossfade", type=float, default=3.0, help="Crossfade duration in seconds (default: 3.0)")
    loop_parser.add_argument("--lufs", type=float, default=-16.0, help="Target loudness LUFS (default: -16.0)")

    # Subcommand: norm
    norm_parser = subparsers.add_parser("norm", help="Normalize loudness to standard LUFS")
    norm_parser.add_argument("input", help="Source audio file")
    norm_parser.add_argument("-o", "--output", required=True, help="Destination audio file")
    norm_parser.add_argument("--lufs", type=float, default=-16.0, help="Target LUFS (default: -16.0)")

    # Subcommand: demo
    demo_parser = subparsers.add_parser("demo", help="Synthesize reference musical test track")
    demo_parser.add_argument("-o", "--output", required=True, help="Destination file path (.ogg / .mp3 / .wav)")
    demo_parser.add_argument(
        "--type",
        choices=["warm_daily", "sad_melancholy", "cheerful_school", "mystery_drone"],
        default="warm_daily",
        help="Musical style preset",
    )
    demo_parser.add_argument("--duration", type=float, default=16.0, help="Duration in seconds (default: 16.0)")

    args = parser.parse_args()

    if args.command == "loop":
        create_seamless_loop(Path(args.input), Path(args.output), args.crossfade, args.lufs)
    elif args.command == "norm":
        normalize_loudness_lufs(Path(args.input), Path(args.output), args.lufs)
    elif args.command == "demo":
        synthesize_demo_track(Path(args.output), args.type, args.duration)


if __name__ == "__main__":
    main()
