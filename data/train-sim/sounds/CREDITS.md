# Zuchsimulator Lëtzebuerg: sound credits

All vehicle sounds in the game (traction, rolling, brakes, horns, bells, doors, chimes, compressor, weather) are **synthesised in the browser**
by `pb/train-sim/audio.js` (Web Audio, procedural: no recordings, no samples, no downloads). Nothing in this folder is played by the game.

The station announcements (`data/luxtram/voice/*.mp3`) are text-to-speech clips made by `scripts/gen_luxtram_voice.py`.

## Reference material used for tuning (analysis only, not redistributed, not part of the game)

Spectra of two Wikimedia Commons recordings were looked at to check frequency ranges (door beep around 2.5 kHz, inverter lines of a tram on the order of 4 to 5 kHz).
The files were neither copied into the repository nor used as samples.

- "Tram doors open and close hiss and beeping.ogg" by stephan, public domain (https://commons.wikimedia.org/wiki/File:Tram_doors_open_and_close_hiss_and_beeping.ogg)
- "Tram sound in Lyon, France.ogg", CC BY 3.0 (https://commons.wikimedia.org/wiki/File:Tram_sound_in_Lyon,_France.ogg)
