import csv
from typing import Generator
from fastapi import FastAPI, UploadFile, File, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os
import threading
import queue
import time
from dotenv import load_dotenv

load_dotenv()

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from pydantic import ValidationError

import models
import schemas
import pipeline
import crm_sync

DATABASE_URL = "sqlite:///./leads.db"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Create tables
models.Base.metadata.create_all(bind=engine)

def seed_initial_config() -> None:
    db = SessionLocal()
    try:
        config = db.query(models.ICPConfig).first()
        if not config:
            dummy_config = models.ICPConfig(
                target_company_size="20-100",
                target_industries="B2B SaaS",
                required_tech_stack="Python, React",
                product_value_proposition="An AI-powered lead enrichment pipeline that saves 10 hours a week."
            )
            db.add(dummy_config)
            db.commit()
            print("Successfully seeded initial ICPConfig dummy data.")
    except Exception as e:
        print(f"Error seeding initial ICPConfig: {e}")
    finally:
        db.close()

# Run seed configuration
seed_initial_config()

# Background Worker Queue for Sequential Processing
lead_queue = queue.Queue()

def pipeline_worker():
    """Background thread worker that processes one lead at a time."""
    while True:
        lead_id = lead_queue.get()
        if lead_id is None:
            break
        print(f"Worker picked up lead {lead_id} from queue...")
        db = SessionLocal()
        try:
            pipeline.process_lead(lead_id, db)
        except Exception as e:
            print(f"Pipeline worker error for lead {lead_id}: {e}")
        finally:
            db.close()
            lead_queue.task_done()

# Start the worker thread
worker_thread = threading.Thread(target=pipeline_worker, daemon=True)
worker_thread.start()

app = FastAPI(title="Lead Enrichment Pipeline")

@app.on_event("startup")
def startup_event():
    """Trigger Airtable pull on startup, recover stuck leads, and prevent data loss on Railway restart."""
    db = SessionLocal()
    try:
        crm_sync.sync_airtable_to_local_db(db)
        
        # Self-healing: Reset any stuck "enriching" leads back to "pending" and re-enqueue them
        stuck_leads = db.query(models.Lead).filter(models.Lead.pipeline_status == "enriching").all()
        if stuck_leads:
            print(f"Startup: Found {len(stuck_leads)} leads stuck in 'enriching' status. Resetting and re-enqueuing...")
            for lead in stuck_leads:
                lead.pipeline_status = "pending"
                db.add(lead)
            db.commit()
            
            for lead in stuck_leads:
                lead_queue.put(lead.id)
    except Exception as e:
        print(f"Startup tasks failed: {e}")
    finally:
        db.close()

# CORS Middleware to support the Chrome Extension
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/health")
async def root():
    return {"status": "ok", "message": "Pipeline Online"}

def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()



def decode_utf8_lines(file) -> Generator[str, None, None]:
    for line in file:
        yield line.decode("utf-8-sig")

@app.post("/api/leads/upload")
async def upload_leads(
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    total_rows_processed = 0
    successful_inserts = 0
    failed_validations = 0
    valid_leads = []

    # Read and parse row-by-row using csv.DictReader to keep memory footprint low
    lines = decode_utf8_lines(file.file)
    reader = csv.DictReader(lines)

    for row in reader:
        total_rows_processed += 1
        
        # Clean empty strings to None to match DB nullability and validator logic
        raw_name = row.get("original_name")
        raw_company = row.get("original_company")
        raw_domain = row.get("email_domain")

        original_name = raw_name.strip() if raw_name else None
        original_company = raw_company.strip() if raw_company else None
        email_domain = raw_domain.strip() if raw_domain else None

        # Convert empty strings to None
        if original_name == "":
            original_name = None
        if original_company == "":
            original_company = None
        if email_domain == "":
            email_domain = None

        try:
            # Validate row using LeadCreate
            lead_in = schemas.LeadCreate(
                original_name=original_name,
                original_company=original_company,
                email_domain=email_domain
            )
            
            # Instantiate Lead model
            lead = models.Lead(
                original_name=lead_in.original_name,
                original_company=lead_in.original_company,
                email_domain=lead_in.email_domain
            )
            valid_leads.append(lead)
            successful_inserts += 1
        except ValidationError:
            failed_validations += 1

    # Bulk insert valid leads to the database
    if valid_leads:
        db.add_all(valid_leads)
        db.commit()
        
        # Extract IDs and enqueue background tasks
        lead_ids = [lead.id for lead in valid_leads]
        for lead_id in lead_ids:
            lead_queue.put(lead_id)

    return {
        "total_rows_processed": total_rows_processed,
        "successful_inserts": successful_inserts,
        "failed_validations": failed_validations
    }

@app.post("/api/leads/single")
async def create_single_lead(
    lead_in: schemas.LeadCreate,
    db: Session = Depends(get_db)
):
    lead = models.Lead(
        original_name=lead_in.original_name,
        original_company=lead_in.original_company,
        email_domain=lead_in.email_domain
    )
    db.add(lead)
    db.commit()
    db.refresh(lead)

    lead_queue.put(lead.id)

    return {
        "message": "Lead queued",
        "lead_id": lead.id,
        "status": "pending"
    }

@app.get("/api/leads/{lead_id}", response_model=schemas.LeadResponse)
async def get_lead(lead_id: int, db: Session = Depends(get_db)):
    lead = db.query(models.Lead).filter(models.Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    return lead

@app.get("/api/leads", response_model=list[schemas.LeadResponse])
async def get_all_leads(db: Session = Depends(get_db)):
    leads = db.query(models.Lead).order_by(models.Lead.id.desc()).all()
    return leads

@app.get("/api/status", response_model=list[schemas.PipelineStatusResponse])
async def get_pipeline_status(db: Session = Depends(get_db)):
    leads = db.query(models.Lead).filter(models.Lead.pipeline_status == "enriching").all()
    return [{"lead_id": l.id, "original_name": l.original_name, "original_company": l.original_company, "pipeline_status": l.pipeline_status} for l in leads]

@app.get("/api/icp", response_model=schemas.ICPConfigResponse)
async def get_icp_config(db: Session = Depends(get_db)):
    config = db.query(models.ICPConfig).first()
    if not config:
        raise HTTPException(status_code=404, detail="ICP Config not found")
    return config

@app.post("/api/icp", response_model=schemas.ICPConfigResponse)
async def update_icp_config(icp_in: schemas.ICPConfigCreate, db: Session = Depends(get_db)):
    config = db.query(models.ICPConfig).first()
    if not config:
        config = models.ICPConfig(**icp_in.model_dump())
        db.add(config)
    else:
        for k, v in icp_in.model_dump(exclude_unset=True).items():
            setattr(config, k, v)
    db.commit()
    db.refresh(config)
    return config

@app.post("/api/icp/preview")
async def preview_icp_score(icp_in: schemas.ICPConfigCreate):
    import llm_service
    sample_lead = {
        "original_name": "Jane Doe",
        "original_company": "TechStart Inc",
        "company_size": "50 employees",
        "tech_stack": "React, Python, AWS",
        "industry": "Software",
        "role": "CTO",
        "seniority": "C-Level"
    }
    result = llm_service.score_lead_against_icp(sample_lead, icp_in.model_dump())
    return result

# Create frontend directory if it doesn't exist
os.makedirs("frontend", exist_ok=True)
app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")

