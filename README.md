# Autonomous Lead Enrichment & Qualification Pipeline

An intelligent, self-hosted lead enrichment pipeline that processes incoming lead data, evaluates it against a dynamically configurable Ideal Customer Profile (ICP), detects buying signals, and seamlessly synchronizes the qualified leads with Airtable.

## 1. Architecture Overview

The system architecture is designed for responsiveness, stability, and modularity:
- **FastAPI Backend**: Serves as the high-performance RESTful API layer for ingesting leads (individually or in bulk via CSV).
- **Background Task Processing**: Lead enrichment, DOM scraping, and local LLM inference are computationally heavy and highly latent. These operations are orchestrated asynchronously via FastAPI background tasks. This pattern ensures the web layer never blocks, maintaining high throughput and responsiveness.
- **Local LLM Orchestration**: The pipeline utilizes a CPU-bound local Large Language Model (via `llama-cpp-python`) to perform advanced semantic extraction and reasoning without relying on expensive, rate-limited external APIs.

## 2. ICP Scoring Formula

The pipeline implements a weighted formula to calculate the final ICP score, combining both semantic ICP fit and detected buying signals.

**Formula:**
`Total Score = (ICP_FIT_SCORE * ICP_FIT_WEIGHT) + (SIGNAL_STRENGTH_SCORE * BUYING_SIGNAL_WEIGHT)`

- **ICP Fit Score**: A 0-100 score evaluating how well the lead semantically matches the configured ICP constraints (Company Size, Industry, Seniority, Tech Stack).
- **Signal Strength Score**: A derived score up to 100 based on the number and quality of detected buying signals (e.g., funding, hiring).
- **Adjustability**: The weights are controlled via environment variables (`ICP_FIT_WEIGHT` and `BUYING_SIGNAL_WEIGHT`). They can be adjusted dynamically at runtime without requiring any code changes or redeployments. 

## 3. Model & Memory Constraints

To maintain low operational costs and high privacy, the system utilizes a **local CPU-bound LLM** (provided in `.gguf` format).

- **Resource Profile**: The selected model is highly quantized, designed to maintain a memory footprint of approximately **<4 GB RAM** during active inference.
- **Railway Compatibility**: Because of this constrained memory footprint, the pipeline fits securely within Railway's free tier memory limits, preventing out-of-memory (OOM) crashes and avoiding expensive tier upgrades. 

## 4. Scraping Approach & Graceful Degradation

The pipeline avoids unstable, expensive APIs in favor of direct DOM-based scraping.

- **Sources**: The scraper processes company websites, Google News feeds, and LinkedIn public profiles using `requests` and `BeautifulSoup`.
- **Known Failure Modes**: LinkedIn employs aggressive anti-scraping countermeasures. Specifically, the scraper may occasionally encounter an HTTP `999 Request denied` block.
- **Graceful Degradation**: The pipeline is engineered for resilience. If a LinkedIn request returns a `999` (or `403`/`429`) error, the pipeline catches the exception, logs the block cleanly, and continues the pipeline using the data retrieved from the company website and Google News. The system will **never** crash due to a blocked scrape.

## 5. Deployment Instructions (Railway)

This repository is tailored for easy deployment on [Railway](https://railway.app/).

1. **Prepare the Repository**: Ensure your code is pushed to a GitHub repository.
2. **Model Hosting**: Railway's ephemeral file system will not persist the `model.gguf` file across builds if it's large. For a production deployment, either:
   - Mount a Railway Persistent Volume to `/app` and place `model.gguf` inside.
   - Modify the `Dockerfile` to `wget` or `curl` the `.gguf` file from an AWS S3 bucket or HuggingFace during the build step.
3. **Connect to Railway**:
   - Go to the Railway dashboard, select **New Project** > **Deploy from GitHub repo**.
   - Select your lead-enrichment repository.
4. **Environment Variables**:
   In the Railway dashboard, navigate to the **Variables** tab for your service and configure:
   ```env
   AIRTABLE_API_KEY=your_api_key
   AIRTABLE_BASE_ID=your_base_id
   AIRTABLE_TABLE_NAME=Leads
   USE_LOCAL_LLM=true
   ICP_FIT_WEIGHT=0.7
   BUYING_SIGNAL_WEIGHT=0.3
   ```
5. **Build and Deploy**: Railway will automatically detect the `Dockerfile` (or `Procfile`) and begin the build. Wait for the green "Active" status. Your FastAPI endpoints are now live.
