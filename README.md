# AI Lead Enrichment Pipeline

An intelligent lead enrichment pipeline that processes incoming lead data, evaluates it against an Ideal Customer Profile (ICP), and synchronizes the results with Airtable.

## System Architecture

The application is built on a **FastAPI** backend that exposes endpoints for ingesting leads.
Lead processing, including interactions with the local Llama language model for semantic scoring and email draft generation, is handled asynchronously via a background task queue. This ensures high responsiveness and scalability for the web layer.

## Setup Instructions

1. **Clone the repository.**
2. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```
3. **Model Configuration:**
   The Llama model (`model.gguf`) must be placed in the root directory. Due to size constraints, it is excluded from source control.
4. **Environment Variables:**
   Create a `.env` file in the root directory and set the following variables:
   ```env
   AIRTABLE_API_KEY=your_api_key_here
   AIRTABLE_BASE_ID=your_base_id_here
   AIRTABLE_TABLE_NAME=your_table_name_here
   USE_LOCAL_LLM=true # Set to true to enable local LLM processing
   ```

## Deployment

This repository is optimized for deployment on **Railway**. 
- The `Procfile` is configured to run the FastAPI application using Uvicorn.
- Ensure that the `.env` variables are securely added to your Railway project's variables.
- For the `model.gguf` file, it is recommended to either mount a persistent volume in Railway or configure a download script to fetch the model from a cloud storage bucket upon startup.
