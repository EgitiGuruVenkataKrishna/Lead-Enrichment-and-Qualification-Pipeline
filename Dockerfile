# Use a slim Python image
FROM python:3.13-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    libgomp1 \
    gcc \
    g++ \
    wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

# Download Qwen2.5-0.5B-Instruct Q4_0 (~428 MB)
# This is the smallest instruct-tuned model that can do structured JSON extraction.
# Q4_0 chosen over Q4_K_M (491 MB) for extra RAM headroom on Railway's 512 MB limit.
# Peak RAM ~420 MB with use_mmap + n_ctx=512, fits within Railway free tier.
RUN wget -q --show-progress -O model.gguf \
    "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_0.gguf"

# Make the entrypoint script executable
RUN chmod +x entrypoint.sh

# Launch directly using shell expansion to prevent literal $PORT errors
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
