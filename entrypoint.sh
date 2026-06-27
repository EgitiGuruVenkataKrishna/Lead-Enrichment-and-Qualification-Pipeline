#!/bin/sh
# Use the PORT environment variable provided by Railway, default to 8000
PORT=${PORT:-8000}
python -m uvicorn main:app --host 0.0.0.0 --port $PORT