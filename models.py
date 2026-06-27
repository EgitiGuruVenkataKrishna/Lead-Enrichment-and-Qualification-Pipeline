from sqlalchemy import Column, Integer, String, JSON
from sqlalchemy.ext.declarative import declarative_base

Base = declarative_base()

class Lead(Base):
    __tablename__ = 'leads'

    id = Column(Integer, primary_key=True)

    # Raw Input Columns (Nullable Strings)
    original_name = Column(String, nullable=True)
    original_company = Column(String, nullable=True)
    email_domain = Column(String, nullable=True)

    # Enriched Columns (Nullable Strings)
    company_size = Column(String, nullable=True)
    tech_stack = Column(String, nullable=True)
    funding_status = Column(String, nullable=True)
    industry = Column(String, nullable=True)
    sub_industry = Column(String, nullable=True)
    role = Column(String, nullable=True)
    seniority = Column(String, nullable=True)
    recent_news = Column(String, nullable=True)

    # Confidence Tracking (JSON column mapping each enriched field to confidence level)
    confidence_scores = Column(JSON, nullable=True)

    # Status Tracking
    pipeline_status = Column(String, default="pending", nullable=False)

    # CRM Tracking
    crm_sync_status = Column(String, default="pending", nullable=False)

    # Day 2 ICP Scorer Columns
    icp_score = Column(Integer, nullable=True)
    buying_signals = Column(JSON, nullable=True)
    icp_reasoning = Column(JSON, nullable=True)

    # Day 3 outreach drafts column
    outreach_drafts = Column(JSON, nullable=True)

class ICPConfig(Base):
    __tablename__ = 'icp_configs'

    id = Column(Integer, primary_key=True)
    target_company_size = Column(String, nullable=True)
    target_industries = Column(String, nullable=True)
    required_tech_stack = Column(String, nullable=True)
    minimum_seniority = Column(String, nullable=True)
    disqualifying_signals = Column(String, nullable=True)

    # Day 3 product value proposition column
    product_value_proposition = Column(String, nullable=True)
