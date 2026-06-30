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

## 3. Model Choices & Memory Footprint

### Model Selection

| Property | Value |
|---|---|
| **Model** | Qwen2.5-0.5B-Instruct |
| **Quantization** | Q4_0 (4-bit) |
| **File size** | ~428 MB |
| **Source** | [HuggingFace](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF) |
| **Prompt format** | ChatML (`<\|im_start\|>` / `<\|im_end\|>`) |

### Why This Model

Railway's free tier provides **512 MB RAM**. This is the binding constraint. We evaluated several models:

| Model | Disk Size | Peak RAM | Fits 512 MB? |
|---|---|---|---|
| Qwen3.5-2B Q4_K_M | ~1.4 GB | ~1.8 GB | ❌ OOM |
| Qwen2.5-1.5B Q4_K_M | ~1.0 GB | ~1.2 GB | ❌ OOM |
| Qwen2.5-0.5B Q4_K_M | ~491 MB | ~480 MB | ⚠️ Too tight |
| **Qwen2.5-0.5B Q4_0** | **~428 MB** | **~420 MB** | **✅** |
| SmolLM-135M Q8 | ~150 MB | ~200 MB | ✅ but too low quality |

Qwen2.5-0.5B-Instruct is the **largest instruction-tuned model** that fits within Railway's memory limit while still producing usable structured JSON output for lead extraction, ICP scoring, and outreach generation.

### Memory Budget

| Component | Estimated RAM |
|---|---|
| Python + FastAPI + SQLAlchemy | ~80 MB |
| llama-cpp-python runtime | ~20 MB |
| Qwen2.5-0.5B Q4_0 model (mmap'd) | ~300 MB active |
| KV-cache (n_ctx=512) | ~10 MB |
| **Total Peak** | **~410 MB** |
| **Railway Limit** | **512 MB** |
| **Headroom** | **~100 MB** |

### Memory Optimization Techniques

- **`use_mmap=True`**: Memory-maps the model file so the OS can page unused portions to disk.
- **`use_mlock=False`**: Allows the OS to swap model pages under memory pressure.
- **`n_ctx=512`**: Minimal context window reduces KV-cache allocation.
- **`n_threads=1`**: Single inference thread minimises per-thread stack overhead.
- **Aggressive prompt truncation**: Website text capped at 1200 chars, news at 400 chars.
- **Lazy singleton**: Model loaded on first request, not at import time.

### Known Quality Trade-offs

A 0.5B parameter model is small. Expect:
- Occasional JSON parsing failures (handled gracefully with fallback mock data).
- Less nuanced semantic reasoning for ICP scoring compared to larger models.
- Shorter, less polished outreach drafts.
- The system logs all LLM failures and never crashes — it degrades to mock data.

## 4. Scraping Approach & Graceful Degradation

The pipeline avoids unstable, expensive APIs in favor of direct DOM-based scraping.

- **Sources**: The scraper processes company websites, Google News feeds, and LinkedIn public profiles using `requests` and `BeautifulSoup`.
- **Known Failure Modes**: LinkedIn employs aggressive anti-scraping countermeasures. Specifically, the scraper may occasionally encounter an HTTP `999 Request denied` block.
- **Graceful Degradation**: The pipeline is engineered for resilience. If a LinkedIn request returns a `999` (or `403`/`429`) error, the pipeline catches the exception, logs the block cleanly, and continues the pipeline using the data retrieved from the company website and Google News. The system will **never** crash due to a blocked scrape.

## 5. Deployment Instructions (Railway)

This repository is tailored for easy deployment on [Railway](https://railway.app/) using Docker.

1. **Prepare the Repository**: Ensure your code is pushed to a GitHub repository.
2. **Model Hosting**: The `Dockerfile` automatically downloads `qwen2.5-0.5b-instruct-q4_0.gguf` (~428 MB) during the build step. No volume mounts or manual uploads needed.
3. **Connect to Railway**:
   - Go to the Railway dashboard, select **New Project** > **Deploy from GitHub repo**.
   - Select your lead-enrichment repository.
4. **Environment Variables**:
   In the Railway dashboard, navigate to the **Variables** tab for your service and configure:
   ```env
   USE_LOCAL_LLM=true
   AIRTABLE_API_KEY=your_api_key
   AIRTABLE_BASE_ID=your_base_id
   AIRTABLE_TABLE_NAME=Leads
   ICP_FIT_WEIGHT=0.7
   BUYING_SIGNAL_WEIGHT=0.3
   ```
5. **Build and Deploy**: Railway will automatically detect the `Dockerfile` and begin the build. The frontend will be served directly from the root `/` endpoint, and the APIs from `/api`.

> **Important**: Set `USE_LOCAL_LLM=true` in Railway's Variables tab. The `.env` file is gitignored and won't be available in the deployed container.

## 6. UI & Chrome Extension

- **Web Dashboard**: Accessible at the root URL. Built with Vanilla JS and CSS for maximum performance and easy maintenance. Features live polling for pipeline status, a sortable lead table, CSV upload preview, and detailed breakdown of outreach drafts and buying signals.
- **Chrome Extension**: Can be loaded in Developer Mode by pointing to the `chrome-extension/` directory. It communicates seamlessly with the deployed backend to enrich leads in real-time straight from LinkedIn profiles and Company Websites, displaying spinners and final score summaries directly in the popup.
