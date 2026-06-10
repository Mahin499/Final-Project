import os
from fastapi import FastAPI, Depends, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
import datetime

from .database import engine, get_db, Base
from .models import Job, Candidate, TailoredResume, OutreachLog
from .scrapers import scrape_jobs
from .llm import tailor_resume_with_llm, generate_outreach_email
from .outreach import verify_deduplication, send_smtp_email, save_imap_draft

# Create database tables
Base.metadata.create_all(bind=engine)

app = FastAPI(title="CareerAgent Suite API")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pydantic Schemas
class ScrapeRequest(BaseModel):
    title: str
    location: Optional[str] = "Remote"

class CandidateProfile(BaseModel):
    full_name: str
    email: str
    phone: Optional[str] = ""
    portfolio_url: Optional[str] = ""
    master_resume_json: dict

class PipelineUpdate(BaseModel):
    pipeline_status: str

class EmailSendRequest(BaseModel):
    recipient_email: str
    subject: str
    body: str
    action: str # "send_smtp" or "save_imap_draft"

# Initialize Default Candidate Profile on Startup
@app.on_event("startup")
def startup_event():
    db = next(get_db())
    # Check if a candidate exists, if not create default
    existing = db.query(Candidate).first()
    if not existing:
        default_resume = {
            "skills": ["Python", "FastAPI", "JavaScript", "React", "SQL", "Git", "REST APIs"],
            "experience": [
                {
                    "company": "TechInnovate solutions",
                    "role": "Software Engineer",
                    "duration": "2023 - Present",
                    "bullets": [
                        "Developed backend REST APIs and integrated databases, optimizing performance by 20%.",
                        "Designed user interfaces using React and state management libraries for dynamic workspaces.",
                        "Collaborated with product teams to gather requirements and deliver high-quality code sprints."
                    ]
                },
                {
                    "company": "DevLaunch Systems",
                    "role": "Junior Developer",
                    "duration": "2021 - 2023",
                    "bullets": [
                        "Maintained and updated legacy Python scripts to automate internal report generation.",
                        "Identified and resolved bug tickets, reducing application crash rate by 15%."
                    ]
                }
            ]
        }
        candidate = Candidate(
            full_name="Alex Mercer",
            email="alex.mercer@gmail.com",
            phone="+1 (555) 019-2834",
            portfolio_url="https://alexmercer.dev",
            master_resume_json=default_resume
        )
        db.add(candidate)
        db.commit()
        print("Created default candidate profile: Alex Mercer.")

# Helper to get the default candidate
def get_default_candidate(db: Session = Depends(get_db)):
    candidate = db.query(Candidate).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="No candidate profile found.")
    return candidate

# API Endpoints
@app.get("/api/candidate", response_model=None)
def get_candidate(candidate: Candidate = Depends(get_default_candidate)):
    return {
        "id": candidate.id,
        "full_name": candidate.full_name,
        "email": candidate.email,
        "phone": candidate.phone,
        "portfolio_url": candidate.portfolio_url,
        "master_resume_json": candidate.master_resume_json
    }

@app.put("/api/candidate", response_model=None)
def update_candidate(profile: CandidateProfile, db: Session = Depends(get_db), candidate: Candidate = Depends(get_default_candidate)):
    candidate.full_name = profile.full_name
    candidate.email = profile.email
    candidate.phone = profile.phone
    candidate.portfolio_url = profile.portfolio_url
    candidate.master_resume_json = profile.master_resume_json
    db.commit()
    return {"message": "Profile updated successfully"}

@app.post("/api/scraper/start")
def trigger_scrape(request: ScrapeRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """
    Kicks off a scraping job in the background and saves findings to the DB.
    """
    def task_worker(title, location):
        try:
            jobs = scrape_jobs(title, location)
            local_db = next(get_db())
            for j in jobs:
                # Deduplicate based on title, company and application URL
                exists = local_db.query(Job).filter(
                    Job.title == j["title"],
                    Job.company == j["company"]
                ).first()
                if not exists:
                    job = Job(
                        title=j["title"],
                        company=j["company"],
                        description=j["description"],
                        location=j["location"],
                        salary_range=j["salary_range"],
                        application_url=j["application_url"],
                        platform=j["platform"],
                        extracted_metadata=j["extracted_metadata"]
                    )
                    local_db.add(job)
            local_db.commit()
            print(f"Scrape completed for '{title}' in '{location}'. Found {len(jobs)} jobs.")
        except Exception as e:
            print(f"Scraper task failed: {e}")

    background_tasks.add_task(task_worker, request.title, request.location)
    return {"message": "Scraper task started in background."}

@app.get("/api/jobs")
def get_jobs(db: Session = Depends(get_db)):
    """
    Returns all jobs sorted by scraped time (latest first).
    """
    jobs = db.query(Job).order_by(Job.scraped_at.desc()).all()
    return jobs

@app.put("/api/jobs/{job_id}/pipeline")
def update_job_pipeline(job_id: str, request: PipelineUpdate, db: Session = Depends(get_db)):
    """
    Updates the pipeline tracking status of a job.
    """
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    job.pipeline_status = request.pipeline_status
    db.commit()
    return {"message": f"Pipeline status updated to '{request.pipeline_status}'"}

@app.post("/api/jobs/{job_id}/tailor")
def tailor_resume(job_id: str, db: Session = Depends(get_db), candidate: Candidate = Depends(get_default_candidate)):
    """
    Scores compatibility and edits experience bullets to match job descriptions.
    """
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
        
    tailoring_result = tailor_resume_with_llm(
        job.title, job.company, job.description, candidate.master_resume_json
    )
    
    # Save or update tailored resume record
    existing_resume = db.query(TailoredResume).filter(
        TailoredResume.job_id == job_id,
        TailoredResume.candidate_id == candidate.id
    ).first()
    
    if existing_resume:
        existing_resume.tailored_experience = tailoring_result["tailored_points"]
        existing_resume.match_score = tailoring_result["match_score"]
        existing_resume.gap_analysis = tailoring_result["gap_analysis"]
        db.commit()
        resume_id = existing_resume.id
    else:
        new_resume = TailoredResume(
            job_id=job_id,
            candidate_id=candidate.id,
            tailored_experience=tailoring_result["tailored_points"],
            match_score=tailoring_result["match_score"],
            gap_analysis=tailoring_result["gap_analysis"]
        )
        db.add(new_resume)
        db.commit()
        db.refresh(new_resume)
        resume_id = new_resume.id
        
    # Mark job status as tailored
    job.pipeline_status = "tailored"
    db.commit()
    
    return {
        "resume_id": resume_id,
        **tailoring_result
    }

@app.get("/api/jobs/{job_id}/tailored")
def get_tailored_resume(job_id: str, db: Session = Depends(get_db), candidate: Candidate = Depends(get_default_candidate)):
    """
    Gets the tailored resume record for a job.
    """
    resume = db.query(TailoredResume).filter(
        TailoredResume.job_id == job_id,
        TailoredResume.candidate_id == candidate.id
    ).first()
    if not resume:
        raise HTTPException(status_code=404, detail="No tailoring found for this job yet.")
    return resume

@app.post("/api/jobs/{job_id}/outreach/draft")
def draft_outreach(job_id: str, db: Session = Depends(get_db), candidate: Candidate = Depends(get_default_candidate)):
    """
    Generates a personalized recruiter cold email draft.
    """
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
        
    resume = db.query(TailoredResume).filter(
        TailoredResume.job_id == job_id,
        TailoredResume.candidate_id == candidate.id
    ).first()
    
    gap_analysis = resume.gap_analysis if resume else None
    
    email_draft = generate_outreach_email(
        job.title, job.company, job.description, candidate.full_name, gap_analysis
    )
    
    # Override recipient email if scraper gathered one
    scraped_email = job.extracted_metadata.get("recruiter_email") if job.extracted_metadata else None
    if scraped_email:
        email_draft["recipient_email"] = scraped_email
        
    # Check deduplication
    already_contacted = verify_deduplication(db, email_draft["recipient_email"])
    
    # Generate heuristics alerts
    warnings = []
    body_words = len(email_draft["body"].split())
    if body_words > 150:
        warnings.append({"type": "word_count", "message": f"Email is wordy ({body_words} words). Consider editing down to under 150 words."})
    if "?" not in email_draft["body"]:
        warnings.append({"type": "cta", "message": "No question mark found. Ensure you feature a clear call-to-action (e.g. asking for a chat)."})
    if candidate.full_name.split()[0].lower() not in email_draft["body"].lower():
        warnings.append({"type": "sign_off", "message": "Sign-off signature seems to be missing your candidate name."})
        
    # Mark job status as drafted
    job.pipeline_status = "drafted"
    db.commit()

    return {
        "recipient_email": email_draft["recipient_email"],
        "recipient_name": email_draft["recipient_name"],
        "subject": email_draft["subject"],
        "body": email_draft["body"],
        "already_contacted": already_contacted,
        "warnings": warnings
    }

@app.post("/api/jobs/{job_id}/outreach/send")
def send_outreach(job_id: str, request: EmailSendRequest, db: Session = Depends(get_db), candidate: Candidate = Depends(get_default_candidate)):
    """
    Sends cold outreach email (via SMTP) or appends to drafts (via IMAP).
    """
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    # Double check deduplication on final send
    if request.action == "send_smtp" and verify_deduplication(db, request.recipient_email):
        raise HTTPException(status_code=400, detail="Safety Lock: You have already contacted this recipient within the last 30 days.")

    # Perform action
    success = False
    message = ""
    if request.action == "send_smtp":
        success, message = send_smtp_email(request.recipient_email, request.subject, request.body)
    elif request.action == "save_imap_draft":
        success, message = save_imap_draft(request.recipient_email, request.subject, request.body)
    else:
        raise HTTPException(status_code=400, detail=f"Invalid outreach action: {request.action}")

    if not success:
        # Create failed log entry
        log = OutreachLog(
            job_id=job_id,
            candidate_id=candidate.id,
            recipient_email=request.recipient_email,
            recipient_name=request.recipient_email.split('@')[0],
            subject=request.subject,
            body=request.body,
            delivery_status="failed",
            smtp_response_message=message
        )
        db.add(log)
        db.commit()
        raise HTTPException(status_code=500, detail=message)

    # Save log
    log = OutreachLog(
        job_id=job_id,
        candidate_id=candidate.id,
        recipient_email=request.recipient_email,
        recipient_name=request.recipient_email.split('@')[0],
        subject=request.subject,
        body=request.body,
        delivery_status="sent" if request.action == "send_smtp" else "drafted",
        smtp_response_message=message
    )
    db.add(log)
    
    # Update pipeline status
    job.pipeline_status = "sent" if request.action == "send_smtp" else "drafted"
    db.commit()

    return {"message": message, "status": log.delivery_status}

@app.get("/api/outreach/logs")
def get_outreach_logs(db: Session = Depends(get_db)):
    """
    Returns history logs of outreach emails.
    """
    logs = db.query(OutreachLog).order_by(OutreachLog.processed_at.desc()).all()
    return logs
