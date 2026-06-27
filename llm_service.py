import os
import json
import re

import traceback

# Conditional import of llama_cpp to support mock mode when not installed
try:
    from llama_cpp import Llama
    LLAMA_CPP_AVAILABLE = True
except ImportError as e:
    print(f"Failed to import llama_cpp: {e}")
    traceback.print_exc()
    LLAMA_CPP_AVAILABLE = False

_llm_instance = None

# Global LLM instance initialization for module load phase
if LLAMA_CPP_AVAILABLE:
    try:
        if not os.path.exists("model.gguf") and not os.path.exists("./model.gguf"):
            raise FileNotFoundError("MODEL_NOT_FOUND: 'model.gguf' is missing from the root directory.")
        llm = Llama(
            model_path="model.gguf",
            n_ctx=2048,
            n_threads=2
        )
    except Exception as e:
        if "MODEL_NOT_FOUND" in str(e) or isinstance(e, FileNotFoundError):
            print("MODEL_NOT_FOUND: 'model.gguf' file is missing in the root directory.")
        else:
            print(f"Warning: Could not initialize Llama model: {e}")
        llm = None
else:
    llm = None

def get_llm_instance():
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
                n_ctx=2048,
                n_threads=2
            )
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

def extract_structured_data(website_text: str, news_text: str) -> dict:
    llm_inst = get_llm_instance()
    if llm_inst is None:
        # Return mock structured data if LLM is disabled/unavailable
        return {
            "company_size": "50-100 employees",
            "tech_stack": "React, Python, AWS",
            "funding_status": "Series A",
            "industry": "B2B SaaS",
            "sub_industry": "Developer Tools",
            "role": "Software Engineer",
            "seniority": "Senior",
            "recent_news": "Recently launched product v2.0",
            "confidence_scores": {
                "company_size": "medium",
                "tech_stack": "high",
                "funding_status": "medium",
                "industry": "high",
                "sub_industry": "high",
                "role": "high",
                "seniority": "high",
                "recent_news": "medium"
            }
        }

    # Truncate texts to prevent context window overflow
    truncated_website = website_text[:3000] if website_text else ""
    truncated_news = news_text[:1000] if news_text else ""

    prompt = f"""[INST] Extract lead profile information from the following website text and recent news headlines.
Your response MUST be strictly a single valid JSON object. Do not include any explanations, preamble, or markdown formatting outside of the JSON itself.

The JSON object MUST contain the following keys:
- "company_size"
- "tech_stack"
- "funding_status"
- "industry"
- "sub_industry"
- "role"
- "seniority"
- "recent_news"
- "confidence_scores"

The "confidence_scores" key must be a nested JSON object mapping each of the fields above to its confidence level, which MUST be one of: "high", "medium", or "low".

Website Text (truncated):
{truncated_website}

News Text (truncated):
{truncated_news}

JSON Output:
[/INST]"""

    try:
        response = llm_inst(
            prompt,
            max_tokens=500,
            temperature=0.1
        )
        raw_output = response["choices"][0]["text"]
        return clean_llm_json(raw_output)
    except Exception as e:
        print(f"Error during LLM extraction: {e}")
        return {}

def score_lead_against_icp(lead_data: dict, icp_config: dict) -> dict:
    llm_inst = get_llm_instance()
    if llm_inst is None:
        # Return mock score results if LLM is disabled/unavailable
        return {
            "score": 75,
            "reasoning": "Mock evaluation: Lead matches target size and industry.",
            "buying_signals": ["Recent website update", "Active hiring"]
        }

    prompt = f"""[INST] You are an expert sales analyst. Evaluate the suitability of the following Lead Data against our Ideal Customer Profile (ICP) Configuration using semantic reasoning, not exact keyword matching.

Examples of semantic reasoning:
- If target company size is "20 to 100 employees" and lead is "boutique consultancy with 40 engineers", this is a match.
- If target seniority is "VP or above" and lead is "Head of Platform", infer if they are equivalent based on context and role seniority.

Identify any buying signals in the Lead Data (e.g., recent funding, expansion, hiring, new office, active technology adoption) that indicate budget or growth.

ICP Configuration:
{json.dumps(icp_config, indent=2)}

Lead Data:
{json.dumps(lead_data, indent=2)}

Your response MUST be strictly a single valid JSON object. Do not include any explanations, preamble, or markdown formatting outside of the JSON itself.
The JSON object MUST contain exactly the following keys:
- "score": An integer from 0 to 100 representing how well the lead matches the ICP.
- "reasoning": A detailed string justification of the score based on semantic matching.
- "buying_signals": A list of strings detailing any detected buying signals.

JSON Output:
[/INST]"""

    try:
        response = llm_inst(
            prompt,
            max_tokens=600,
            temperature=0.1
        )
        raw_output = response["choices"][0]["text"]
        result = clean_llm_json(raw_output)
        
        # Ensure default structure is returned if keys are missing
        if not isinstance(result, dict) or "score" not in result or "reasoning" not in result or "buying_signals" not in result:
            return {
                "score": 0,
                "reasoning": "Failed to extract valid ICP score structure from LLM output",
                "buying_signals": []
            }
            
        return result
    except Exception as e:
        print(f"Error during ICP scoring LLM execution: {e}")
        return {
            "score": 0,
            "reasoning": f"Exception during ICP scoring: {str(e)}",
            "buying_signals": []
        }

def generate_outreach_drafts(lead_data: dict, product_value_prop: str) -> dict:
    llm_inst = get_llm_instance()
    if llm_inst is None:
        # Return mock drafts if LLM is disabled/unavailable
        name = lead_data.get("original_name") or "there"
        company = lead_data.get("original_company") or "your company"
        role = lead_data.get("role") or "your role"
        return {
            "direct": f"Hi {name},\n\nI saw your work at {company} as a {role}. Let's connect to talk about {product_value_prop}.",
            "consultative": f"Hello {name},\n\nHope this finds you well. As a {role} at {company}, you're likely managing dynamic challenges. Let's discuss how {product_value_prop} can support your goals."
        }

    if lead_data.get("icp_score", 0) < 50:
        return {"direct": "", "consultative": ""}

    prompt = f"""[INST] You are an expert copywriter. Generate two personalized sales outreach emails to the lead based on their profile data and our product's value proposition.

Product Value Proposition:
{product_value_prop}

Lead Data:
{json.dumps(lead_data, indent=2)}

CRITICAL INSTRUCTION: Generic drafts are a failure mode. You MUST explicitly reference specific facts from the lead's profile, such as their recent news, funding, specific tech stack, or buying signals. Do not use generic placeholders where real facts are available.

Generate exactly two email variants:
1. "direct": Short, punchy, gets straight to the point.
2. "consultative": Focuses on problem-solving, slightly longer, references deeper context.

Your response MUST be strictly a single valid JSON object. Do not include any explanations, preamble, or markdown formatting outside of the JSON itself.
The JSON object MUST contain exactly the following keys:
- "direct": The text of the direct email variant.
- "consultative": The text of the consultative email variant.

JSON Output:
[/INST]"""

    try:
        response = llm_inst(
            prompt,
            max_tokens=800,
            temperature=0.4
        )
        raw_output = response["choices"][0]["text"]
        result = clean_llm_json(raw_output)
        
        # Ensure correct structure is returned
        if not isinstance(result, dict) or "direct" not in result or "consultative" not in result:
            return {"direct": "", "consultative": ""}
            
        return result
    except Exception as e:
        print(f"Error during outreach generation LLM execution: {e}")
        return {"direct": "", "consultative": ""}
