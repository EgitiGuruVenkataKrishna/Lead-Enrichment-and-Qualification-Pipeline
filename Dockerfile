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

# Download a memory-friendly micro-model for Railway free tier (~398MB)
RUN wget -O model.gguf https://huggingface.co/Qwen/Qwen1.5-0.5B-Chat-GGUF/resolve/main/qwen1_5-0_5b-chat-q4_k_m.gguf


# Make the entrypoint script executable
RUN chmod +x entrypoint.sh

# Launch via the script to guarantee shell expansion
CMD ["./entrypoint.sh"]
