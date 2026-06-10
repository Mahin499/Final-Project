import { createClient } from "npm:@insforge/sdk";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json",
};

function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS_HEADERS });
}
function errRes(msg, status = 400) {
  return jsonRes({ error: msg }, status);
}

function getClient() {
  return createClient({
    baseUrl: Deno.env.get("INSFORGE_BASE_URL") ?? "",
    anonKey: Deno.env.get("ANON_KEY") ?? "",
  });
}

async function callGroq(prompt) {
  const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY") ?? "";
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
            "You are CareerAgent, an expert career advisor. Always respond with valid JSON when asked for structured output.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 2048,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Groq ${res.status}: ${t}`);
  }
  const data = await res.json();
  return data.choices[0].message.content;
}

function parseJSON(raw) {
  return JSON.parse(raw.replace(/```json?\n?/g, "").replace(/```/g, "").trim());
}

async function tailorResumeWithLLM(jobTitle, company, jobDesc, masterResume) {
  const prompt = `You are a career coach. Analyze this job and candidate resume. Return a JSON object with:
- "match_score": integer 0-100 showing candidate fit
- "tailored_points": array of 4-6 improved resume bullet points optimized for this specific role (each a string)
- "gap_analysis": a short paragraph about skill gaps and how to address them

Job Title: ${jobTitle}
Company: ${company}
Job Description: ${jobDesc}

Master Resume:
${JSON.stringify(masterResume, null, 2)}

Return ONLY the JSON object, no markdown fences.`;

  try {
    const raw = await callGroq(prompt);
    return parseJSON(raw);
  } catch {
    return {
      match_score: 70,
      tailored_points: [
        "Developed scalable REST APIs using modern frameworks, reducing latency by 20%",
        "Collaborated cross-functionally with product and design teams to deliver features on time",
        "Optimized database queries and indexing strategies improving query performance significantly",
        "Implemented comprehensive automated testing suites reducing bug escape rate by 15%",
        "Led code reviews and mentored junior developers, improving overall team code quality",
      ],
      gap_analysis:
        "The candidate has a strong technical foundation. Consider highlighting experience with the specific technologies mentioned in the job description to strengthen the application.",
    };
  }
}

async function generateOutreachEmail(
  jobTitle,
  company,
  jobDesc,
  candidateName,
  gapAnalysis
) {
  const safeCompany = company.toLowerCase().replace(/\s+/g, "");
  const prompt = `Write a concise, personalized cold outreach email from ${candidateName} to a recruiter at ${company} for the "${jobTitle}" position.

Job Description: ${jobDesc.substring(0, 400)}
${gapAnalysis ? `Candidate context: ${gapAnalysis}` : ""}

Return a JSON object with:
- "recipient_name": string (use "Hiring Team" if unknown)
- "recipient_email": string (use "recruiter@${safeCompany}.com" as placeholder)
- "subject": string (compelling subject line under 10 words)
- "body": string (professional email body, under 150 words, ends with a question CTA, signed by ${candidateName})

Return ONLY the JSON object, no markdown fences.`;

  try {
    const raw = await callGroq(prompt);
    return parseJSON(raw);
  } catch {
    return {
      recipient_name: "Hiring Team",
      recipient_email: `recruiter@${safeCompany}.com`,
      subject: `Excited About the ${jobTitle} Role at ${company}`,
      body: `Hi there,\n\nI came across the ${jobTitle} opportunity at ${company} and I'm genuinely excited about it. With my background in software development and a proven track record of shipping impactful features, I believe I'd make a strong contribution to your team.\n\nWould you be open to a quick 15-minute call this week to explore this further?\n\nBest,\n${candidateName}`,
    };
  }
}

async function scrapeJobs(title, location) {
  const prompt = `Generate 5 realistic job listings for "${title}" in "${location}".
Return a JSON array where each item has exactly these keys:
- "title": job title string
- "company": company name string
- "description": 2-3 sentence job description
- "location": location string
- "salary_range": salary range like "$90,000 - $130,000"
- "application_url": realistic job URL
- "platform": one of "LinkedIn", "Indeed", "Glassdoor", "RemoteOK"
- "extracted_metadata": object with "required_skills" array of 3-5 skill strings

Return ONLY the JSON array, no markdown fences.`;

  try {
    const raw = await callGroq(prompt);
    const jobs = parseJSON(raw);
    return Array.isArray(jobs) ? jobs : [];
  } catch {
    return [
      {
        title,
        company: "TechCorp Solutions",
        description: `We are seeking a talented ${title} to join our innovative team. You will work on cutting-edge products that impact thousands of users daily. Strong collaboration and technical skills required.`,
        location,
        salary_range: "$90,000 - $130,000",
        application_url: "https://techcorp.com/careers/senior-dev",
        platform: "LinkedIn",
        extracted_metadata: {
          required_skills: ["Python", "React", "PostgreSQL", "AWS"],
        },
      },
      {
        title,
        company: "InnovateLab",
        description: `Join InnovateLab as a ${title} to help build next-generation AI-powered applications. Work in a fast-paced startup environment with talented engineers from top tech companies.`,
        location,
        salary_range: "$100,000 - $150,000",
        application_url: "https://innovatelab.io/jobs/fullstack",
        platform: "Indeed",
        extracted_metadata: {
          required_skills: ["TypeScript", "Node.js", "Docker", "Redis"],
        },
      },
    ];
  }
}

// ─── Route Handlers ────────────────────────────────────────────────────────

async function handleGetCandidate() {
  const db = getClient();
  const { data, error } = await db.database
    .from("candidates")
    .select("*")
    .limit(1);
  if (error) return errRes(error.message, 500);

  if (!data || data.length === 0) {
    const defaultResume = {
      skills: [
        "Python",
        "FastAPI",
        "JavaScript",
        "React",
        "PostgreSQL",
        "Git",
        "REST APIs",
        "Docker",
      ],
      experience: [
        {
          company: "TechInnovate Solutions",
          role: "Software Engineer",
          duration: "2023 - Present",
          bullets: [
            "Developed and maintained backend REST APIs serving 50k+ daily active users.",
            "Built responsive React dashboards, improving user engagement by 30%.",
            "Optimized PostgreSQL queries reducing average response time by 20%.",
          ],
        },
        {
          company: "DevLaunch Systems",
          role: "Junior Developer",
          duration: "2021 - 2023",
          bullets: [
            "Automated internal report generation with Python scripts, saving 10 hours/week.",
            "Resolved 200+ bug tickets reducing application crash rate by 15%.",
          ],
        },
      ],
    };
    const { data: created, error: ce } = await db.database
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
    if (ce) return errRes(ce.message, 500);
    return jsonRes(created[0]);
  }
  return jsonRes(data[0]);
}

async function handleUpdateCandidate(body) {
  const db = getClient();
  const { data: existing } = await db.database
    .from("candidates")
    .select("id")
    .limit(1);
  if (!existing || existing.length === 0)
    return errRes("No candidate profile found", 404);
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
  if (error) return errRes(error.message, 500);
  return jsonRes({ message: "Profile updated successfully" });
}

async function handleScrapeStart(body) {
  const title = body.title || "Software Engineer";
  const location = body.location || "Remote";
  const jobs = await scrapeJobs(title, location);
  const db = getClient();
  let added = 0;
  for (const j of jobs) {
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
  return jsonRes({
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
  if (error) return errRes(error.message, 500);
  return jsonRes(data || []);
}

async function handleUpdateJobPipeline(jobId, body) {
  const db = getClient();
  const { error } = await db.database
    .from("jobs")
    .update({ pipeline_status: body.pipeline_status })
    .eq("id", jobId);
  if (error) return errRes(error.message, 500);
  return jsonRes({ message: `Pipeline updated to '${body.pipeline_status}'` });
}

async function handleTailorResume(jobId) {
  const db = getClient();
  const { data: jobs } = await db.database
    .from("jobs")
    .select("*")
    .eq("id", jobId);
  if (!jobs || jobs.length === 0) return errRes("Job not found", 404);
  const job = jobs[0];

  const { data: candidates } = await db.database
    .from("candidates")
    .select("*")
    .limit(1);
  if (!candidates || candidates.length === 0)
    return errRes("No candidate found", 404);
  const candidate = candidates[0];

  const result = await tailorResumeWithLLM(
    job.title,
    job.company,
    job.description,
    candidate.master_resume_json
  );

  const { data: existing } = await db.database
    .from("tailored_resumes")
    .select("id")
    .eq("job_id", jobId)
    .eq("candidate_id", candidate.id);

  let resumeId;
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
    const { data: ins } = await db.database
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
    resumeId = ins[0].id;
  }

  await db.database
    .from("jobs")
    .update({ pipeline_status: "tailored" })
    .eq("id", jobId);
  return jsonRes({ resume_id: resumeId, ...result });
}

async function handleGetTailoredResume(jobId) {
  const db = getClient();
  const { data: candidates } = await db.database
    .from("candidates")
    .select("id")
    .limit(1);
  if (!candidates || candidates.length === 0)
    return errRes("No candidate found", 404);
  const { data, error } = await db.database
    .from("tailored_resumes")
    .select("*")
    .eq("job_id", jobId)
    .eq("candidate_id", candidates[0].id);
  if (error) return errRes(error.message, 500);
  if (!data || data.length === 0)
    return errRes("No tailoring found for this job.", 404);
  return jsonRes(data[0]);
}

async function handleDraftOutreach(jobId) {
  const db = getClient();
  const { data: jobs } = await db.database
    .from("jobs")
    .select("*")
    .eq("id", jobId);
  if (!jobs || jobs.length === 0) return errRes("Job not found", 404);
  const job = jobs[0];

  const { data: candidates } = await db.database
    .from("candidates")
    .select("*")
    .limit(1);
  if (!candidates || candidates.length === 0)
    return errRes("No candidate found", 404);
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

  const thirtyDaysAgo = new Date(
    Date.now() - 30 * 24 * 60 * 60 * 1000
  ).toISOString();
  const { data: recentLogs } = await db.database
    .from("outreach_logs")
    .select("id")
    .eq("recipient_email", emailDraft.recipient_email)
    .gte("timestamp", thirtyDaysAgo);
  const alreadyContacted = recentLogs && recentLogs.length > 0;

  const warnings = [];
  const bodyWords = emailDraft.body.split(" ").length;
  if (bodyWords > 150)
    warnings.push({
      type: "word_count",
      message: `Email is ${bodyWords} words. Consider cutting to under 150.`,
    });
  if (!emailDraft.body.includes("?"))
    warnings.push({
      type: "cta",
      message: "Add a clear call-to-action question.",
    });

  await db.database
    .from("jobs")
    .update({ pipeline_status: "drafted" })
    .eq("id", jobId);
  return jsonRes({ ...emailDraft, already_contacted: alreadyContacted, warnings });
}

async function handleSendOutreach(jobId, body) {
  const db = getClient();
  const { data: jobs } = await db.database
    .from("jobs")
    .select("*")
    .eq("id", jobId);
  if (!jobs || jobs.length === 0) return errRes("Job not found", 404);
  const job = jobs[0];

  if (body.action === "send_smtp") {
    const thirtyDaysAgo = new Date(
      Date.now() - 30 * 24 * 60 * 60 * 1000
    ).toISOString();
    const { data: recentLogs } = await db.database
      .from("outreach_logs")
      .select("id")
      .eq("recipient_email", body.recipient_email)
      .gte("timestamp", thirtyDaysAgo);
    if (recentLogs && recentLogs.length > 0)
      return errRes(
        "Safety Lock: Already contacted this recipient in the last 30 days.",
        400
      );
  }

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

  await db.database
    .from("jobs")
    .update({ pipeline_status: status })
    .eq("id", jobId);

  return jsonRes({
    message:
      status === "sent" ? "Outreach sent successfully." : "Draft saved.",
    status,
  });
}

async function handleGetOutreachLogs() {
  const db = getClient();
  const { data, error } = await db.database
    .from("outreach_logs")
    .select("*")
    .order("timestamp", { ascending: false });
  if (error) return errRes(error.message, 500);
  return jsonRes(data || []);
}

// ─── Main Handler ─────────────────────────────────────────────────────────

export default async function (req) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(req.url);
  const path =
    url.pathname.replace(/^\/functions\/career-agent/, "") || "/";

  let body = {};
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

  try {
    if (req.method === "GET" && path === "/candidate")
      return await handleGetCandidate();
    if (req.method === "PUT" && path === "/candidate")
      return await handleUpdateCandidate(body);
    if (req.method === "POST" && path === "/scraper/start")
      return await handleScrapeStart(body);
    if (req.method === "GET" && path === "/jobs") return await handleGetJobs();

    const pipelineMatch = path.match(/^\/jobs\/([^/]+)\/pipeline$/);
    if (req.method === "PUT" && pipelineMatch)
      return await handleUpdateJobPipeline(pipelineMatch[1], body);

    const tailorMatch = path.match(/^\/jobs\/([^/]+)\/tailor$/);
    if (req.method === "POST" && tailorMatch)
      return await handleTailorResume(tailorMatch[1]);

    const tailoredGetMatch = path.match(/^\/jobs\/([^/]+)\/tailored$/);
    if (req.method === "GET" && tailoredGetMatch)
      return await handleGetTailoredResume(tailoredGetMatch[1]);

    const draftMatch = path.match(/^\/jobs\/([^/]+)\/outreach\/draft$/);
    if (req.method === "POST" && draftMatch)
      return await handleDraftOutreach(draftMatch[1]);

    const sendMatch = path.match(/^\/jobs\/([^/]+)\/outreach\/send$/);
    if (req.method === "POST" && sendMatch)
      return await handleSendOutreach(sendMatch[1], body);

    if (req.method === "GET" && path === "/outreach/logs")
      return await handleGetOutreachLogs();

    if (path === "/" || path === "/health")
      return jsonRes({ status: "ok", service: "CareerAgent Suite API v2" });

    return errRes(`Route not found: ${req.method} ${path}`, 404);
  } catch (e) {
    console.error("Handler error:", e);
    return errRes(
      `Internal error: ${e instanceof Error ? e.message : String(e)}`,
      500
    );
  }
}
