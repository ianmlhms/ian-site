#!/usr/bin/env python3
"""Pre-render the Luxtram stop announcements (Zuchsimulator Lëtzebuerg) with the OpenAI text-to-speech API.

One-off tool: the clips it writes (data/luxtram/voice/*.mp3 + index.json) are committed, so a normal checkout
never needs to run it. Re-run it to add a stop or redo a clip (`--force next-hamilius-lb`).

This is NOT the voice of the real Luxtram announcer. Those recordings belong to the operator / the speaker and are
never downloaded or shipped; the clips are made with a generic synthetic voice and a spoken wording of our own.

The API key is read from the environment or from ~/.config/openai/.env and is never accepted as a command-line
argument. This repo is PUBLIC: never write the key into a file here.

Every clip: mono mp3, 32 kbit/s, trimmed of silence, a few KB. One clip per stop and language ("Nächsten Arrêt: X"),
one terminus clip for each line end, two short "exit side" clips per language.
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request

API_URL = "https://api.openai.com/v1/audio/speech"
MODEL = "gpt-4o-mini-tts"
VOICE = "coral"
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "luxtram", "voice")
INSTRUCTIONS = (
    "You are the calm, friendly female announcer of a tram in Luxembourg City. Speak clearly and unhurriedly, "
    "like an on-board stop announcement: warm, formal, slightly slower than normal speech, with a light "
    "Luxembourgish accent. Pronounce the place names the way the phonetic spelling suggests. "
    "Say only the words given, nothing else."
)

# game stop name -> spoken form (German-style phonetic respelling so the model says it the Luxembourgish way)
SPOKEN = {
    "Findel-Aéroport": "Findel Aeroport",
    "Héienhaff": "Heienhaff",
    "Luxexpo": "Luxexpo",
    "Alphonse Weicker": "Alfons Weicker",
    "Nationalbibliothéik": "Nazionalbibliotheek",
    "Universitéit": "Universitäit",
    "Coque": "Kock",
    "Europaparlament": "Europaparlament",
    "Philharmonie": "Filharmonie",
    "Rout Bréck": "Rout Breck",
    "Theater": "Theater",
    "Faïencerie": "Fajansserie",
    "Stäreplaz": "Schtäreplaz",
    "Hamilius": "Hamilius",
    "Place de Metz": "Plass de Mess",
    "Paräisser Plaz": "Päräisser Plaz",
    "Gare Centrale": "Gar Santral",
    "Leschte Steiwer": "Leschte Schteiwer",
    "Lycée Bouneweg": "Lissee Bounewek",
    "Scillas": "Scillas",
    "Gare Howald": "Gar Howald",
    "Lycée Vauban": "Lissee Vobang",
    "Waassertuerm": "Waassertuerm",
    "Stadion": "Stadion",
}
TERMINI = ["Findel-Aéroport", "Stadion", "Rout Bréck", "Gare Centrale"]

TEXT = {
    "next": {
        "lb": "Nächsten Arrêt: {n}.",
        "de": "Nächster Halt: {n}.",
        "en": "Next stop: {n}.",
    },
    "end": {
        "lb": "Endstatioun {n}. Mir bieden all Passagéier auszestigen.",
        "de": "Endstation {n}. Wir bitten alle Fahrgäste auszusteigen.",
        "en": "This is {n}, the final stop. All passengers please alight.",
    },
    "exit-left": {
        "lb": "Ausstieg op der lénkser Säit.",
        "de": "Ausstieg auf der linken Seite.",
        "en": "Exit on the left-hand side.",
    },
    "exit-right": {
        "lb": "Ausstieg op der rietser Säit.",
        "de": "Ausstieg auf der rechten Seite.",
        "en": "Exit on the right-hand side.",
    },
}
LANGS = ["lb", "de", "en"]


def slug(name):
    table = str.maketrans({"é": "e", "è": "e", "ë": "e", "ï": "i", "ä": "a", "ö": "o", "ü": "u", "ô": "o"})
    s = name.lower().translate(table)
    return "".join(c if c.isalnum() else "-" for c in s).strip("-").replace("--", "-")


def read_key():
    key = os.environ.get("OPENAI_API_KEY")
    if key:
        return key
    path = os.path.expanduser("~/.config/openai/.env")
    try:
        with open(path) as f:
            for line in f:
                if line.startswith("OPENAI_API_KEY="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    except OSError:
        pass
    sys.exit("No OPENAI_API_KEY in the environment or ~/.config/openai/.env")


def speak(key, text):
    body = json.dumps({"model": MODEL, "voice": VOICE, "input": text, "instructions": INSTRUCTIONS, "response_format": "mp3"}).encode()
    req = urllib.request.Request(API_URL, data=body, headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return resp.read()
    except urllib.error.HTTPError as e:
        sys.exit("TTS request failed: HTTP %d %s" % (e.code, e.read().decode(errors="replace")[:200]))


def compress(raw, dest):
    """mono, 32 kbit/s, leading/trailing silence trimmed."""
    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
        tmp.write(raw)
        src = tmp.name
    try:
        subprocess.run([
            "ffmpeg", "-y", "-loglevel", "error", "-i", src, "-ac", "1", "-ar", "24000",
            "-af", "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.12,areverse",
            "-b:a", "32k", dest,
        ], check=True)
    finally:
        os.unlink(src)


def jobs():
    out = []
    for lang in LANGS:
        for name, spoken in SPOKEN.items():
            out.append(("next-%s-%s" % (slug(name), lang), TEXT["next"][lang].format(n=spoken), name, "next", lang))
        for name in TERMINI:
            out.append(("end-%s-%s" % (slug(name), lang), TEXT["end"][lang].format(n=SPOKEN[name]), name, "end", lang))
        for side in ("exit-left", "exit-right"):
            out.append(("%s-%s" % (side, lang), TEXT[side][lang], None, side, lang))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", nargs="*", default=[], help="clip ids to redo (existing clips are kept)")
    ap.add_argument("--only", nargs="*", default=None, help="only these clip ids")
    args = ap.parse_args()
    os.makedirs(OUT_DIR, exist_ok=True)
    key = None
    index = {}
    for cid, text, name, kind, lang in jobs():
        if args.only is not None and cid not in args.only:
            continue
        dest = os.path.join(OUT_DIR, cid + ".mp3")
        if not os.path.exists(dest) or cid in args.force:
            key = key or read_key()
            compress(speak(key, text), dest)
            print("wrote", cid, os.path.getsize(dest), "bytes")
    for cid, text, name, kind, lang in jobs():
        dest = os.path.join(OUT_DIR, cid + ".mp3")
        if os.path.exists(dest):
            index[cid] = {"text": text, "stop": name, "kind": kind, "lang": lang, "bytes": os.path.getsize(dest)}
    with open(os.path.join(OUT_DIR, "index.json"), "w") as f:
        json.dump({"voice": "synthetic (OpenAI %s, voice %s), not the real Luxtram announcer" % (MODEL, VOICE), "clips": index}, f, ensure_ascii=False, indent=1)
    print("clips:", len(index), "total KB:", sum(c["bytes"] for c in index.values()) // 1024)


if __name__ == "__main__":
    main()
