import os
import requests
import urllib.parse
import json

AIRTABLE_API_KEY = os.getenv("AIRTABLE_API_KEY")
AIRTABLE_BASE_ID = os.getenv("AIRTABLE_BASE_ID")
AIRTABLE_TABLE_NAME = os.getenv("AIRTABLE_TABLE_NAME")

def sync_lead_to_airtable(lead) -> str:
    if not AIRTABLE_API_KEY or not AIRTABLE_BASE_ID or not AIRTABLE_TABLE_NAME:
        print("Warning: Airtable environment variables (AIRTABLE_API_KEY, AIRTABLE_BASE_ID, AIRTABLE_TABLE_NAME) are missing.")
        return "pending"

    # Construct the fields payload
    fields = {}
    
    # Map simple string and integer fields
    if lead.original_name:
        fields["original_name"] = lead.original_name
    if lead.original_company:
        fields["original_company"] = lead.original_company
    if lead.email_domain:
        fields["email_domain"] = lead.email_domain
    if lead.company_size:
        fields["company_size"] = lead.company_size
    if lead.tech_stack:
        fields["tech_stack"] = lead.tech_stack
    if lead.funding_status:
        fields["funding_status"] = lead.funding_status
    if lead.industry:
        fields["industry"] = lead.industry
    if lead.sub_industry:
        fields["sub_industry"] = lead.sub_industry
    if lead.role:
        fields["role"] = lead.role
    if lead.seniority:
        fields["seniority"] = lead.seniority
    if lead.recent_news:
        fields["recent_news"] = lead.recent_news
    if lead.pipeline_status:
        fields["pipeline_status"] = lead.pipeline_status
    if lead.icp_score is not None:
        fields["icp_score"] = lead.icp_score

    # Convert confidence_scores, buying_signals, icp_reasoning, and outreach_drafts to JSON strings
    if lead.confidence_scores is not None:
        fields["confidence_scores"] = json.dumps(lead.confidence_scores)
    if lead.buying_signals is not None:
        fields["buying_signals"] = json.dumps(lead.buying_signals)
    if lead.icp_reasoning is not None:
        fields["icp_reasoning"] = json.dumps(lead.icp_reasoning)
    if lead.outreach_drafts is not None:
        fields["outreach_drafts"] = json.dumps(lead.outreach_drafts)

    # Ensure all values in the fields dictionary are strings before sending
    # Ensure all values are strings EXCEPT for the icp_score (which must be an int)
    new_fields = {}
    for k, v in fields.items():
        if k == "icp_score":
            # Safely convert to int, default to 0 if conversion fails
            try:
                new_fields[k] = int(v)
            except (ValueError, TypeError):
                new_fields[k] = 0
        else:
            new_fields[k] = str(v)
    fields = new_fields

    # Base URL for Airtable Table
    base_url = f"https://api.airtable.com/v0/{AIRTABLE_BASE_ID}/{AIRTABLE_TABLE_NAME}"
    headers = {
        "Authorization": f"Bearer {AIRTABLE_API_KEY}",
        "Content-Type": "application/json"
    }

    try:
        # Check if record already exists by matching email_domain or original_company
        conditions = []
        if lead.email_domain:
            conditions.append(f"{{email_domain}} = '{lead.email_domain}'")
        if lead.original_company:
            conditions.append(f"{{original_company}} = '{lead.original_company}'")

        duplicate_id = None
        if conditions:
            # Build formula: e.g. OR({email_domain} = 'example.com', {original_company} = 'Acme')
            if len(conditions) > 1:
                formula = f"OR({', '.join(conditions)})"
            else:
                formula = conditions[0]
                
            encoded_formula = urllib.parse.quote(formula)
            get_url = f"{base_url}?filterByFormula={encoded_formula}"
            
            get_response = requests.get(get_url, headers=headers, timeout=10)
            if get_response.status_code == 404:
                print(f"Error 404: Airtable Base ID ({AIRTABLE_BASE_ID}) or Table Name ({AIRTABLE_TABLE_NAME}) is invalid. Details: {get_response.text}")
            get_response.raise_for_status()
            
            records = get_response.json().get("records", [])
            if records:
                duplicate_id = records[0].get("id")

        if duplicate_id:
            # Update duplicate record (PATCH)
            patch_url = f"{base_url}/{duplicate_id}"
            print("Sending PATCH to Airtable with fields:", json.dumps(fields, indent=2))
            patch_response = requests.patch(patch_url, headers=headers, json={"fields": fields}, timeout=10)
            if patch_response.status_code == 404:
                print(f"Error 404: Airtable Base ID or Table Name is invalid during PATCH request. Details: {patch_response.text}")
            patch_response.raise_for_status()
            return "synced"
        else:
            # Create new record (POST)
            print("Sending POST to Airtable with fields:", json.dumps(fields, indent=2))
            post_response = requests.post(base_url, headers=headers, json={"fields": fields}, timeout=10)
            if post_response.status_code == 404:
                print(f"Error 404: Airtable Base ID or Table Name is invalid during POST request. Details: {post_response.text}")
            post_response.raise_for_status()
            return "synced"

    except requests.exceptions.HTTPError as he:
        status_code = he.response.status_code if he.response is not None else None
        if status_code == 404:
            print(f"Error 404: Airtable Base ID or Table Name is invalid. Verify environment variables. Details: {he.response.text if he.response else ''}")
        else:
            print(f"HTTP Error during Airtable sync for lead {lead.id}: {he}")
        return "failed"
    except Exception as e:
        print(f"Error syncing lead {lead.id} to Airtable: {e}")
        return "failed"
