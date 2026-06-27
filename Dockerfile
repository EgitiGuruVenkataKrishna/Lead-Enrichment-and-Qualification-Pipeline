# Use a slim Python image
FROM python:3.13-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    libgomp1 \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

# Make the entrypoint script executable
RUN chmod +x entrypoint.sh

# Launch via the script to guarantee shell expansion
CMD ["./entrypoint.sh"]
