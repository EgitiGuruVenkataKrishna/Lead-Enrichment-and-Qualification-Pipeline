from sqlalchemy.orm import Session
import models
import enrichment
import llm_service
import crm_sync

def process_lead(lead_id: int, db: Session) -> None:
    lead = db.query(models.Lead).filter(models.Lead.id == lead_id).first()
    if not lead:
        return

    # Update pipeline status to enriching
    lead.pipeline_status = "enriching"
    db.commit()

    try:
        # 1. Scraping
        print(f"[pipeline] Starting scraping for lead {lead.id}...")
        raw_data = enrichment.run_raw_extraction(lead.id, db)
        print(f"[pipeline] Scraping complete for lead {lead.id}.")
        
        # 2. LLM Extraction
        print(f"[pipeline] Starting LLM structured extraction for lead {lead.id}...")
        # Concatenate linkedin_text with website_text for structured data extraction
        website_text = raw_data.get("website_text", "")
        linkedin_text = raw_data.get("linkedin_text", "")
        combined_text = website_text
        if linkedin_text:
            combined_text = f"{website_text}\n\nLinkedIn Data:\n{linkedin_text}"
            
        extracted_data = llm_service.extract_structured_data(
            combined_text,
            raw_data.get("news_text", "")
        )
        
        # Safe handling of empty extraction results
        if not extracted_data:
            print("Enrichment step skipped (Local LLM disabled) - no structured data returned")
            extracted_data = {}
            
        print(f"[pipeline] LLM structured extraction complete for lead {lead.id}.")
        
        # Database Update with enriched attributes
        for key, value in extracted_data.items():
            if key != "id" and key != "confidence_scores" and hasattr(lead, key):
                setattr(lead, key, value)
                
        # Set confidence scores
        if "confidence_scores" in extracted_data:
            lead.confidence_scores = extracted_data["confidence_scores"]
            
        # 3. ICP Scoring & Outreach Generation
        print(f"[pipeline] Starting ICP scoring for lead {lead.id}...")
        # Fetch the active ICP Configuration
        icp_config = db.query(models.ICPConfig).first()
        if icp_config:
            # Convert lead to dictionary to avoid ORM detached instance errors
            lead_dict = {
                "original_name": lead.original_name,
                "original_company": lead.original_company,
                "email_domain": lead.email_domain,
                "company_size": lead.company_size,
                "tech_stack": lead.tech_stack,
                "funding_status": lead.funding_status,
                "industry": lead.industry,
                "sub_industry": lead.sub_industry,
                "role": lead.role,
                "seniority": lead.seniority,
                "recent_news": lead.recent_news
            }
            
            # Convert icp_config to dictionary
            icp_dict = {
                "target_company_size": icp_config.target_company_size,
                "target_industries": icp_config.target_industries,
                "required_tech_stack": icp_config.required_tech_stack,
                "minimum_seniority": icp_config.minimum_seniority,
                "disqualifying_signals": icp_config.disqualifying_signals
            }
            
            # Run semantic ICP scorer
            result = llm_service.score_lead_against_icp(lead_dict, icp_dict)
            if not result:
                print("ICP Scoring step skipped (Local LLM disabled) - no ICP result returned")
                result = {}
            
            # Update lead with ICP scoring results
            lead.icp_score = result.get("score")
            lead.icp_reasoning = result.get("reasoning")
            lead.buying_signals = result.get("buying_signals")
            
            # If the lead is qualified (ICP score >= 50), generate outreach drafts
            if lead.icp_score is not None and lead.icp_score >= 50:
                print(f"[pipeline] Starting outreach drafts generation for lead {lead.id}...")
                lead_dict["icp_score"] = lead.icp_score
                lead_dict["buying_signals"] = lead.buying_signals
                lead_dict["icp_reasoning"] = lead.icp_reasoning
                
                drafts = llm_service.generate_outreach_drafts(
                    lead_dict,
                    icp_config.product_value_proposition
                )
                if not drafts:
                    print("Outreach Generation step skipped (Local LLM disabled) - no outreach drafts returned")
                    drafts = {}
                lead.outreach_drafts = drafts
                print(f"[pipeline] Outreach drafts generation complete for lead {lead.id}.")
        else:
            print("ICP Config not found in database - skipping scoring and outreach generation steps")
        print(f"[pipeline] ICP scoring complete for lead {lead.id}.")

        # 4. Sync
        print(f"[pipeline] Starting CRM sync to Airtable for lead {lead.id}...")
        sync_status = crm_sync.sync_lead_to_airtable(lead)
        lead.crm_sync_status = sync_status
        print(f"[pipeline] CRM sync to Airtable complete for lead {lead.id} (Status: {sync_status}).")
            
        lead.pipeline_status = "enriched"
        db.commit()
    except Exception as e:
        print(f"Error processing lead {lead_id}: {e}")
        lead.pipeline_status = "failed"
        db.commit()
