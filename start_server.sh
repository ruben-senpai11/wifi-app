#!/bin/bash

# Check if script is running as root.
if [ "$EUID" -ne 0 ]; then
  echo "This script requires administrative privileges. Re-running with sudo..."
  exec sudo "$0" "$@"
fi

# Change directory to the script's location (if needed).
cd "$(dirname "$0")"

# Start your Node.js server.
node server.js
