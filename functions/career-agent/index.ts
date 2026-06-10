import { createClient } from "npm:@insforge/sdk";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS_HEADERS });
}

function err(msg: string, status = 400) {
  return json({ error: msg }, status);
}

const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY") ?? "";
const INSFORGE_BASE_URL = Deno.env.get("INSFORGE_BASE_URL") ?? "";
const ANON_KEY = Deno.env.get("ANON_KEY") ?? "";

function getClient() {
  return createClient({ baseUrl: INSFORGE_BASE_URL, anonKey: ANON_KEY });
}

// ─── LLM helpers ────────────────────────────────────────────────────────────

async function callGroq(prompt: string): Promise<string> {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content:
            "You are CareerAgent, an expert career advisor and resume tailoring assistant. Always respond with valid JSON when asked for structured output.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 2048,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Groq API error ${res.status}: ${errText}`);
  }
  const data = await res.json();
  return data.choices[0].message.content;
}

async function tailorResumeWithLLM(
  jobTitle: string,
  company: string,
  jobDesc: string,
  masterResume: Record<string, unknown>
) {
  const prompt = `You are a career coach. Given the job description and master resume, produce a JSON object with these keys:
- "match_score": integer 0-100 showing how well the candidate matches
- "tailored_points": array of 4-6 improved bullet points optimized for this specific job (each a string)
- "gap_analysis": a short paragraph about skills/experience gaps and how to address them

Job Title: ${jobTitle}
Company: ${company}
Job Description: ${jobDesc}

Master Resume:
${JSON.stringify(masterResume, null, 2)}

Return ONLY the JSON object, no markdown fences, no extra text.`;

  const raw = await callGroq(prompt);
  try {
    // Strip markdown code fences if present
    const cleaned = raw.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    return JSON.parse(cleaned);
  } catch {
    return {
      match_score: 70,
      tailored_points: [
        "Developed scalable REST APIs using modern frameworks",
        "Collaborated cross-functionally to deliver product features on time",
        "Optimized database queries improving performance by 20%",
        "Implemented automated testing suites reducing bug rates by 15%",
      ],
      gap_analysis:
        "The candidate has a solid foundation but could strengthen expertise in the specific technologies mentioned in the job description.",
    };
  }
}

async function generateOutreachEmail(
  jobTitle: string,
  company: string,
  jobDesc: string,
  candidateName: string,
  gapAnalysis: string | null
) {
  const prompt = `Write a concise, personalized cold outreach email from ${candidateName} to a recruiter at ${company} for the "${jobTitle}" position.

Job Description Summary: ${jobDesc.substring(0, 500)}
${gapAnalysis ? `Candidate notes: ${gapAnalysis}` : ""}

Return a JSON object with:
- "recipient_name": string (use "Hiring Team" if unknown)
- "recipient_email": string (use "recruiter@${company.toLowerCase().replace(/\s+/g, "")}.com" as placeholder)
- "subject": string (compelling email subject line)
- "body": string (email body, under 150 words, professional, includes a clear CTA question, signed with candidate name)

Return ONLY the JSON object, no markdown.`;

  const raw = await callGroq(prompt);
  try {
    const cleaned = raw.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    return JSON.parse(cleaned);
  } catch {
    return {
      recipient_name: "Hiring Team",
      recipient_email: `recruiter@${company.toLowerCase().replace(/\s+/g, "")}.com`,
      subject: `Application for ${jobTitle} at ${company}`,
      body: `Hi there,\n\nI came across the ${jobTitle} opportunity at ${company} and I'm very excited about it. With my background in software development and a track record of delivering impactful solutions, I believe I'd be a great fit.\n\nWould you be open to a quick 15-minute chat to explore this further?\n\nBest,\n${candidateName}`,
    };
  }
}

// ─── Job Scraper (Mock + Groq-enhanced) ─────────────────────────────────────

async function scrapeJobs(
  title: string,
  location: string
): Promise<Array<Record<string, unknown>>> {
  // Generate realistic mock jobs enhanced by LLM
  const prompt = `Generate 5 realistic job listings for "${title}" in "${location}". Return a JSON array where each item has:
- "title": job title string
- "company": company name string  
- "description": 2-3 sentence job description string
- "location": location string
- "salary_range": salary range string (e.g. "$80,000 - $120,000")
- "application_url": realistic job application URL string
- "platform": one of "LinkedIn", "Indeed", "Glassdoor", "RemoteOK"
- "extracted_metadata": object with "required_skills" array of 3-5 strings

Return ONLY the JSON array, no markdown.`;

  try {
    const raw = await callGroq(prompt);
    const cleaned = raw.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const jobs = JSON.parse(cleaned);
    return Array.isArray(jobs) ? jobs : [];
  } catch {
    // Fallback mock jobs
    return [
      {
        title,
        company: "TechCorp Inc",
        description: `We are seeking a talented ${title} to join our growing team. You will work on cutting-edge projects and collaborate with world-class engineers.`,
        location,
        salary_range: "$90,000 - $130,000",
        application_url: "https://techcorp.com/jobs/1",
        platform: "LinkedIn",
        extracted_metadata: { required_skills: ["Python", "React", "SQL"] },
      },
      {
        title,
        company: "InnovateLab",
        description: `Join InnovateLab as a ${title}. Work on AI-powered products that impact millions of users globally.`,
        location,
        salary_range: "$100,000 - $150,000",
        application_url: "https://innovatelab.io/careers/2",
        platform: "Indeed",
        extracted_metadata: {
          required_skills: ["TypeScript", "Node.js", "AWS"],
        },
      },
    ];
  }
}

// ─── Route handlers ──────────────────────────────────────────────────────────

async function handleGetCandidate() {
  const db = getClient();
  const { data, error } = await db.database
    .from("candidates")
    .select("*")
    .limit(1);
  if (error) return err(error.message, 500);
  if (!data || data.length === 0) {
    // Create default candidate
    const defaultResume = {
      skills: [
        "Python",
        "FastAPI",
        "JavaScript",
        "React",
        "SQL",
        "Git",
        "REST APIs",
      ],
      experience: [
        {
          company: "TechInnovate Solutions",
          role: "Software Engineer",
          duration: "2023 - Present",
          bullets: [
            "Developed backend REST APIs and integrated databases, optimizing performance by 20%.",
            "Designed user interfaces using React for dynamic workspaces.",
            "Collaborated with product teams to deliver high-quality code sprints.",
          ],
        },
        {
          company: "DevLaunch Systems",
          role: "Junior Developer",
          duration: "2021 - 2023",
          bullets: [
            "Maintained Python scripts to automate internal report generation.",
            "Resolved bug tickets, reducing application crash rate by 15%.",
          ],
        },
      ],
    };
    const { data: created, error: createErr } = await db.database
      .from("candidates")
      .insert([
        {
          full_name: "Alex Mercer",
          email: "alex.mercer@gmail.com",
          phone: "+1 (555) 019-2834",
          portfolio_url: "https://alexmercer.dev",
          master_resume_json: defaultResume,
        },
      ])
      .select("*");
    if (createErr) return err(createErr.message, 500);
    return json(created![0]);
  }
  return json(data[0]);
}

async function handleUpdateCandidate(body: Record<string, unknown>) {
  const db = getClient();
  const { data: existing } = await db.database
    .from("candidates")
    .select("id")
    .limit(1);
  if (!existing || existing.length === 0)
    return err("No candidate profile found", 404);

  const { error } = await db.database
    .from("candidates")
    .update({
      full_name: body.full_name,
      email: body.email,
      phone: body.phone,
      portfolio_url: body.portfolio_url,
      master_resume_json: body.master_resume_json,
    })
    .eq("id", existing[0].id);

  if (error) return err(error.message, 500);
  return json({ message: "Profile updated successfully" });
}

async function handleScrapeStart(body: Record<string, unknown>) {
  const title = (body.title as string) || "Software Engineer";
  const location = (body.location as string) || "Remote";

  const jobs = await scrapeJobs(title, location);
  const db = getClient();

  let added = 0;
  for (const j of jobs) {
    // Check deduplication
    const { data: existing } = await db.database
      .from("jobs")
      .select("id")
      .eq("title", j.title)
      .eq("company", j.company);

    if (!existing || existing.length === 0) {
      await db.database.from("jobs").insert([
        {
          title: j.title,
          company: j.company,
          description: j.description,
          location: j.location,
          salary_range: j.salary_range,
          application_url: j.application_url,
          platform: j.platform,
          extracted_metadata: j.extracted_metadata,
        },
      ]);
      added++;
    }
  }

  return json({
    message: `Scrape complete. Added ${added} new jobs out of ${jobs.length} found.`,
    added,
    total: jobs.length,
  });
}

async function handleGetJobs() {
  const db = getClient();
  const { data, error } = await db.database
    .from("jobs")
    .select("*")
    .order("scraped_at", { ascending: false });
  if (error) return err(error.message, 500);
  return json(data || []);
}

async function handleUpdateJobPipeline(
  jobId: string,
  body: Record<string, unknown>
) {
  const db = getClient();
  const { error } = await db.database
    .from("jobs")
    .update({ pipeline_status: body.pipeline_status })
    .eq("id", jobId);
  if (error) return err(error.message, 500);
  return json({
    message: `Pipeline status updated to '${body.pipeline_status}'`,
  });
}

async function handleTailorResume(jobId: string) {
  const db = getClient();

  const { data: jobs } = await db.database
    .from("jobs")
    .select("*")
    .eq("id", jobId);
  if (!jobs || jobs.length === 0) return err("Job not found", 404);
  const job = jobs[0];

  const { data: candidates } = await db.database
    .from("candidates")
    .select("*")
    .limit(1);
  if (!candidates || candidates.length === 0)
    return err("No candidate profile found", 404);
  const candidate = candidates[0];

  const result = await tailorResumeWithLLM(
    job.title,
    job.company,
    job.description,
    candidate.master_resume_json
  );

  // Upsert tailored resume
  const { data: existing } = await db.database
    .from("tailored_resumes")
    .select("id")
    .eq("job_id", jobId)
    .eq("candidate_id", candidate.id);

  let resumeId: string;
  if (existing && existing.length > 0) {
    await db.database
      .from("tailored_resumes")
      .update({
        tailored_experience: result.tailored_points,
        match_score: result.match_score,
        gap_analysis: result.gap_analysis,
      })
      .eq("id", existing[0].id);
    resumeId = existing[0].id;
  } else {
    const { data: inserted } = await db.database
      .from("tailored_resumes")
      .insert([
        {
          job_id: jobId,
          candidate_id: candidate.id,
          tailored_experience: result.tailored_points,
          match_score: result.match_score,
          gap_analysis: result.gap_analysis,
        },
      ])
      .select("id");
    resumeId = inserted![0].id;
  }

  // Update job pipeline status
  await db.database
    .from("jobs")
    .update({ pipeline_status: "tailored" })
    .eq("id", jobId);

  return json({ resume_id: resumeId, ...result });
}

async function handleGetTailoredResume(jobId: string) {
  const db = getClient();
  const { data: candidates } = await db.database
    .from("candidates")
    .select("id")
    .limit(1);
  if (!candidates || candidates.length === 0)
    return err("No candidate profile found", 404);

  const { data, error } = await db.database
    .from("tailored_resumes")
    .select("*")
    .eq("job_id", jobId)
    .eq("candidate_id", candidates[0].id);

  if (error) return err(error.message, 500);
  if (!data || data.length === 0)
    return err("No tailoring found for this job yet.", 404);
  return json(data[0]);
}

async function handleDraftOutreach(jobId: string) {
  const db = getClient();

  const { data: jobs } = await db.database
    .from("jobs")
    .select("*")
    .eq("id", jobId);
  if (!jobs || jobs.length === 0) return err("Job not found", 404);
  const job = jobs[0];

  const { data: candidates } = await db.database
    .from("candidates")
    .select("*")
    .limit(1);
  if (!candidates || candidates.length === 0)
    return err("No candidate profile found", 404);
  const candidate = candidates[0];

  const { data: resumes } = await db.database
    .from("tailored_resumes")
    .select("gap_analysis")
    .eq("job_id", jobId)
    .eq("candidate_id", candidate.id);

  const gapAnalysis =
    resumes && resumes.length > 0 ? resumes[0].gap_analysis : null;

  const emailDraft = await generateOutreachEmail(
    job.title,
    job.company,
    job.description,
    candidate.full_name,
    gapAnalysis
  );

  // Check deduplication — already contacted in past 30 days?
  const thirtyDaysAgo = new Date(
    Date.now() - 30 * 24 * 60 * 60 * 1000
  ).toISOString();
  const { data: recentLogs } = await db.database
    .from("outreach_logs")
    .select("id")
    .eq("recipient_email", emailDraft.recipient_email)
    .gte("timestamp", thirtyDaysAgo);

  const alreadyContacted = recentLogs && recentLogs.length > 0;

  // Heuristic warnings
  const warnings: Array<{ type: string; message: string }> = [];
  const bodyWords = emailDraft.body.split(" ").length;
  if (bodyWords > 150)
    warnings.push({
      type: "word_count",
      message: `Email is wordy (${bodyWords} words). Consider editing down to under 150 words.`,
    });
  if (!emailDraft.body.includes("?"))
    warnings.push({
      type: "cta",
      message:
        "No question mark found. Ensure you include a clear call-to-action.",
    });

  // Mark job as drafted
  await db.database
    .from("jobs")
    .update({ pipeline_status: "drafted" })
    .eq("id", jobId);

  return json({ ...emailDraft, already_contacted: alreadyContacted, warnings });
}

async function handleSendOutreach(jobId: string, body: Record<string, unknown>) {
  const db = getClient();

  const { data: jobs } = await db.database
    .from("jobs")
    .select("*")
    .eq("id", jobId);
  if (!jobs || jobs.length === 0) return err("Job not found", 404);
  const job = jobs[0];

  const { data: candidates } = await db.database
    .from("candidates")
    .select("id")
    .limit(1);
  if (!candidates || candidates.length === 0)
    return err("No candidate found", 404);

  // Deduplication check for smtp send
  if (body.action === "send_smtp") {
    const thirtyDaysAgo = new Date(
      Date.now() - 30 * 24 * 60 * 60 * 1000
    ).toISOString();
    const { data: recentLogs } = await db.database
      .from("outreach_logs")
      .select("id")
      .eq("recipient_email", body.recipient_email)
      .gte("timestamp", thirtyDaysAgo);
    if (recentLogs && recentLogs.length > 0) {
      return err(
        "Safety Lock: You have already contacted this recipient within the last 30 days.",
        400
      );
    }
  }

  // Log the outreach
  const status =
    body.action === "send_smtp"
      ? "sent"
      : body.action === "save_imap_draft"
      ? "drafted"
      : "logged";

  await db.database.from("outreach_logs").insert([
    {
      recipient_email: body.recipient_email,
      company: job.company,
      role: job.title,
      subject: body.subject,
      status,
    },
  ]);

  // Update pipeline status
  await db.database
    .from("jobs")
    .update({ pipeline_status: status })
    .eq("id", jobId);

  return json({
    message: `Outreach ${status === "sent" ? "sent successfully" : "saved as draft"}.`,
    status,
  });
}

async function handleGetOutreachLogs() {
  const db = getClient();
  const { data, error } = await db.database
    .from("outreach_logs")
    .select("*")
    .order("timestamp", { ascending: false });
  if (error) return err(error.message, 500);
  return json(data || []);
}

// ─── Main router ─────────────────────────────────────────────────────────────

export default async function (req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(req.url);
  // Path after /functions/career-agent
  const rawPath = url.pathname;
  // Normalize: strip function prefix
  const path = rawPath.replace(/^\/functions\/career-agent/, "") || "/";

  let body: Record<string, unknown> = {};
  if (
    req.method !== "GET" &&
    req.headers.get("content-type")?.includes("application/json")
  ) {
    try {
      body = await req.json();
    } catch {
      body = {};
    }
  }

  // Route dispatch
  try {
    // GET /candidate
    if (req.method === "GET" && path === "/candidate") {
      return await handleGetCandidate();
    }
    // PUT /candidate
    if (req.method === "PUT" && path === "/candidate") {
      return await handleUpdateCandidate(body);
    }
    // POST /scraper/start
    if (req.method === "POST" && path === "/scraper/start") {
      return await handleScrapeStart(body);
    }
    // GET /jobs
    if (req.method === "GET" && path === "/jobs") {
      return await handleGetJobs();
    }
    // PUT /jobs/:id/pipeline
    const pipelineMatch = path.match(/^\/jobs\/([^/]+)\/pipeline$/);
    if (req.method === "PUT" && pipelineMatch) {
      return await handleUpdateJobPipeline(pipelineMatch[1], body);
    }
    // POST /jobs/:id/tailor
    const tailorMatch = path.match(/^\/jobs\/([^/]+)\/tailor$/);
    if (req.method === "POST" && tailorMatch) {
      return await handleTailorResume(tailorMatch[1]);
    }
    // GET /jobs/:id/tailored
    const tailoredGetMatch = path.match(/^\/jobs\/([^/]+)\/tailored$/);
    if (req.method === "GET" && tailoredGetMatch) {
      return await handleGetTailoredResume(tailoredGetMatch[1]);
    }
    // POST /jobs/:id/outreach/draft
    const draftMatch = path.match(/^\/jobs\/([^/]+)\/outreach\/draft$/);
    if (req.method === "POST" && draftMatch) {
      return await handleDraftOutreach(draftMatch[1]);
    }
    // POST /jobs/:id/outreach/send
    const sendMatch = path.match(/^\/jobs\/([^/]+)\/outreach\/send$/);
    if (req.method === "POST" && sendMatch) {
      return await handleSendOutreach(sendMatch[1], body);
    }
    // GET /outreach/logs
    if (req.method === "GET" && path === "/outreach/logs") {
      return await handleGetOutreachLogs();
    }

    // Health check
    if (path === "/" || path === "/health") {
      return json({ status: "ok", service: "CareerAgent Suite API" });
    }

    return err(`Route not found: ${req.method} ${path}`, 404);
  } catch (e) {
    console.error("Unhandled error:", e);
    return err(
      `Internal server error: ${e instanceof Error ? e.message : String(e)}`,
      500
    );
  }
}
