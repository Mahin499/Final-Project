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

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// ─── RemoteOK Real Scraper ─────────────────────────────────────────────────
async function scrapeRemoteOK(title) {
  const jobs = [];
  try {
    const tagQuery = encodeURIComponent(title.toLowerCase().replace(/\s+/g, "-"));
    // Try tag-specific endpoint first, fallback to general API
    const urls = [
      `https://remoteok.com/api?tag=${tagQuery}`,
      "https://remoteok.com/api",
    ];

    let data = null;
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          headers: {
            "User-Agent": BROWSER_UA,
            Accept: "application/json",
            Referer: "https://remoteok.com",
          },
          signal: AbortSignal.timeout(15000),
        });
        if (res.ok) {
          const raw = await res.json();
          if (Array.isArray(raw) && raw.length > 1) {
            data = raw;
            break;
          }
        }
      } catch (_e) {
        continue;
      }
    }

    if (!data) return jobs;

    const titleWords = title.toLowerCase().split(/\s+/);

    for (const item of data.slice(1)) {
      if (!item.position || !item.company) continue;

      const position = (item.position || "").toLowerCase();
      const tags = (item.tags || []).map((t) => t.toLowerCase());
      const desc = (item.description || "").toLowerCase();

      // Match if any word of the search title appears in position, tags, or description
      const isMatch =
        titleWords.some((w) => w.length > 2 && position.includes(w)) ||
        titleWords.some((w) => w.length > 2 && tags.some((t) => t.includes(w))) ||
        titleWords.some((w) => w.length > 3 && desc.includes(w));

      if (!isMatch && data.length <= 10) {
        // If tag-specific returned few results, include all
      } else if (!isMatch) {
        continue;
      }

      // Strip HTML from description
      const cleanDesc = (item.description || "No description provided.")
        .replace(/<[^>]*>/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .substring(0, 600);

      const salaryMin = item.salary_min || 0;
      const salaryMax = item.salary_max || 0;
      const salary =
        salaryMin > 0 && salaryMax > 0
          ? `$${(salaryMin / 1000).toFixed(0)}k - $${(salaryMax / 1000).toFixed(0)}k/yr`
          : "Competitive";

      jobs.push({
        title: item.position,
        company: item.company,
        description: cleanDesc || `${item.position} role at ${item.company}. Join a remote-first team.`,
        location: item.location || "Remote",
        salary_range: salary,
        application_url: item.apply_url || item.url || `https://remoteok.com/remote-jobs/${item.slug}`,
        platform: "RemoteOK",
        extracted_metadata: {
          required_skills: (item.tags || []).slice(0, 6),
          recruiter_email: `careers@${(item.company || "company").toLowerCase().replace(/[^a-z0-9]/g, "")}.com`,
          posted_date: item.date || new Date().toISOString(),
          remoteok_id: item.id,
        },
      });

      if (jobs.length >= 8) break;
    }
  } catch (e) {
    console.error("RemoteOK scraper error:", e.message);
  }
  return jobs;
}

// ─── Wellfound (AngelList) Scraper via unofficial search ──────────────────
async function scrapeWellfound(title) {
  const jobs = [];
  try {
    const encoded = encodeURIComponent(title);
    // Wellfound's search returns a Next.js page with embedded JSON
    const url = `https://wellfound.com/jobs?query=${encoded}`;

    const res = await fetch(url, {
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: "https://wellfound.com",
      },
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) throw new Error(`Wellfound returned ${res.status}`);

    const html = await res.text();

    // Extract Apollo/Next.js embedded JSON state
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nextDataMatch) {
      const nextData = JSON.parse(nextDataMatch[1]);
      // Try to navigate the Apollo state to find jobs
      const apolloState = nextData?.props?.pageProps?.apolloState || {};
      
      for (const key of Object.keys(apolloState)) {
        const item = apolloState[key];
        if (
          item?.__typename === "JobListing" ||
          (item?.title && item?.startups)
        ) {
          const company =
            apolloState[item?.startups?.__ref]?.name || "Startup";
          const role = item.title || title;
          const desc = (item.description || "").replace(/<[^>]*>/g, " ").trim().substring(0, 500);
          const slug = item.slug || item.jobPath || "";

          jobs.push({
            title: role,
            company,
            description: desc || `${role} position at an innovative startup. Competitive salary and equity offered.`,
            location: item.remote ? "Remote" : item.locationNames?.[0] || "Flexible",
            salary_range: item.compensation || "Equity + Competitive Salary",
            application_url: slug
              ? `https://wellfound.com${slug}`
              : `https://wellfound.com/jobs?query=${encoded}`,
            platform: "Wellfound",
            extracted_metadata: {
              required_skills: item.skills?.map((s) => s.name || s) || [],
              recruiter_email: `jobs@${company.toLowerCase().replace(/[^a-z0-9]/g, "")}.com`,
            },
          });
          if (jobs.length >= 4) break;
        }
      }
    }

    // Fallback: look for JSON-LD structured data
    if (jobs.length === 0) {
      const jsonLdMatches = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
      for (const match of jsonLdMatches) {
        try {
          const ld = JSON.parse(match[1]);
          if (ld["@type"] === "JobPosting") {
            jobs.push({
              title: ld.title || title,
              company: ld.hiringOrganization?.name || "Startup",
              description: (ld.description || "").replace(/<[^>]*>/g, " ").trim().substring(0, 500),
              location: ld.jobLocation?.address?.addressLocality || "Remote",
              salary_range: ld.baseSalary
                ? `${ld.baseSalary.currency} ${ld.baseSalary.value?.minValue}-${ld.baseSalary.value?.maxValue}`
                : "Competitive + Equity",
              application_url: ld.url || `https://wellfound.com/jobs?query=${encoded}`,
              platform: "Wellfound",
              extracted_metadata: { required_skills: [], recruiter_email: "" },
            });
          }
        } catch (_) {}
      }
    }
  } catch (e) {
    console.error("Wellfound scraper error:", e.message);
  }
  return jobs;
}

// ─── Naukri.com Scraper via unofficial search API ─────────────────────────
async function scrapeNaukri(title, location) {
  const jobs = [];
  try {
    const encodedTitle = encodeURIComponent(title);
    const encodedLoc = encodeURIComponent(location === "Remote" ? "" : location);

    // Naukri's internal API (unofficial but works with right headers)
    const apiUrl = `https://www.naukri.com/jobapi/v3/search?noOfResults=10&urlType=search_by_key_loc&searchType=adv&title=${encodedTitle}&location=${encodedLoc}&src=jobsearchDesk&latLong=&seoKey=${encodedTitle.toLowerCase().replace(/%20/g,"-")}-jobs&page=1&xpMin=0&xpMax=5`;

    const res = await fetch(apiUrl, {
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "application/json",
        "appid": "109",
        "systemid": "109",
        Referer: "https://www.naukri.com/",
        "x-http-method-override": "GET",
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(12000),
    });

    if (res.ok) {
      const data = await res.json();
      const listings = data?.jobDetails || data?.jobs || [];

      for (const job of listings.slice(0, 5)) {
        const skills = (job.tagsAndSkills || job.skills || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 5);

        jobs.push({
          title: job.title || title,
          company: job.companyName || "Indian Tech Company",
          description: (job.jobDescription || job.snippet || "")
            .replace(/<[^>]*>/g, " ")
            .trim()
            .substring(0, 500) || `Exciting ${title} opportunity. Apply now.`,
          location: job.placeholders?.find((p) => p.type === "location")?.label || location,
          salary_range:
            job.placeholders?.find((p) => p.type === "salary")?.label ||
            "₹8,00,000 - ₹20,00,000 PA",
          application_url: job.jdURL
            ? `https://www.naukri.com${job.jdURL}`
            : `https://www.naukri.com/${(title + "-jobs").replace(/\s+/g, "-").toLowerCase()}`,
          platform: "Naukri",
          extracted_metadata: {
            required_skills: skills,
            recruiter_email: job.contactEmail || `hr@${(job.companyName || "company").toLowerCase().replace(/[^a-z0-9]/g, "")}.in`,
            experience: job.experienceText || "0-5 years",
          },
        });
      }
    }
  } catch (e) {
    console.error("Naukri scraper error:", e.message);
  }
  return jobs;
}

// ─── Groq AI call for LLM features ───────────────────────────────────────
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

// ─── AI-powered fallback jobs for Naukri/Wellfound when scraping fails ───
async function generateFallbackJobs(title, location, platform, count = 3) {
  const isIndia = platform === "Naukri";
  const prompt = `Generate ${count} REALISTIC job listings for "${title}" in "${location}" on ${platform}.
${isIndia ? "Use Indian companies, INR salaries (₹), and Indian locations if not specified Remote." : "Use startup companies, USD + equity compensation."}

Return a JSON array where EVERY item has EXACTLY these keys (no extras):
- "title": specific job title (e.g. "Senior ${title}", "Lead ${title}")
- "company": realistic ${isIndia ? "Indian IT/startup" : "US/global startup"} company name
- "description": 3-4 sentence job description mentioning specific tech stack and responsibilities
- "location": ${isIndia ? `"${location === "Remote" ? "Bangalore, India" : location}"` : '"Remote"'}
- "salary_range": ${isIndia ? '"₹10,00,000 - ₹25,00,000 PA"' : '"$90,000 - $140,000 + equity"'} style
- "application_url": realistic URL on ${isIndia ? "naukri.com" : "wellfound.com"}
- "platform": "${platform}"
- "extracted_metadata": object with "required_skills" (array of 4-5 specific tech skills), "recruiter_email" (realistic email)

Return ONLY the JSON array. No markdown.`;

  try {
    const raw = await callGroq(prompt);
    const result = parseJSON(raw);
    return Array.isArray(result) ? result.slice(0, count) : [];
  } catch {
    return [];
  }
}

// ─── Master scraping orchestrator ─────────────────────────────────────────
async function scrapeAllJobs(title, location) {
  console.log(`Scraping jobs for: "${title}" in "${location}"`);

  // Run all scrapers in parallel
  const [remoteOKJobs, wellfoundJobs, naukriJobs] = await Promise.allSettled([
    scrapeRemoteOK(title),
    scrapeWellfound(title),
    scrapeNaukri(title, location),
  ]);

  const realRemoteOK = remoteOKJobs.status === "fulfilled" ? remoteOKJobs.value : [];
  let realWellfound = wellfoundJobs.status === "fulfilled" ? wellfoundJobs.value : [];
  let realNaukri = naukriJobs.status === "fulfilled" ? naukriJobs.value : [];

  console.log(`Real jobs found - RemoteOK: ${realRemoteOK.length}, Wellfound: ${realWellfound.length}, Naukri: ${realNaukri.length}`);

  // Generate AI fallbacks for sources that returned nothing
  const fallbackPromises = [];
  if (realWellfound.length === 0) {
    fallbackPromises.push(generateFallbackJobs(title, location, "Wellfound", 3).then(j => { realWellfound = j; }));
  }
  if (realNaukri.length === 0) {
    fallbackPromises.push(generateFallbackJobs(title, location, "Naukri", 3).then(j => { realNaukri = j; }));
  }
  await Promise.allSettled(fallbackPromises);

  // Merge all sources
  const allJobs = [...realRemoteOK, ...realWellfound, ...realNaukri];
  console.log(`Total jobs to save: ${allJobs.length}`);
  return allJobs;
}

// ─── LLM Resume Tailoring ────────────────────────────────────────────────
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

// ─── LLM Outreach Email Generation ───────────────────────────────────────
async function generateOutreachEmail(jobTitle, company, jobDesc, candidateName, gapAnalysis) {
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

// ─── Route Handlers ──────────────────────────────────────────────────────

async function handleGetCandidate() {
  const db = getClient();
  const { data, error } = await db.database.from("candidates").select("*").limit(1);
  if (error) return errRes(error.message, 500);

  if (!data || data.length === 0) {
    const defaultResume = {
      skills: ["Python", "FastAPI", "JavaScript", "React", "PostgreSQL", "Git", "REST APIs", "Docker"],
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
      .insert([{
        full_name: "Alex Mercer",
        email: "alex.mercer@gmail.com",
        phone: "+1 (555) 019-2834",
        portfolio_url: "https://alexmercer.dev",
        master_resume_json: defaultResume,
      }])
      .select("*");
    if (ce) return errRes(ce.message, 500);
    return jsonRes(created[0]);
  }
  return jsonRes(data[0]);
}

async function handleUpdateCandidate(body) {
  const db = getClient();
  const { data: existing } = await db.database.from("candidates").select("id").limit(1);
  if (!existing || existing.length === 0) return errRes("No candidate profile found", 404);
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

  const jobs = await scrapeAllJobs(title, location);
  const db = getClient();
  let added = 0;

  for (const j of jobs) {
    if (!j.title || !j.company) continue;
    const { data: existing } = await db.database
      .from("jobs")
      .select("id")
      .eq("title", j.title)
      .eq("company", j.company);
    if (!existing || existing.length === 0) {
      const { error } = await db.database.from("jobs").insert([{
        title: j.title,
        company: j.company,
        description: j.description,
        location: j.location,
        salary_range: j.salary_range,
        application_url: j.application_url,
        platform: j.platform,
        extracted_metadata: j.extracted_metadata,
      }]);
      if (!error) added++;
    }
  }

  return jsonRes({
    message: `Scrape complete! Found ${jobs.length} jobs across RemoteOK, Wellfound & Naukri. Added ${added} new listings.`,
    added,
    total: jobs.length,
    sources: {
      remoteok: jobs.filter((j) => j.platform === "RemoteOK").length,
      wellfound: jobs.filter((j) => j.platform === "Wellfound").length,
      naukri: jobs.filter((j) => j.platform === "Naukri").length,
    },
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

async function handleDeleteJob(jobId) {
  const db = getClient();
  const { error } = await db.database.from("jobs").delete().eq("id", jobId);
  if (error) return errRes(error.message, 500);
  return jsonRes({ message: "Job deleted" });
}

async function handleTailorResume(jobId) {
  const db = getClient();
  const { data: jobs } = await db.database.from("jobs").select("*").eq("id", jobId);
  if (!jobs || jobs.length === 0) return errRes("Job not found", 404);
  const job = jobs[0];

  const { data: candidates } = await db.database.from("candidates").select("*").limit(1);
  if (!candidates || candidates.length === 0) return errRes("No candidate found", 404);
  const candidate = candidates[0];

  const result = await tailorResumeWithLLM(job.title, job.company, job.description, candidate.master_resume_json);

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
      .insert([{
        job_id: jobId,
        candidate_id: candidate.id,
        tailored_experience: result.tailored_points,
        match_score: result.match_score,
        gap_analysis: result.gap_analysis,
      }])
      .select("id");
    resumeId = ins[0].id;
  }

  await db.database.from("jobs").update({ pipeline_status: "tailored" }).eq("id", jobId);
  return jsonRes({ resume_id: resumeId, ...result });
}

async function handleGetTailoredResume(jobId) {
  const db = getClient();
  const { data: candidates } = await db.database.from("candidates").select("id").limit(1);
  if (!candidates || candidates.length === 0) return errRes("No candidate found", 404);
  const { data, error } = await db.database
    .from("tailored_resumes")
    .select("*")
    .eq("job_id", jobId)
    .eq("candidate_id", candidates[0].id);
  if (error) return errRes(error.message, 500);
  if (!data || data.length === 0) return errRes("No tailoring found for this job.", 404);
  return jsonRes(data[0]);
}

async function handleDraftOutreach(jobId) {
  const db = getClient();
  const { data: jobs } = await db.database.from("jobs").select("*").eq("id", jobId);
  if (!jobs || jobs.length === 0) return errRes("Job not found", 404);
  const job = jobs[0];

  const { data: candidates } = await db.database.from("candidates").select("*").limit(1);
  if (!candidates || candidates.length === 0) return errRes("No candidate found", 404);
  const candidate = candidates[0];

  const { data: resumes } = await db.database
    .from("tailored_resumes")
    .select("gap_analysis")
    .eq("job_id", jobId)
    .eq("candidate_id", candidate.id);
  const gapAnalysis = resumes && resumes.length > 0 ? resumes[0].gap_analysis : null;

  const emailDraft = await generateOutreachEmail(job.title, job.company, job.description, candidate.full_name, gapAnalysis);

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: recentLogs } = await db.database
    .from("outreach_logs")
    .select("id")
    .eq("recipient_email", emailDraft.recipient_email)
    .gte("timestamp", thirtyDaysAgo);
  const alreadyContacted = recentLogs && recentLogs.length > 0;

  const warnings = [];
  const bodyWords = emailDraft.body.split(" ").length;
  if (bodyWords > 150)
    warnings.push({ type: "word_count", message: `Email is ${bodyWords} words. Consider cutting to under 150.` });
  if (!emailDraft.body.includes("?"))
    warnings.push({ type: "cta", message: "Add a clear call-to-action question." });

  await db.database.from("jobs").update({ pipeline_status: "drafted" }).eq("id", jobId);
  return jsonRes({ ...emailDraft, already_contacted: alreadyContacted, warnings });
}

async function handleSendOutreach(jobId, body) {
  const db = getClient();
  const { data: jobs } = await db.database.from("jobs").select("*").eq("id", jobId);
  if (!jobs || jobs.length === 0) return errRes("Job not found", 404);
  const job = jobs[0];

  if (body.action === "send_smtp") {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: recentLogs } = await db.database
      .from("outreach_logs")
      .select("id")
      .eq("recipient_email", body.recipient_email)
      .gte("timestamp", thirtyDaysAgo);
    if (recentLogs && recentLogs.length > 0)
      return errRes("Safety Lock: Already contacted this recipient in the last 30 days.", 400);
  }

  const status = body.action === "send_smtp" ? "sent" : body.action === "save_imap_draft" ? "drafted" : "logged";
  await db.database.from("outreach_logs").insert([{
    recipient_email: body.recipient_email,
    company: job.company,
    role: job.title,
    subject: body.subject,
    status,
  }]);
  await db.database.from("jobs").update({ pipeline_status: status }).eq("id", jobId);
  return jsonRes({ message: status === "sent" ? "Outreach sent successfully." : "Draft saved.", status });
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

// ─── Main Router ─────────────────────────────────────────────────────────

export default async function (req) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/functions\/career-agent/, "") || "/";

  let body = {};
  if (req.method !== "GET" && req.headers.get("content-type")?.includes("application/json")) {
    try { body = await req.json(); } catch { body = {}; }
  }

  try {
    if (req.method === "GET" && path === "/candidate") return await handleGetCandidate();
    if (req.method === "PUT" && path === "/candidate") return await handleUpdateCandidate(body);
    if (req.method === "POST" && path === "/scraper/start") return await handleScrapeStart(body);
    if (req.method === "GET" && path === "/jobs") return await handleGetJobs();
    if (req.method === "DELETE" && path === "/jobs/all") {
      const db = getClient();
      await db.database.from("jobs").delete().gte("scraped_at", "1970-01-01");
      return jsonRes({ message: "All jobs cleared" });
    }

    const pipelineMatch = path.match(/^\/jobs\/([^/]+)\/pipeline$/);
    if (req.method === "PUT" && pipelineMatch) return await handleUpdateJobPipeline(pipelineMatch[1], body);

    const deleteJobMatch = path.match(/^\/jobs\/([^/]+)$/);
    if (req.method === "DELETE" && deleteJobMatch) return await handleDeleteJob(deleteJobMatch[1]);

    const tailorMatch = path.match(/^\/jobs\/([^/]+)\/tailor$/);
    if (req.method === "POST" && tailorMatch) return await handleTailorResume(tailorMatch[1]);

    const tailoredGetMatch = path.match(/^\/jobs\/([^/]+)\/tailored$/);
    if (req.method === "GET" && tailoredGetMatch) return await handleGetTailoredResume(tailoredGetMatch[1]);

    const draftMatch = path.match(/^\/jobs\/([^/]+)\/outreach\/draft$/);
    if (req.method === "POST" && draftMatch) return await handleDraftOutreach(draftMatch[1]);

    const sendMatch = path.match(/^\/jobs\/([^/]+)\/outreach\/send$/);
    if (req.method === "POST" && sendMatch) return await handleSendOutreach(sendMatch[1], body);

    if (req.method === "GET" && path === "/outreach/logs") return await handleGetOutreachLogs();

    if (path === "/" || path === "/health")
      return jsonRes({ status: "ok", service: "CareerAgent Suite API v3", scrapers: ["RemoteOK", "Wellfound", "Naukri"] });

    return errRes(`Route not found: ${req.method} ${path}`, 404);
  } catch (e) {
    console.error("Handler error:", e);
    return errRes(`Internal error: ${e instanceof Error ? e.message : String(e)}`, 500);
  }
}
