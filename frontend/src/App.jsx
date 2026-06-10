import React, { useState, useEffect } from 'react';

const API_BASE = 'http://localhost:8000';

function App() {
  const [activeTab, setActiveTab] = useState('jobs');
  const [jobs, setJobs] = useState([]);
  const [selectedJob, setSelectedJob] = useState(null);
  const [searchQuery, setSearchQuery] = useState('FastAPI Developer');
  const [scraping, setScraping] = useState(false);
  const [scrapeMsg, setScrapeMsg] = useState('');

  // Tailored Resume state
  const [tailoredData, setTailoredData] = useState(null);
  const [tailoring, setTailoring] = useState(false);

  // Email outreach state
  const [emailDraft, setEmailDraft] = useState(null);
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState('');

  // Logs and Profile state
  const [logs, setLogs] = useState([]);
  const [profile, setProfile] = useState(null);
  const [isEditingProfile, setIsEditingProfile] = useState(false);

  // Load initial data
  useEffect(() => {
    fetchJobs();
    fetchLogs();
    fetchProfile();
  }, []);

  const fetchJobs = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/jobs`);
      if (res.ok) {
        const data = await res.json();
        setJobs(data);
        // Automatically select the first job if none is selected
        if (data.length > 0 && !selectedJob) {
          setSelectedJob(data[0]);
          loadJobDetails(data[0].id);
        }
      }
    } catch (err) {
      console.error("Error fetching jobs:", err);
    }
  };

  const fetchLogs = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/outreach/logs`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data);
      }
    } catch (err) {
      console.error("Error fetching logs:", err);
    }
  };

  const fetchProfile = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/candidate`);
      if (res.ok) {
        const data = await res.json();
        setProfile(data);
      }
    } catch (err) {
      console.error("Error fetching profile:", err);
    }
  };

  const loadJobDetails = async (jobId) => {
    setTailoredData(null);
    setEmailDraft(null);
    setSendMsg('');
    
    // Check if job already has tailoring done
    try {
      const res = await fetch(`${API_BASE}/api/jobs/${jobId}/tailored`);
      if (res.ok) {
        const data = await res.json();
        setTailoredData({
          match_score: data.match_score,
          gap_analysis: data.gap_analysis,
          tailored_points: data.tailored_experience
        });
      }
    } catch (err) {
      // Tailoring might not exist yet, which is fine
    }
  };

  const handleJobSelect = (job) => {
    setSelectedJob(job);
    loadJobDetails(job.id);
  };

  const handleScrape = async (e) => {
    e.preventDefault();
    setScraping(true);
    setScrapeMsg("Starting scrapers...");
    try {
      const res = await fetch(`${API_BASE}/api/scraper/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: searchQuery })
      });
      if (res.ok) {
        setScrapeMsg("Scraper running in background. Reloading list in 3s...");
        setTimeout(() => {
          fetchJobs();
          setScrapeMsg('');
          setScraping(false);
        }, 3000);
      } else {
        setScrapeMsg("Scraper failed to trigger.");
        setScraping(false);
      }
    } catch (err) {
      setScrapeMsg("Connection error.");
      setScraping(false);
    }
  };

  const handleTailor = async () => {
    if (!selectedJob) return;
    setTailoring(true);
    try {
      const res = await fetch(`${API_BASE}/api/jobs/${selectedJob.id}/tailor`, {
        method: 'POST'
      });
      if (res.ok) {
        const data = await res.json();
        setTailoredData({
          match_score: data.match_score,
          gap_analysis: data.gap_analysis,
          tailored_points: data.tailored_points
        });
        fetchJobs(); // reload to update status badges
      }
    } catch (err) {
      console.error("Tailoring connection error:", err);
    } finally {
      setTailoring(false);
    }
  };

  const handleDraftEmail = async () => {
    if (!selectedJob) return;
    setDrafting(true);
    try {
      const res = await fetch(`${API_BASE}/api/jobs/${selectedJob.id}/outreach/draft`, {
        method: 'POST'
      });
      if (res.ok) {
        const data = await res.json();
        setEmailDraft(data);
        fetchJobs(); // Update status badge to drafted
      }
    } catch (err) {
      console.error("Email draft generation error:", err);
    } finally {
      setDrafting(false);
    }
  };

  const handleSendEmail = async (action) => {
    if (!selectedJob || !emailDraft) return;
    setSending(true);
    setSendMsg('');
    try {
      const res = await fetch(`${API_BASE}/api/jobs/${selectedJob.id}/outreach/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient_email: emailDraft.recipient_email,
          subject: emailDraft.subject,
          body: emailDraft.body,
          action: action
        })
      });
      const data = await res.json();
      if (res.ok) {
        setSendMsg(`Success: ${data.message}`);
        // Reset local state & update pipelines
        fetchJobs();
        fetchLogs();
        // Update selected job pipeline status locally
        setSelectedJob(prev => ({ ...prev, pipeline_status: data.status === "sent" ? "sent" : "drafted" }));
      } else {
        setSendMsg(`Error: ${data.detail || "Failed operation"}`);
      }
    } catch (err) {
      setSendMsg("Outreach connection error.");
    } finally {
      setSending(false);
    }
  };

  const handleUpdateProfile = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE}/api/candidate`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile)
      });
      if (res.ok) {
        setIsEditingProfile(false);
        fetchProfile();
      }
    } catch (err) {
      console.error("Error saving profile:", err);
    }
  };

  const handleProfileFieldChange = (field, val) => {
    setProfile(prev => ({
      ...prev,
      [field]: val
    }));
  };

  const handleSkillsChange = (val) => {
    const list = val.split(',').map(s => s.trim());
    setProfile(prev => ({
      ...prev,
      master_resume_json: {
        ...prev.master_resume_json,
        skills: list
      }
    }));
  };

  return (
    <div className="app-container">
      {/* Header */}
      <header className="header">
        <div className="logo-section">
          <h1>CareerAgent Suite</h1>
          <div className="logo-subtitle">Unified Job Scraper, Resume Tailor & Email Outreach Engine</div>
        </div>
        
        <div className="tabs-header">
          <button 
            className={`tab-btn ${activeTab === 'jobs' ? 'active' : ''}`}
            onClick={() => setActiveTab('jobs')}
          >
            Job Board & Workspace
          </button>
          <button 
            className={`tab-btn ${activeTab === 'logs' ? 'active' : ''}`}
            onClick={() => setActiveTab('logs')}
          >
            Outreach History Logs
          </button>
          <button 
            className={`tab-btn ${activeTab === 'profile' ? 'active' : ''}`}
            onClick={() => setActiveTab('profile')}
          >
            Candidate Profile
          </button>
        </div>
      </header>

      {/* Main Content Areas */}
      {activeTab === 'jobs' && (
        <div className="dashboard-grid">
          {/* Sidebar */}
          <aside className="sidebar">
            {/* Scraper controls */}
            <div className="glass-panel scraper-panel">
              <h3>Discover Jobs</h3>
              <form onSubmit={handleScrape}>
                <div style={{ marginBottom: '12px' }}>
                  <label style={{ fontSize: '12px', color: 'hsl(var(--text-secondary))', display: 'block', marginBottom: '6px' }}>
                    Job Keyword
                  </label>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="form-input"
                    placeholder="e.g. FastAPI Developer"
                    required
                  />
                </div>
                <button type="submit" disabled={scraping} className="btn-premium" style={{ width: '100%' }}>
                  {scraping ? 'Searching...' : 'Scrape Job Boards'}
                </button>
              </form>
              {scrapeMsg && (
                <div style={{ fontSize: '12px', color: 'hsl(var(--accent-blue))', marginTop: '4px', textAlign: 'center' }}>
                  {scrapeMsg}
                </div>
              )}
            </div>

            {/* Scraped listings list */}
            <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '12px', flexGrow: 1 }}>
              <h3>Discovered Jobs ({jobs.length})</h3>
              
              {jobs.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-icon">🔍</div>
                  <p>No jobs scraped yet. Enter a query above to start discovery.</p>
                </div>
              ) : (
                <div className="job-list">
                  {jobs.map((job) => (
                    <div 
                      key={job.id} 
                      className={`job-card ${selectedJob?.id === job.id ? 'selected' : ''}`}
                      onClick={() => handleJobSelect(job)}
                    >
                      <div className="job-card-header">
                        <span className="job-company">{job.company}</span>
                        <span className={`job-badge ${job.platform}`}>{job.platform}</span>
                      </div>
                      <div className="job-title">{job.title}</div>
                      <div className="job-card-details">
                        <span>📍 {job.location || 'Remote'}</span>
                        <span>💰 {job.salary_range || 'Not Disclosed'}</span>
                      </div>
                      <div className="job-card-footer">
                        <span style={{ fontSize: '11px', color: 'hsl(var(--text-muted))' }}>
                          Scraped: {new Date(job.scraped_at).toLocaleDateString()}
                        </span>
                        <span className={`pipeline-badge ${job.pipeline_status}`}>
                          {job.pipeline_status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>

          {/* Main Workspace Area */}
          <main className="workspace glass-panel">
            {selectedJob ? (
              <div className="detail-view-grid">
                
                {/* Column 1: Job Details & Resume tailoring */}
                <div className="detail-column">
                  <div>
                    <span className="job-company" style={{ fontSize: '14px' }}>{selectedJob.company}</span>
                    <h2 style={{ fontSize: '26px', margin: '4px 0 8px 0' }}>{selectedJob.title}</h2>
                    <div className="job-card-details" style={{ marginBottom: '16px', fontSize: '14px' }}>
                      <span>📍 {selectedJob.location || 'Remote'}</span>
                      <span>💰 {selectedJob.salary_range || 'Not Disclosed'}</span>
                      <span>🔗 <a href={selectedJob.application_url} target="_blank" rel="noopener noreferrer" style={{ color: 'hsl(var(--accent-blue))' }}>View Source Listing</a></span>
                    </div>
                    
                    <div style={{ maxHeight: '180px', overflowY: 'auto', padding: '12px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', fontSize: '13px', border: '1px solid rgba(255,255,255,0.03)', color: 'hsl(var(--text-secondary))' }}>
                      <h4 style={{ color: '#fff', marginBottom: '8px' }}>Job Description</h4>
                      <p style={{ whiteSpace: 'pre-wrap' }}>{selectedJob.description}</p>
                    </div>
                  </div>

                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '20px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                      <h3>Tailored Resume Alignment</h3>
                      {!tailoredData && (
                        <button 
                          onClick={handleTailor} 
                          disabled={tailoring} 
                          className="btn-premium"
                        >
                          {tailoring ? 'Tailoring Bullets...' : 'Align Resume via LLM'}
                        </button>
                      )}
                    </div>

                    {tailoring && (
                      <div className="loading-container">
                        <div className="spinner"></div>
                        <p>Llama 3.1 is analyzing requirements and re-writing bullets...</p>
                      </div>
                    )}

                    {tailoredData && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        {/* Match Dial & Gap card */}
                        <div className="match-header-section">
                          <div 
                            className="score-dial-container" 
                            style={{ '--score': tailoredData.match_score }}
                          >
                            <div className="score-dial-inner">
                              <span className="score-value">{tailoredData.match_score}%</span>
                              <span className="score-label">MATCH</span>
                            </div>
                          </div>

                          <div className="gap-analysis-card" style={{ flexGrow: 1 }}>
                            <h4 style={{ color: '#ff8787', fontSize: '14px' }}>Requirement Gap Flags</h4>
                            {tailoredData.gap_analysis.missing_required_skills.length > 0 ? (
                              <div className="gap-skills-list">
                                {tailoredData.gap_analysis.missing_required_skills.map((s, i) => (
                                  <span key={i} className="gap-skill-tag">{s}</span>
                                ))}
                              </div>
                            ) : (
                              <p style={{ fontSize: '13px', color: '#8ce99a', marginTop: '6px' }}>✓ Candidate matches all core requirements.</p>
                            )}
                            <ul className="action-items-list">
                              {tailoredData.gap_analysis.action_items.map((item, i) => (
                                <li key={i}>{item}</li>
                              ))}
                            </ul>
                          </div>
                        </div>

                        {/* Rephrased points */}
                        <div>
                          <h4 style={{ marginBottom: '8px' }}>Experience Bullet Customization</h4>
                          <div className="bullets-comparison-list" style={{ maxHeight: '240px', overflowY: 'auto' }}>
                            {tailoredData.tailored_points.map((pt, idx) => (
                              <div key={idx} className="bullet-comparison-row">
                                <div className="bullet-original">
                                  <div style={{ fontSize: '10px', textTransform: 'uppercase', color: 'hsl(var(--text-muted))', marginBottom: '4px' }}>Original bullet ({pt.company})</div>
                                  {pt.original_bullet}
                                </div>
                                <div className="bullet-tailored">
                                  <div style={{ fontSize: '10px', textTransform: 'uppercase', color: '#4ade80', marginBottom: '4px' }}>Tailored bullet</div>
                                  {pt.recommended_bullet}
                                </div>
                                <div className="bullet-reason">
                                  💡 {pt.reason}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Column 2: Email outreach bot */}
                <div className="detail-column" style={{ borderLeft: '1px solid rgba(255,255,255,0.08)', paddingLeft: '24px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <h3>Personalized Recruiter Outreach</h3>
                    {tailoredData && !emailDraft && (
                      <button 
                        onClick={handleDraftEmail} 
                        disabled={drafting} 
                        className="btn-premium"
                      >
                        {drafting ? 'Generating...' : 'Compose Outreach Email'}
                      </button>
                    )}
                  </div>

                  {!tailoredData && (
                    <div className="empty-state" style={{ padding: '80px 20px' }}>
                      <p>Tailor your resume first to customize outreach based on compatibility gaps.</p>
                    </div>
                  )}

                  {tailoredData && !emailDraft && !drafting && (
                    <div className="empty-state" style={{ padding: '80px 20px' }}>
                      <p>Click "Compose Outreach Email" to write a tailored message via Llama 3.1.</p>
                    </div>
                  )}

                  {drafting && (
                    <div className="loading-container">
                      <div className="spinner"></div>
                      <p>Drafting cold outreach email aligned with job stack...</p>
                    </div>
                  )}

                  {emailDraft && (
                    <div className="email-editor-form">
                      {/* Dedupe Warnings */}
                      {emailDraft.already_contacted && (
                        <div className="dedupe-alert">
                          ⚠️ <strong>Deduplication Warning:</strong> You have already sent an outreach email to this company/address within the last 30 days. Double check to avoid spam.
                        </div>
                      )}

                      {/* Warnings banner */}
                      {emailDraft.warnings.length > 0 && (
                        <div className="warning-banner">
                          <h5>⚠️ Heuristic Quality Alerts</h5>
                          <ul style={{ paddingLeft: '16px', fontSize: '12px' }}>
                            {emailDraft.warnings.map((w, idx) => (
                              <li key={idx}>{w.message}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <div>
                          <label style={{ fontSize: '12px', color: 'hsl(var(--text-secondary))', display: 'block', marginBottom: '4px' }}>Recipient Email</label>
                          <input 
                            type="email" 
                            className="form-input" 
                            value={emailDraft.recipient_email}
                            onChange={(e) => setEmailDraft({...emailDraft, recipient_email: e.target.value})}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: '12px', color: 'hsl(var(--text-secondary))', display: 'block', marginBottom: '4px' }}>Subject Line</label>
                          <input 
                            type="text" 
                            className="form-input" 
                            value={emailDraft.subject}
                            onChange={(e) => setEmailDraft({...emailDraft, subject: e.target.value})}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: '12px', color: 'hsl(var(--text-secondary))', display: 'block', marginBottom: '4px' }}>Email Body</label>
                          <textarea 
                            rows="12" 
                            className="form-input" 
                            style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: '12px', lineHeight: '1.5' }}
                            value={emailDraft.body}
                            onChange={(e) => setEmailDraft({...emailDraft, body: e.target.value})}
                          />
                        </div>
                      </div>

                      {/* Send Actions */}
                      <div className="email-actions">
                        <button 
                          disabled={sending} 
                          onClick={() => handleSendEmail('save_imap_draft')}
                          className="btn-secondary"
                        >
                          Save Gmail Draft
                        </button>
                        <button 
                          disabled={sending || emailDraft.already_contacted} 
                          onClick={() => handleSendEmail('send_smtp')}
                          className="btn-premium"
                        >
                          {sending ? 'Sending...' : 'Send Outreach'}
                        </button>
                      </div>

                      {sendMsg && (
                        <div style={{ 
                          padding: '10px', 
                          borderRadius: '6px', 
                          fontSize: '13px', 
                          textAlign: 'center',
                          backgroundColor: sendMsg.startsWith('Success') ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                          color: sendMsg.startsWith('Success') ? '#4ade80' : '#ff8787',
                          border: sendMsg.startsWith('Success') ? '1px solid rgba(34, 197, 94, 0.2)' : '1px solid rgba(239, 68, 68, 0.2)'
                        }}>
                          {sendMsg}
                        </div>
                      )}
                    </div>
                  )}
                </div>

              </div>
            ) : (
              <div className="empty-state" style={{ padding: '120px 20px' }}>
                <div className="empty-state-icon">💻</div>
                <h2>Select a Job to Get Started</h2>
                <p>Pick a scraped job listing from the sidebar to start resume tailoring and recruitment email compose.</p>
              </div>
            )}
          </main>
        </div>
      )}

      {activeTab === 'logs' && (
        <div className="glass-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h2>Outreach Delivery History Logs</h2>
            <button onClick={fetchLogs} className="btn-secondary">Refresh History</button>
          </div>
          
          {logs.length === 0 ? (
            <div className="empty-state">
              <p>No outreach emails sent or drafted yet.</p>
            </div>
          ) : (
            <table className="logs-table">
              <thead>
                <tr>
                  <th>Recipient</th>
                  <th>Subject</th>
                  <th>Delivery Action</th>
                  <th>Date & Time</th>
                  <th>SMTP Status Log</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td>{log.recipient_email}</td>
                    <td style={{ fontWeight: '500' }}>{log.subject}</td>
                    <td>
                      <span className={`pipeline-badge ${log.delivery_status}`}>
                        {log.delivery_status}
                      </span>
                    </td>
                    <td>{new Date(log.processed_at).toLocaleString()}</td>
                    <td style={{ fontSize: '12px', color: 'hsl(var(--text-secondary))' }}>
                      {log.smtp_response_message}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === 'profile' && (
        <div className="glass-panel" style={{ maxWidth: '800px', margin: '0 auto' }}>
          <h2>Candidate Master Profile</h2>
          <p style={{ color: 'hsl(var(--text-secondary))', marginBottom: '20px' }}>
            This profile is loaded by default as your background information for the LLM tailoring engine.
          </p>

          {profile && (
            <form onSubmit={handleUpdateProfile}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                <div>
                  <label style={{ fontSize: '12px', color: 'hsl(var(--text-secondary))', display: 'block', marginBottom: '4px' }}>Full Name</label>
                  <input 
                    type="text" 
                    className="form-input" 
                    value={profile.full_name}
                    onChange={(e) => handleProfileFieldChange('full_name', e.target.value)}
                    disabled={!isEditingProfile}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '12px', color: 'hsl(var(--text-secondary))', display: 'block', marginBottom: '4px' }}>Email Address</label>
                  <input 
                    type="email" 
                    className="form-input" 
                    value={profile.email}
                    onChange={(e) => handleProfileFieldChange('email', e.target.value)}
                    disabled={!isEditingProfile}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '12px', color: 'hsl(var(--text-secondary))', display: 'block', marginBottom: '4px' }}>Phone Number</label>
                  <input 
                    type="text" 
                    className="form-input" 
                    value={profile.phone}
                    onChange={(e) => handleProfileFieldChange('phone', e.target.value)}
                    disabled={!isEditingProfile}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '12px', color: 'hsl(var(--text-secondary))', display: 'block', marginBottom: '4px' }}>Portfolio URL</label>
                  <input 
                    type="text" 
                    className="form-input" 
                    value={profile.portfolio_url}
                    onChange={(e) => handleProfileFieldChange('portfolio_url', e.target.value)}
                    disabled={!isEditingProfile}
                  />
                </div>
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label style={{ fontSize: '12px', color: 'hsl(var(--text-secondary))', display: 'block', marginBottom: '4px' }}>
                  Skills (comma-separated)
                </label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={profile.master_resume_json.skills.join(', ')}
                  onChange={(e) => handleSkillsChange(e.target.value)}
                  disabled={!isEditingProfile}
                />
              </div>

              <div>
                <h3 style={{ marginBottom: '10px' }}>Work Experience Bullet Points</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {profile.master_resume_json.experience.map((exp, idx) => (
                    <div key={idx} style={{ padding: '16px', background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.04)', borderRadius: '8px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: '600', color: 'hsl(var(--accent-blue))', marginBottom: '8px' }}>
                        <span>{exp.company} - {exp.role}</span>
                        <span style={{ color: 'hsl(var(--text-secondary))' }}>{exp.duration}</span>
                      </div>
                      <ul style={{ paddingLeft: '20px', fontSize: '13px', color: 'hsl(var(--text-secondary))' }}>
                        {exp.bullets.map((bullet, bIdx) => (
                          <li key={bIdx} style={{ marginBottom: '6px' }}>{bullet}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ marginTop: '24px', display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                {isEditingProfile ? (
                  <>
                    <button type="button" onClick={() => setIsEditingProfile(false)} className="btn-secondary">
                      Cancel
                    </button>
                    <button type="submit" className="btn-premium">
                      Save Profile Updates
                    </button>
                  </>
                ) : (
                  <button type="button" onClick={() => setIsEditingProfile(true)} className="btn-premium">
                    Edit Profile Details
                  </button>
                )}
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
