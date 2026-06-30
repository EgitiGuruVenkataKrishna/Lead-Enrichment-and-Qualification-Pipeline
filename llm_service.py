import os
import json
import re
import traceback
import schemas
from dotenv import load_dotenv

load_dotenv()


# Conditional import of llama_cpp to support mock mode when not installed
try:
    from llama_cpp import Llama
    LLAMA_CPP_AVAILABLE = True
except ImportError as e:
    print(f"Failed to import llama_cpp: {e}")
    traceback.print_exc()
    LLAMA_CPP_AVAILABLE = False

_llm_instance = None

def get_llm_instance():
    """Lazy singleton — creates the Llama instance only when first needed."""
    global _llm_instance
    if not LLAMA_CPP_AVAILABLE:
        return None
        
    use_local = os.getenv("USE_LOCAL_LLM", "false").lower() == "true"
    if not use_local:
        return None
        
    if _llm_instance is None:
        try:
            if not os.path.exists("model.gguf") and not os.path.exists("./model.gguf"):
                raise FileNotFoundError("MODEL_NOT_FOUND: 'model.gguf' is missing from the root directory.")
            _llm_instance = Llama(
                model_path="model.gguf",
                n_ctx=512,        # Minimal context window to save KV-cache RAM
                n_threads=1,      # 1 thread to avoid core switching contention on shared Railway CPU
                n_gpu_layers=0,   # CPU only — no GPU on Railway
                use_mmap=True,    # Memory-map the model file to reduce resident RAM
                use_mlock=False,  # Don't lock model in RAM — let OS page as needed
                verbose=False,    # Suppress llama.cpp banner to keep logs clean
            )
            print("LLM model loaded successfully (Qwen2.5-0.5B-Instruct Q4_0)")
        except Exception as e:
            if "MODEL_NOT_FOUND" in str(e) or isinstance(e, FileNotFoundError):
                print("MODEL_NOT_FOUND: 'model.gguf' file is missing in the root directory.")
            else:
                print(f"Warning: Could not initialize Llama model: {e}")
            _llm_instance = None
            
    return _llm_instance

def clean_llm_json(raw_output: str) -> dict:
    try:
        # Regex to locate the outermost JSON object
        match = re.search(r"(\{.*})", raw_output, re.DOTALL)
        if match:
            json_str = match.group(1)
            return json.loads(json_str)
    except Exception as e:
        print(f"Error parsing LLM JSON: {e}")
    return {}

def generate_dynamic_mock_profile(website_text: str, news_text: str) -> dict:
    text = (website_text or "").lower()
    
    # 1. Determine seniority
    seniority = "Mid-Level"
    if any(w in text for w in ["senior", "sr."]):
        seniority = "Senior"
    elif any(w in text for w in ["director", "head", "vp", "chief", "cto", "ceo", "cfo", "founder", "co-founder"]):
        seniority = "C-Level"
    elif any(w in text for w in ["intern", "student", "co-op"]):
        seniority = "Intern"
    elif any(w in text for w in ["junior", "jr."]):
        seniority = "Junior"
        
    # 2. Determine role
    role = "Software Engineer"
    if "cto" in text:
        role = "CTO"
    elif "ceo" in text:
        role = "CEO"
    elif "co-founder" in text:
        role = "Co-founder"
    elif "founder" in text:
        role = "Founder"
    elif "product manager" in text:
        role = "Product Manager"
    elif "designer" in text or "ux" in text:
        role = "Product Designer"
    elif "sales" in text or "account executive" in text:
        role = "Sales Executive"
    elif "marketing" in text:
        role = "Marketing Manager"
    elif "data scientist" in text or "data analyst" in text:
        role = "Data Scientist"
        
    # 3. Determine tech stack
    techs = []
    for t in ["React", "Python", "AWS", "Docker", "Kubernetes", "TypeScript", "Node.js", "Java", "Go", "Ruby"]:
        if t.lower() in text:
            techs.append(t)
    if not techs:
        techs = ["React", "Python", "AWS"] if len(text) % 2 == 0 else ["Node.js", "PostgreSQL", "GCP"]
    tech_stack = ", ".join(techs)
    
    # 4. Determine company size
    sizes = ["1-10 employees", "11-50 employees", "51-200 employees", "201-500 employees", "501-1000 employees", "1000+ employees"]
    size_idx = len(text) % len(sizes)
    company_size = sizes[size_idx]
    
    # 5. Determine industry
    industries = ["B2B SaaS", "E-commerce", "Fintech", "Healthcare Tech", "Edtech", "AI & Machine Learning"]
    ind_idx = (len(text) + 3) % len(industries)
    industry = industries[ind_idx]
    
    # 6. Funding status
    funding_list = ["Bootstrapped", "Seed", "Series A", "Series B", "Public"]
    fund_idx = (len(text) + 7) % len(funding_list)
    funding_status = funding_list[fund_idx]
    
    confidence_scores = {
        "company_size": "medium" if len(text) % 3 == 0 else "high",
        "tech_stack": "high" if len(techs) > 2 else "medium",
        "funding_status": "medium",
        "industry": "high",
        "sub_industry": "medium",
        "role": "high",
        "seniority": "high",
        "recent_news": "low" if not news_text else "high"
    }
    
    return {
        "company_size": company_size,
        "tech_stack": tech_stack,
        "funding_status": funding_status,
        "industry": industry,
        "sub_industry": f"Custom {industry} Solutions",
        "role": role,
        "seniority": seniority,
        "recent_news": news_text[:100] + "..." if news_text else "Company expanded operations recently",
        "confidence_scores": confidence_scores
    }

def extract_structured_data(website_text: str, news_text: str) -> dict:
    llm_inst = get_llm_instance()
    if llm_inst is None:
        # Return mock structured data if LLM is disabled/unavailable
        return generate_dynamic_mock_profile(website_text, news_text)

    # Aggressively truncate texts to fit within n_ctx=512
    truncated_website = website_text[:600] if website_text else ""
    truncated_news = news_text[:200] if news_text else ""

    prompt = f"""<|im_start|>system
You extract lead profile data as JSON.<|im_end|>
<|im_start|>user
Extract from this text. Reply with ONLY a JSON object, no other text.

Keys: "company_size","tech_stack","funding_status","industry","sub_industry","role","seniority","recent_news","confidence_scores"
confidence_scores maps each key to "high","medium", or "low".

Website: {truncated_website}

News: {truncated_news}
<|im_end|>
<|im_start|>assistant
"""

    try:
        response = llm_inst(
            prompt,
            max_tokens=150,
            temperature=0.1,
            stop=["<|im_end|>"]
        )
        raw_output = response["choices"][0]["text"]
        json_data = clean_llm_json(raw_output)
        
        # Validate against schema
        try:
            validated = schemas.EnrichedProfileOutput(**json_data)
            return validated.model_dump()
        except Exception as ve:
            print(f"Validation error on LLM extraction output: {ve}")
            # Ensure safe fallback structure if validation strictly fails
            safe_data = {}
            for field in schemas.EnrichedProfileOutput.model_fields:
                safe_data[field] = json_data.get(field) if isinstance(json_data, dict) else None
            
            if not isinstance(safe_data.get("confidence_scores"), dict):
                safe_data["confidence_scores"] = {
                    "company_size": "medium",
                    "tech_stack": "medium",
                    "funding_status": "medium",
                    "industry": "medium",
                    "sub_industry": "medium",
                    "role": "medium",
                    "seniority": "medium",
                    "recent_news": "medium"
                }
            return safe_data
            
    except Exception as e:
        print(f"Error during LLM extraction: {e}")
        return {}

def calculate_dynamic_mock_score(lead_data: dict, icp_config: dict) -> dict:
    score = 50
    reasons = []
    buying_signals = []
    
    # 1. Check industry fit
    target_ind = (icp_config.get("target_industries") or "").lower()
    lead_ind = (lead_data.get("industry") or "").lower()
    if target_ind and (target_ind in lead_ind or lead_ind in target_ind or any(w in lead_ind for w in target_ind.split())):
        score += 20
        reasons.append(f"Industry ({lead_data.get('industry')}) matches ICP targets")
    else:
        reasons.append(f"Industry ({lead_data.get('industry')}) is outside target ICP")
        
    # 2. Check company size fit
    target_size = (icp_config.get("target_company_size") or "").lower()
    lead_size = (lead_data.get("company_size") or "").lower()
    if target_size and any(w in lead_size for w in target_size.replace('-', ' ').split()):
        score += 15
        reasons.append(f"Company size ({lead_data.get('company_size')}) fits target range")
    else:
        score -= 5
        
    # 3. Check tech stack
    req_tech = (icp_config.get("required_tech_stack") or "").lower()
    lead_tech = (lead_data.get("tech_stack") or "").lower()
    matched_techs = []
    if req_tech:
        for w in req_tech.split(','):
            w_clean = w.strip()
            if w_clean and w_clean in lead_tech:
                matched_techs.append(w_clean)
        if matched_techs:
            score += 15
            reasons.append(f"Tech stack matches required technologies: {', '.join(matched_techs)}")
            buying_signals.append(f"Using target tech stack (Source: website_text)")
            
    # 4. Check seniority (hierarchical comparison)
    min_sen = (icp_config.get("minimum_seniority") or "").lower()
    lead_sen = (lead_data.get("seniority") or "").lower()
    
    hierarchy = ["intern", "junior", "mid-level", "senior", "director", "c-level"]
    try:
        min_idx = hierarchy.index(min_sen) if min_sen in hierarchy else 2  # default mid-level
        lead_idx = hierarchy.index(lead_sen) if lead_sen in hierarchy else 2
        if lead_idx >= min_idx:
            score += 15
            reasons.append(f"Role seniority ({lead_data.get('seniority')}) meets or exceeds required level ({icp_config.get('minimum_seniority')})")
        else:
            reasons.append(f"Seniority ({lead_data.get('seniority')}) is below required level ({icp_config.get('minimum_seniority')})")
    except Exception:
        if min_sen in lead_sen or lead_sen in min_sen:
            score += 15
            reasons.append(f"Role seniority ({lead_data.get('seniority')}) matches requirements")
            
    # 5. Key Decision Maker Boost (Founder / Co-founder / CEO / CTO / President / C-Level)
    role_lower = (lead_data.get("role") or "").lower()
    seniority_lower = (lead_data.get("seniority") or "").lower()
    if any(w in role_lower or w in seniority_lower for w in ["ceo", "cto", "founder", "co-founder", "president", "c-level"]):
        score += 25
        reasons.append("Lead is a high-value key decision maker (CTO/CEO/Founder)")
        buying_signals.append("Decision maker engagement (Source: title)")

    # 6. Check for buying signals in recent news
    news = (lead_data.get("recent_news") or "").lower()
    if news and any(w in news for w in ["launch", "expand", "hire", "growth", "funding"]):
        score += 10
        buying_signals.append("Active growth/news indicator (Source: recent_news)")
        
    score = min(max(score, 10), 100)
    
    # 7. Weighted combination
    icp_weight_str = os.getenv("ICP_FIT_WEIGHT", "0.7")
    signal_weight_str = os.getenv("BUYING_SIGNAL_WEIGHT", "0.3")
    try:
        icp_weight = float(icp_weight_str)
    except ValueError:
        icp_weight = 0.7
    try:
        signal_weight = float(signal_weight_str)
    except ValueError:
        signal_weight = 0.3
        
    signal_strength = min(len(buying_signals) * 50, 100)
    final_score = int((score * icp_weight) + (signal_strength * signal_weight))
    final_score = min(max(final_score, 0), 100)
    
    reasoning = f"Mock evaluation summary: {', '.join(reasons)}."
    if not buying_signals:
        buying_signals = ["Digital footprint detected (Source: website_text)"]
        
    return {
        "score": final_score,
        "reasoning": reasoning,
        "buying_signals": buying_signals
    }

def score_lead_against_icp(lead_data: dict, icp_config: dict) -> dict:
    llm_inst = get_llm_instance()
    if llm_inst is None:
        # Return mock score results if LLM is disabled/unavailable
        return calculate_dynamic_mock_score(lead_data, icp_config)

    # Build a compact lead summary to save tokens
    lead_summary = ", ".join(f"{k}: {v}" for k, v in lead_data.items() if v and k not in ("confidence_scores",))
    icp_summary = ", ".join(f"{k}: {v}" for k, v in icp_config.items() if v)

    prompt = f"""<|im_start|>system
You are a sales analyst. Score leads against an ICP using semantic reasoning. If the lead matches any disqualifying_signals, heavily penalize the icp_fit_score. Reply with ONLY a JSON object.<|im_end|>
<|im_start|>user
ICP: {icp_summary}

Lead: {lead_summary}

Reply JSON with keys:
- "icp_fit_score": integer 0-100
- "reasoning": string explanation
- "buying_signals": list of strings with source attribution
<|im_end|>
<|im_start|>assistant
"""

    try:
        response = llm_inst(
            prompt,
            max_tokens=120,
            temperature=0.1,
            stop=["<|im_end|>"]
        )
        raw_output = response["choices"][0]["text"]
        result = clean_llm_json(raw_output)
        
        # Ensure default structure is returned if keys are missing
        if not isinstance(result, dict) or "icp_fit_score" not in result or "reasoning" not in result or "buying_signals" not in result:
            return {
                "score": 0,
                "reasoning": "Failed to extract valid ICP score structure from LLM output",
                "buying_signals": []
            }
            
        icp_fit_score = result.get("icp_fit_score", 0)
        buying_signals = result.get("buying_signals", [])
        
        # Get weights from env
        icp_weight_str = os.getenv("ICP_FIT_WEIGHT", "0.7")
        signal_weight_str = os.getenv("BUYING_SIGNAL_WEIGHT", "0.3")
        try:
            icp_weight = float(icp_weight_str)
        except ValueError:
            icp_weight = 0.7
        try:
            signal_weight = float(signal_weight_str)
        except ValueError:
            signal_weight = 0.3
            
        # Calculate derived score
        signal_strength_score = min(len(buying_signals) * 33, 100)
        final_score = int((icp_fit_score * icp_weight) + (signal_strength_score * signal_weight))
        final_score = min(max(final_score, 0), 100)
        
        return {
            "score": final_score,
            "reasoning": result.get("reasoning", ""),
            "buying_signals": buying_signals
        }
    except Exception as e:
        print(f"Error during ICP scoring LLM execution: {e}")
        return {
            "score": 0,
            "reasoning": f"Exception during ICP scoring: {str(e)}",
            "buying_signals": []
        }

def generate_outreach_drafts(lead_data: dict, product_value_prop: str, num_variants: int = 3) -> dict:
    llm_inst = get_llm_instance()
    if llm_inst is None:
        # Return mock drafts if LLM is disabled/unavailable
        name = lead_data.get("original_name") or "there"
        company = lead_data.get("original_company") or "your company"
        role = lead_data.get("role") or "your role"
        return {
            "direct": f"Hi {name},\n\nI saw your work at {company} as a {role}. Let's connect to talk about {product_value_prop}.",
            "consultative": f"Hello {name},\n\nHope this finds you well. As a {role} at {company}, you're likely managing dynamic challenges. Let's discuss how {product_value_prop} can support your goals.",
            "social_proof": f"Hi {name},\n\nWe helped similar teams improve. Let's discuss how {product_value_prop} can help {company}."
        }

    if lead_data.get("icp_score", 0) < 50:
        return {"direct": "", "consultative": "", "social_proof": ""}

    # Build compact lead context
    key_facts = []
    for k in ("original_name", "original_company", "role", "seniority", "industry", "tech_stack", "funding_status", "recent_news"):
        v = lead_data.get(k)
        if v:
            key_facts.append(f"{k}: {v}")
    signals = lead_data.get("buying_signals", [])
    if signals:
        key_facts.append(f"buying_signals: {', '.join(signals[:3])}")
    lead_context = "; ".join(key_facts)

    variant_instruction = '1. "direct": Short, punchy.\n2. "consultative": Problem-solving, detailed.'
    variant_keys = '- "direct": string\n- "consultative": string'
    if num_variants == 3:
        variant_instruction += '\n3. "social_proof": Social proof led.'
        variant_keys += '\n- "social_proof": string'

    prompt = f"""<|im_start|>system
You write personalized sales emails. Reference SPECIFIC facts from the lead profile. Generic emails are a failure. Each draft MUST include a Subject line (e.g., 'Subject: ...\\n\\nBody...').<|im_end|>
<|im_start|>user
Product: {product_value_prop[:200]}

Lead: {lead_context}

Generate {num_variants} email variants:
{variant_instruction}

Reply with ONLY a JSON object with keys:
{variant_keys}
<|im_end|>
<|im_start|>assistant
"""

    try:
        response = llm_inst(
            prompt,
            max_tokens=250,
            temperature=0.4,
            stop=["<|im_end|>"]
        )
        raw_output = response["choices"][0]["text"]
        result = clean_llm_json(raw_output)
        
        # Ensure correct structure is returned
        if not isinstance(result, dict) or "direct" not in result or "consultative" not in result:
            return {"direct": "", "consultative": "", "social_proof": ""}
            
        return result
    except Exception as e:
        print(f"Error during outreach generation LLM execution: {e}")
        return {"direct": "", "consultative": "", "social_proof": ""}
