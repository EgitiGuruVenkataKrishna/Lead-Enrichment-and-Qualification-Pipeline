FROM python:3.13-slim

RUN apt-get update && apt-get install -y \
    libgomp1 \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

# Make the script executable
RUN chmod +x entrypoint.sh

# Use the script as the entrypoint
ENTRYPOINT ["./entrypoint.sh"]