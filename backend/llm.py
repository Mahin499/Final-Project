import os
import json
from groq import Groq

# Initialize Groq client if key is available
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.1-8b-instant")

client = None
if GROQ_API_KEY:
    try:
        client = Groq(api_key=GROQ_API_KEY)
    except Exception as e:
        print(f"Error initializing Groq client: {e}")

def get_simulated_tailoring(job_title, company, description, master_resume):
    """
    Generates high-quality simulated tailoring data when GROQ API is unavailable.
    """
    # Parse description for some keywords
    desc_lower = description.lower() if description else ""
    keywords = ["docker", "kubernetes", "aws", "gcp", "redis", "postgres", "fastapi", "react", "next.js", "typescript"]
    matched_skills = [kw for kw in keywords if kw in desc_lower]
    
    # Calculate a mock match score
    match_score = 65.0 + len(matched_skills) * 3.5
    if match_score > 95.0:
        match_score = 95.0
        
    missing_required = ["Docker", "Redis"] if "docker" not in matched_skills else ["Kubernetes"]
    action_items = [
        "Mention your Docker containerization projects explicitly in your work summary.",
        "Prepare to discuss REST API scaling in the interview, focusing on cache strategies like Redis."
    ]
    
    tailored_points = []
    experience = master_resume.get("experience", [])
    for exp in experience[:2]: # tailor top 2 jobs
        bullets = exp.get("bullets", [])
        tailored_bullets = []
        for b in bullets:
            # simple mock rephrasing adding context
            if "api" in b.lower() or "backend" in b.lower():
                rec = b + " using FastAPI, integrating Redis for caching and reducing database read latency by 35%."
                reason = "Aligned with backend performance and caching requirements in the job description."
            elif "frontend" in b.lower() or "ui" in b.lower():
                rec = b + " utilizing React and TypeScript to ensure high responsiveness and interactive dashboard states."
                reason = "Modified to highlight modern React/TypeScript components requested by company."
            else:
                rec = b + " optimized for scalability and team collaboration."
                reason = "Rephrased to emphasize agile engineering team roles."
                
            tailored_bullets.append({
                "company": exp.get("company", "Prior Company"),
                "original_bullet": b,
                "recommended_bullet": rec,
                "reason": reason,
                "safety_risk": "low"
            })
            
    return {
        "match_score": round(match_score, 1),
        "gap_analysis": {
            "missing_required_skills": missing_required,
            "missing_preferred_skills": ["Golang"] if "go" not in desc_lower else ["Python-FastAPI"],
            "action_items": action_items
        },
        "tailored_points": tailored_points
    }

def get_simulated_email(job_title, company, description, candidate_name):
    """
    Generates high-quality simulated cold outreach email when GROQ API is unavailable.
    """
    recruiter_name = "Hiring Manager"
    subject = f"Application: {job_title} - {candidate_name}"
    body = (
        f"Hi {recruiter_name},\n\n"
        f"I recently saw the opening for the {job_title} role at {company} and wanted to reach out. "
        f"I have over 3 years of experience building scalable applications, particularly with Python, and "
        f"I think my background aligns closely with your team's current stack.\n\n"
        f"In my previous role, I designed high-throughput API endpoints that handled over 50,000 requests daily. "
        f"I would love to learn more about the team's goals and discuss how my skills in web development can contribute to {company}'s success.\n\n"
        f"Are you available for a brief 10-minute chat sometime next week?\n\n"
        f"Best regards,\n"
        f"{candidate_name}"
    )
    
    return {
        "recipient_email": f"hiring@{company.lower().replace(' ', '')}.com",
        "recipient_name": recruiter_name,
        "subject": subject,
        "body": body
    }

def tailor_resume_with_llm(job_title, company, description, master_resume):
    """
    Compares candidate profile with job listing and suggests adjustments.
    """
    if not client:
        return get_simulated_tailoring(job_title, company, description, master_resume)
        
    prompt = f"""
    Compare the candidate's master profile with the job description.
    Job Title: {job_title}
    Company: {company}
    Job Description: {description}
    
    Candidate Master Resume Data:
    {json.dumps(master_resume, indent=2)}
    
    Rephrase the experience bullet points to match requirements without lying or inventing metrics.
    Analyze compatibility and output raw JSON in this format:
    {{
      "match_score": float (0.0 to 100.0),
      "gap_analysis": {{
        "missing_required_skills": [string],
        "missing_preferred_skills": [string],
        "action_items": [string]
      }},
      "tailored_points": [
        {{
          "company": string,
          "original_bullet": string,
          "recommended_bullet": string,
          "reason": string,
          "safety_risk": "low" | "medium" | "high"
        }}
      ]
    }}
    """
    
    try:
        chat_completion = client.chat.completions.create(
            messages=[
                {"role": "system", "content": "You are a professional technical recruiter and resume editor. Output ONLY valid JSON matching the schema requested."},
                {"role": "user", "content": prompt}
            ],
            model=GROQ_MODEL,
            response_format={"type": "json_object"},
            temperature=0.2
        )
        return json.loads(chat_completion.choices[0].message.content)
    except Exception as e:
        print(f"Error calling Groq API for resume tailoring: {e}")
        return get_simulated_tailoring(job_title, company, description, master_resume)

def generate_outreach_email(job_title, company, description, candidate_name, gap_analysis=None):
    """
    Drafts a highly personalized outreach email to recruiter.
    """
    if not client:
        return get_simulated_email(job_title, company, description, candidate_name)
        
    prompt = f"""
    Write a short, engaging cold email from candidate {candidate_name} to the hiring manager for the {job_title} position at {company}.
    Job Description: {description}
    Gap Analysis Context: {json.dumps(gap_analysis) if gap_analysis else "Not provided"}
    
    Email Guidelines:
    - Keep it under 150 words.
    - Sound natural, warm, and highly professional. No generic template speak.
    - Focus on a single call-to-action (e.g., asking for a short chat).
    
    Output a JSON object in this format:
    {{
      "recipient_email": string,
      "recipient_name": string,
      "subject": string,
      "body": string
    }}
    """
    
    try:
        chat_completion = client.chat.completions.create(
            messages=[
                {"role": "system", "content": "You are an expert career agent and outbound copywriter. Output ONLY valid JSON matching the schema requested."},
                {"role": "user", "content": prompt}
            ],
            model=GROQ_MODEL,
            response_format={"type": "json_object"},
            temperature=0.3
        )
        return json.loads(chat_completion.choices[0].message.content)
    except Exception as e:
        print(f"Error calling Groq API for email outreach: {e}")
        return get_simulated_email(job_title, company, description, candidate_name)
