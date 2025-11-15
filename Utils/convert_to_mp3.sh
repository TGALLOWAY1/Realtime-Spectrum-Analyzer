#!/bin/bash

# Convert WAV to MP3 using ffmpeg
# Usage: ./convert_to_mp3.sh

INPUT_FILE="TEST AUDIO/D#m - 140BPM - Triple M v3.wav"
OUTPUT_FILE="TEST AUDIO/D#m - 140BPM - Triple M v3.mp3"

# Check if ffmpeg is installed
if ! command -v ffmpeg &> /dev/null; then
    echo "Error: ffmpeg is not installed."
    echo "Install it with: brew install ffmpeg (on macOS)"
    exit 1
fi

# Check if input file exists
if [ ! -f "$INPUT_FILE" ]; then
    echo "Error: Input file not found: $INPUT_FILE"
    exit 1
fi

# Convert WAV to MP3
echo "Converting $INPUT_FILE to $OUTPUT_FILE..."
ffmpeg -i "$INPUT_FILE" -codec:a libmp3lame -qscale:a 2 "$OUTPUT_FILE"

if [ $? -eq 0 ]; then
    echo "Success! MP3 file created: $OUTPUT_FILE"
else
    echo "Error: Conversion failed"
    exit 1
fi

