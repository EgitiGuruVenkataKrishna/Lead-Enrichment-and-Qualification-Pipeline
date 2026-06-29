from typing import Optional, List, Any, Literal
from pydantic import BaseModel, model_validator, ConfigDict, Field

class LeadCreate(BaseModel):
    original_name: Optional[str] = None
    original_company: Optional[str] = None
    email_domain: Optional[str] = None

    @model_validator(mode='after')
    def validate_lead_identifiers(self) -> 'LeadCreate':
        name = self.original_name
        company = self.original_company
        domain = self.email_domain

        has_name_and_company = bool(name) and bool(company)
        has_domain = bool(domain)

        if not (has_name_and_company or has_domain):
            raise ValueError(
                "Lead validation failed: the row must contain either Name+Company or an Email Domain."
            )
        return self

class LeadResponse(BaseModel):
    id: int
    original_name: Optional[str] = None
    original_company: Optional[str] = None
    email_domain: Optional[str] = None
    
    company_size: Optional[str] = None
    tech_stack: Optional[str] = None
    funding_status: Optional[str] = None
    industry: Optional[str] = None
    sub_industry: Optional[str] = None
    role: Optional[str] = None
    seniority: Optional[str] = None
    recent_news: Optional[str] = None
    
    confidence_scores: Optional[dict] = None
    pipeline_status: str
    crm_sync_status: str

    # Day 2 ICP Fields
    icp_score: Optional[int] = None
    buying_signals: Optional[List[str]] = None
    icp_reasoning: Optional[Any] = None

    model_config = ConfigDict(from_attributes=True)

class ICPConfigCreate(BaseModel):
    target_company_size: Optional[str] = None
    target_industries: Optional[str] = None
    required_tech_stack: Optional[str] = None
    minimum_seniority: Optional[str] = None
    disqualifying_signals: Optional[str] = None

class ICPConfigResponse(BaseModel):
    id: int
    target_company_size: Optional[str] = None
    target_industries: Optional[str] = None
    required_tech_stack: Optional[str] = None
    minimum_seniority: Optional[str] = None
    disqualifying_signals: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)

class ICPScoreResult(BaseModel):
    score: int = Field(..., ge=0, le=100)
    reasoning: str
    buying_signals: List[str]

class ConfidenceScores(BaseModel):
    company_size: Literal["high", "medium", "low"]
    tech_stack: Literal["high", "medium", "low"]
    funding_status: Literal["high", "medium", "low"]
    industry: Literal["high", "medium", "low"]
    sub_industry: Literal["high", "medium", "low"]
    role: Literal["high", "medium", "low"]
    seniority: Literal["high", "medium", "low"]
    recent_news: Literal["high", "medium", "low"]

class EnrichedProfileOutput(BaseModel):
    company_size: Optional[str] = None
    tech_stack: Optional[str] = None
    funding_status: Optional[str] = None
    industry: Optional[str] = None
    sub_industry: Optional[str] = None
    role: Optional[str] = None
    seniority: Optional[str] = None
    recent_news: Optional[str] = None
    confidence_scores: ConfidenceScores

class OutreachDrafts(BaseModel):
    direct: str
    consultative: str
    social_proof: Optional[str] = None

class PipelineStatusResponse(BaseModel):
    lead_id: int
    original_name: Optional[str] = None
    original_company: Optional[str] = None
    pipeline_status: str

