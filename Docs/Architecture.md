# System Architecture: Unified CareerAgent Suite

This document outlines the detailed system architecture for the unified **CareerAgent Suite**, combining [Job Agent](https://github.com/Mahin499/Job-agent), [Resume Shapeshifter](https://github.com/Mahin499/Resume-Builder-Project), and [The Closer Email Bot](https://github.com/Mahin499/Email-Sending-Bot) into a single, cohesive, end-to-end platform.

---

## 1. System Topology

The platform follows a decoupled **Single-Page Application (SPA)** and **RESTful micro-backend** architecture to support Next.js frontend state management alongside Python's robust ecosystem for web scraping and data processing.

```mermaid
graph TB
    subgraph Client [Frontend Workspace - Next.js/React]
        UI[Web Dashboard & Kanban Board]
        Editor[Resume & Email Review Editor]
        PDFPreview[PDF Match Proof Viewer]
    end

    subgraph Backend [Application Server - FastAPI]
        API[REST API Gateway]
        LLM[LLM Orchestrator - Groq Client]
        PDFGen[PDF Render Engine - Puppeteer / Playwright]
        Scheduler[Task Scheduler]
    end

    subgraph Workers [Asynchronous Task Workers - Celery]
        ScrapeWorker[Scraper Worker]
        EmailWorker[SMTP/IMAP Worker]
    end

    subgraph ThirdParty [Third-Party Services]
        Groq[Groq Cloud API - Llama 3.1]
        JobBoards[Naukri, Wellfound, RemoteOK]
        MailServer[Recruiter Mailboxes / User SMTP]
    end

    subgraph Storage [Persistent Storage]
        DB[(SQLite / PostgreSQL)]
        Redis[(Redis Cache & Message Broker)]
        FS[(Local / S3 PDF File Storage)]
    end

    %% Client Interactions
    UI -->|HTTPS REST| API
    Editor -->|HTTPS REST| API
    PDFPreview -->|Fetch PDF| FS

    %% API Connections
    API --> DB
    API --> Redis
    API --> Scheduler
    API --> LLM
    API --> PDFGen

    %% Task Delegations
    Scheduler -->|Task Queue| Redis
    Redis -->|Consume Tasks| ScrapeWorker
    Redis -->|Consume Tasks| EmailWorker

    %% Worker Interactions
    ScrapeWorker -->|HTTP Scrape| JobBoards
    ScrapeWorker -->|Write Results| DB
    EmailWorker -->|Send Mail SMTP/IMAP| MailServer
    EmailWorker -->|Log Outreach| DB

    %% API to External
    LLM -->|JSON Mode Requests| Groq
    PDFGen -->|Write PDFs| FS
```

---

## 2. Database Schema Design

We use a relational database layout (e.g., SQLite for local development, PostgreSQL for production) to maintain state and full traceability from job discovery to final outreach.

```mermaid
erDiagram
    CANDIDATES ||--o{ TAILORED_RESUMES : creates
    SCRAPED_JOBS ||--o{ TAILORED_RESUMES : matches
    SCRAPED_JOBS ||--o{ OUTREACH_LOGS : targets
    CANDIDATES ||--o{ OUTREACH_LOGS : sends
    TAILORED_RESUMES ||--o| OUTREACH_LOGS : attached_to

    CANDIDATES {
        uuid id PK
        string full_name
        string email
        string phone
        string portfolio_url
        jsonb master_resume_json "Parsed resume structure: skills, work experience, education"
        timestamp created_at
    }

    SCRAPED_JOBS {
        uuid id PK
        string title
        string company
        text description
        string location
        string salary_range
        string application_url
        string platform "Naukri, Wellfound, RemoteOK, etc."
        string pipeline_status "discovered, tailored, drafted, emailed, interviewing, rejected"
        jsonb extracted_metadata "Key requirements, contact email, company info"
        timestamp scraped_at
    }

    TAILORED_RESUMES {
        uuid id PK
        uuid job_id FK
        uuid candidate_id FK
        jsonb tailored_experience "Modified work experience points and skill listings"
        float match_score "0.0 - 100.0 similarity & capability score"
        jsonb gap_analysis "Missing required skills, warning messages"
        string pdf_storage_path "Path to generated PDF on disk/S3"
        timestamp generated_at
    }

    OUTREACH_LOGS {
        uuid id PK
        uuid job_id FK
        uuid candidate_id FK
        uuid tailored_resume_id FK "Optional attachment"
        string recipient_email
        string recipient_name
        string subject
        text body
        string delivery_status "pending, drafted, sent, failed"
        string smtp_response_message
        timestamp scheduled_for
        timestamp processed_at
    }
```

---

## 3. Core API Endpoint Specifications

The FastAPI gateway manages communication, offloading heavy processing to Redis/Celery queue networks.

### 3.1. Scraper Control Group
*   `POST /api/scraper/start`
    *   **Description**: Starts a background scrape task.
    *   **Payload**:
        ```json
        {
          "job_titles": ["Python Developer", "React Engineer"],
          "locations": ["Remote", "Bangalore"],
          "max_results_per_platform": 50
        }
        ```
    *   **Response**: `202 Accepted` with a `task_id` for status polling.
*   `GET /api/scraper/status/{task_id}`
    *   **Description**: Fetches background task progress.
    *   **Response**: `{"task_id": "...", "status": "processing", "progress": 45}`
*   `GET /api/jobs`
    *   **Description**: Queries scraped job listings with filtering capabilities.
    *   **Query Params**: `status`, `company`, `platform`, `limit`, `offset`.

### 3.2. Resume Tailoring & Matching Group
*   `POST /api/jobs/{job_id}/tailor`
    *   **Description**: Extracts job information, scores it against the master resume, and generates tailored resume bullet points.
    *   **Response**:
        ```json
        {
          "match_score": 78.4,
          "gap_analysis": {
            "missing_required_skills": ["Kubernetes", "Redis"],
            "missing_preferred_skills": ["Golang"],
            "action_items": ["Prepare to speak about container experience in interview."]
          },
          "tailored_points": [
            {
              "company": "Prior Tech Inc",
              "original_bullet": "Developed API backends in Flask",
              "recommended_bullet": "Architected high-throughput REST APIs using Flask, scaling database reads via Redis integration.",
              "reason": "Aligns with database scaling mentions in job description.",
              "safety_risk": "low"
            }
          ]
        }
        ```
*   `POST /api/jobs/{job_id}/export-pdf`
    *   **Description**: Generates and compiles the PDF resume using headless Chrome/Puppeteer.
    *   **Payload**: The tailored JSON structure.
    *   **Response**: `200 OK` with binary octet-stream (PDF file) or a download URL.

### 3.3. Outreach Group
*   `POST /api/jobs/{job_id}/outreach/draft`
    *   **Description**: Personalizes an email draft targeting the recruiter of a specific job.
    *   **Response**:
        ```json
        {
          "recipient_email": "recruiter@targetcompany.com",
          "subject": "Application: Frontend Engineer - [Candidate Name]",
          "body": "Hi [Recruiter Name]...\n\nI noticed you are hiring...",
          "warnings": [
            {"type": "word_count", "message": "Email exceeds 150 words (currently 162)."}
          ]
        }
        ```
*   `POST /api/jobs/{job_id}/outreach/send`
    *   **Description**: Queues the email to be sent out immediately or saved as a draft on IMAP.
    *   **Payload**:
        ```json
        {
          "subject": "...",
          "body": "...",
          "recipient_email": "...",
          "action": "send_smtp" // or "save_imap_draft"
        }
        ```
    *   **Response**: `200 OK` with delivery status logs.

---

## 4. Key Data Flow Pipelines

### 4.1. The One-Click Application Pipeline
This diagram traces how a user moves a job listing from "Scraped" to "Applied" inside the unified system workspace.

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Dashboard as Web Dashboard
    participant API as FastAPI Backend
    participant LLM as Groq Engine (Llama 3.1)
    participant Worker as Task Queue (Celery)
    participant SMTP as SMTP Relay

    User->>Dashboard: Clicks "Process Application" on Scraped Job
    Dashboard->>API: POST /api/jobs/{job_id}/tailor
    API->>API: Fetch Scraped Job Desc & Candidate Master Resume
    API->>LLM: Request Analysis (Structured JSON Mode)
    Note over API,LLM: Extract Skills, Match Score & Tailor bullets
    LLM-->>API: Returns Score, Gap Analysis, & Tailored Bullets
    API-->>Dashboard: Send Tailoring Data & Compatibility Score
    Dashboard-->>User: Show side-by-side changes & compatibility score
    User->>Dashboard: Clicks "Generate Outreach & Export"
    Dashboard->>API: POST /api/jobs/{job_id}/outreach/draft
    API->>LLM: Generate custom cold email based on gap analysis insights
    LLM-->>API: Returns subject, body draft, and contact details
    API-->>Dashboard: Show editable Email draft
    User->>Dashboard: Edits email draft and clicks "Send Application"
    Dashboard->>API: POST /api/jobs/{job_id}/outreach/send (payload + PDF link)
    API->>Worker: Enqueue Send Task (Celery)
    API-->>Dashboard: Return "Queued" (Task ID)
    Worker->>SMTP: Connect & Send Email with Tailored Resume attached
    SMTP-->>Worker: 250 OK (Message accepted)
    Worker->>API: Update status of job to "applied" and log SMTP outcome
    Worker-->>Dashboard: (via WebSocket/Polling) Notify User of Successful Delivery
```

---

## 5. LLM Integration Strategy (Structured JSON Broker)

To ensure consistency, Groq Cloud API calls use **Llama-3.1-70b-Versatile** or **Llama-3.1-8b-Instant** running in strict JSON Mode.

### 5.1. Prompt Engineering: Resume Tailoring
```text
System Prompt:
You are an expert resume reviewer. Compare the candidate's experience bullets with the provided job description.
Your goal is to rephrase the experience bullets to highlight relevant transferrable skills using similar terminology found in the job description.
Do NOT fabricate metrics, projects, or credentials.
You MUST output a JSON object containing:
{
  "match_score": float,
  "gap_analysis": {
    "missing_required_skills": [string],
    "missing_preferred_skills": [string],
    "action_items": [string]
  },
  "tailored_points": [
    {
      "company": string,
      "original_bullet": string,
      "recommended_bullet": string,
      "reason": string,
      "safety_risk": "low" | "medium" | "high"
    }
  ]
}
```

### 5.2. Prompt Engineering: Cold Outreach Email Generation
```text
System Prompt:
You are a career consultant writing a cold email on behalf of a candidate applying to a company.
Analyze the job requirements, company background, and the candidate's compatibility data.
Write an outreach email that is concise (<150 words), conversational, features a single call-to-action, and references specific projects from the candidate's tailored resume that match the company's stack.
Do not make the email sound generic. Output JSON matching the format:
{
  "recipient_email": string,
  "recipient_name": string,
  "subject": string,
  "body": string
}
```

---

## 6. Security & Infrastructure Configuration

1.  **Credential Encrypted Vault**:
    *   SMTP Server login keys, App Passwords, and Groq API keys are stored in environment variables (`.env`).
    *   For multi-user scalability, candidate SMTP credentials should be stored in the database, encrypted using **AES-256-GCM** with a master key stored in the server's environment configuration.
2.  **Anti-Spam Rate Limits (The Closer Engine)**:
    *   The worker enforces a strict cooldown period (e.g., 60-120 seconds) between outgoing SMTP requests.
    *   Each recipient email has a unique lock in Redis for 30 days. Any new outreach attempt targeting that address is blocked, prompting an alert on the UI dashboard.
3.  **PDF Rendering Security**:
    *   Headless Puppeteer is run inside sandboxed environments with `--disable-gpu` and `--no-sandbox` limits, rendering local CSS print styles directly from Next.js endpoints.
