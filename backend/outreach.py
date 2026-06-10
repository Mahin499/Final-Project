import os
import smtplib
import imaplib
import email
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import datetime
from sqlalchemy.orm import Session
from .models import OutreachLog, Job

# Settings loaded from environment
SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SENDER_NAME = os.getenv("SENDER_NAME", "Job Candidate")
DRY_RUN = os.getenv("DRY_RUN", "true").lower() == "true"

def verify_deduplication(db: Session, recipient_email: str) -> bool:
    """
    Returns True if recipient_email has already been contacted in the last 30 days.
    """
    thirty_days_ago = datetime.datetime.utcnow() - datetime.timedelta(days=30)
    existing_log = db.query(OutreachLog).filter(
        OutreachLog.recipient_email == recipient_email,
        OutreachLog.processed_at >= thirty_days_ago,
        OutreachLog.delivery_status == "sent"
    ).first()
    return existing_log is not None

def send_smtp_email(recipient_email, subject, body):
    """
    Sends an email using secure SMTP.
    If DRY_RUN=True, it will only log the action.
    """
    if DRY_RUN:
        print(f"[DRY RUN] Email would be sent to: {recipient_email}")
        return True, "DRY_RUN: Simulated email sent successfully."
        
    if not SMTP_USER or not SMTP_PASSWORD:
        return False, "SMTP Configuration Error: SMTP_USER or SMTP_PASSWORD is not set."
        
    try:
        msg = MIMEMultipart()
        msg['From'] = f"{SENDER_NAME} <{SMTP_USER}>"
        msg['To'] = recipient_email
        msg['Subject'] = subject
        msg.attach(MIMEText(body, 'plain'))
        
        server = smtplib.SMTP(SMTP_HOST, SMTP_PORT)
        server.starttls()
        server.login(SMTP_USER, SMTP_PASSWORD)
        server.sendmail(SMTP_USER, recipient_email, msg.as_string())
        server.close()
        
        return True, "Email sent successfully."
    except Exception as e:
        print(f"SMTP Error: {e}")
        return False, f"SMTP Error: {str(e)}"

def save_imap_draft(recipient_email, subject, body):
    """
    Appends an email draft directly to Gmail's Drafts folder using IMAP.
    If DRY_RUN=True, it will only log the action.
    """
    if DRY_RUN:
        print(f"[DRY RUN] Email draft would be saved for: {recipient_email}")
        return True, "DRY_RUN: Simulated draft created successfully."

    if not SMTP_USER or not SMTP_PASSWORD:
        return False, "IMAP Configuration Error: SMTP_USER or SMTP_PASSWORD is not set."

    try:
        # Construct message
        msg = MIMEMultipart()
        msg['From'] = f"{SENDER_NAME} <{SMTP_USER}>"
        msg['To'] = recipient_email
        msg['Subject'] = subject
        msg.attach(MIMEText(body, 'plain'))

        # Standard Gmail IMAP
        imap_host = "imap.gmail.com"
        mail = imaplib.IMAP4_SSL(imap_host)
        mail.login(SMTP_USER, SMTP_PASSWORD)
        
        # Select Drafts folder (Gmail standard name is '[Gmail]/Drafts')
        # We try both common folder names
        draft_folder = '[Gmail]/Drafts'
        select_status, _ = mail.select(draft_folder)
        if select_status != 'OK':
            draft_folder = 'Drafts'
            mail.select(draft_folder)

        # Append message to folder
        import time
        mail.append(draft_folder, '', imaplib.Time2Internaldate(time.time()), msg.as_bytes())
        mail.logout()
        return True, "Draft saved successfully in Gmail."
    except Exception as e:
        print(f"IMAP Error: {e}")
        return False, f"IMAP Error: {str(e)}"
