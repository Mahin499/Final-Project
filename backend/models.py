import datetime
import uuid
from sqlalchemy import Column, String, Float, DateTime, Text, JSON, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from .database import Base

def generate_uuid():
    return str(uuid.uuid4())

class Candidate(Base):
    __tablename__ = "candidates"

    id = Column(String, primary_key=True, default=generate_uuid)
    full_name = Column(String, nullable=False)
    email = Column(String, nullable=False)
    phone = Column(String, nullable=True)
    portfolio_url = Column(String, nullable=True)
    master_resume_json = Column(JSON, nullable=True) # Contains parsed sections: experience, skills, education
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

class Job(Base):
    __tablename__ = "scraped_jobs"

    id = Column(String, primary_key=True, default=generate_uuid)
    title = Column(String, nullable=False)
    company = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    location = Column(String, nullable=True)
    salary_range = Column(String, nullable=True)
    application_url = Column(String, nullable=True)
    platform = Column(String, nullable=False) # "Naukri", "Wellfound", "RemoteOK", "Mock"
    pipeline_status = Column(String, default="discovered") # "discovered", "tailored", "drafted", "sent", "rejected"
    extracted_metadata = Column(JSON, nullable=True) # Recruiter contacts, tech stack lists, etc.
    scraped_at = Column(DateTime, default=datetime.datetime.utcnow)

class TailoredResume(Base):
    __tablename__ = "tailored_resumes"

    id = Column(String, primary_key=True, default=generate_uuid)
    job_id = Column(String, ForeignKey("scraped_jobs.id"), nullable=False)
    candidate_id = Column(String, ForeignKey("candidates.id"), nullable=False)
    tailored_experience = Column(JSON, nullable=True) # Modified points
    match_score = Column(Float, default=0.0)
    gap_analysis = Column(JSON, nullable=True)
    pdf_storage_path = Column(String, nullable=True)
    generated_at = Column(DateTime, default=datetime.datetime.utcnow)

class OutreachLog(Base):
    __tablename__ = "outreach_logs"

    id = Column(String, primary_key=True, default=generate_uuid)
    job_id = Column(String, ForeignKey("scraped_jobs.id"), nullable=False)
    candidate_id = Column(String, ForeignKey("candidates.id"), nullable=False)
    tailored_resume_id = Column(String, ForeignKey("tailored_resumes.id"), nullable=True)
    recipient_email = Column(String, nullable=False)
    recipient_name = Column(String, nullable=True)
    subject = Column(String, nullable=False)
    body = Column(Text, nullable=False)
    delivery_status = Column(String, default="pending") # "pending", "drafted", "sent", "failed"
    smtp_response_message = Column(Text, nullable=True)
    processed_at = Column(DateTime, default=datetime.datetime.utcnow)
