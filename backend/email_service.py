import asyncio
import logging
import os
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
from html import escape
from pathlib import Path

from branding import get_pdf_brand_logo_bytes

logger = logging.getLogger("asset-maintenance.email")

ASSET_DIR = Path(__file__).resolve().parent / "assets"
DEFAULT_LOGO = ASSET_DIR / "amt-mark-tagline.png"


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.environ.get(name, "true" if default else "false")
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _smtp_config() -> dict:
    host = os.environ.get("SMTP_HOST", "").strip()
    port = int(os.environ.get("SMTP_PORT", "587"))
    secure = _env_bool("SMTP_SECURE", False)
    starttls = _env_bool("SMTP_STARTTLS", not secure)
    username = os.environ.get("SMTP_USER", "").strip()
    password = os.environ.get("SMTP_PASS", "")
    sender = os.environ.get("SMTP_FROM", username).strip()
    reply_to = os.environ.get("SMTP_REPLY_TO", username).strip()

    missing = [
        name
        for name, value in {
            "SMTP_HOST": host,
            "SMTP_USER": username,
            "SMTP_PASS": password,
            "SMTP_FROM": sender,
            "SMTP_REPLY_TO": reply_to,
        }.items()
        if not value
    ]
    if missing:
        raise RuntimeError(
            "SMTP configuration is incomplete: " + ", ".join(missing)
        )

    return {
        "host": host,
        "port": port,
        "secure": secure,
        "starttls": starttls,
        "username": username,
        "password": password,
        "sender": sender,
        "reply_to": reply_to,
    }


def _image_subtype(data: bytes) -> str:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return "png"


async def _current_logo_bytes() -> bytes | None:
    try:
        current = await get_pdf_brand_logo_bytes()
        if current:
            return current
    except Exception:
        logger.exception(
            "Unable to load current company logo; using default AMT logo"
        )

    try:
        if DEFAULT_LOGO.is_file():
            return DEFAULT_LOGO.read_bytes()
    except Exception:
        logger.exception("Unable to load default AMT email logo")
    return None


def _build_password_reset_message(
    *,
    recipient: str,
    display_name: str,
    reset_url: str,
    expires_minutes: int,
    logo_bytes: bytes | None,
) -> EmailMessage:
    cfg = _smtp_config()
    safe_name = escape(display_name or "AMT user")
    safe_url = escape(reset_url, quote=True)
    support = escape(cfg["reply_to"])

    msg = EmailMessage()
    msg["Subject"] = "Reset your AMT password"
    msg["From"] = cfg["sender"]
    msg["To"] = recipient
    msg["Reply-To"] = cfg["reply_to"]
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid(domain="logisourcedigital.web.id")
    msg["Auto-Submitted"] = "auto-generated"
    msg["X-Auto-Response-Suppress"] = "All"

    text_body = (
        f"Hello {display_name or 'AMT user'},\n\n"
        "We received a request to reset your AMT password.\n\n"
        f"Reset password: {reset_url}\n\n"
        f"This link expires in {expires_minutes} minutes and can be used once.\n"
        "If you did not request this reset, you can ignore this email.\n\n"
        "This message was sent from an unmonitored address. "
        f"If you need help, reply to this email or contact {cfg['reply_to']}.\n\n"
        "Powered by LogiSource Digital"
    )
    msg.set_content(text_body)

    logo_html = ""
    if logo_bytes:
        logo_html = (
            '<img src="cid:amt-current-company-logo" '
            'alt="AMT" width="220" '
            'style="display:block;max-width:220px;width:100%;height:auto;'
            'margin:0 auto 20px auto;border:0;outline:none;text-decoration:none;">'
        )

    html_body = f'''<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f1f5f9;padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;">
            <tr>
              <td style="padding:36px 36px 28px 36px;">
                {logo_html}
                <h1 style="margin:0 0 12px 0;font-size:24px;line-height:32px;color:#0f172a;text-align:center;">Reset your password</h1>
                <p style="margin:0 0 20px 0;font-size:15px;line-height:24px;color:#475569;">Hello {safe_name},</p>
                <p style="margin:0 0 24px 0;font-size:15px;line-height:24px;color:#475569;">We received a request to reset the password for your AMT account. Use the button below to create a new password.</p>
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:0 auto 24px auto;">
                  <tr><td bgcolor="#2563eb" style="border-radius:8px;"><a href="{safe_url}" style="display:inline-block;padding:13px 22px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px;">Reset Password</a></td></tr>
                </table>
                <div style="margin:0 0 22px 0;padding:14px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;line-height:20px;color:#475569;">This reset link expires in <strong>{expires_minutes} minutes</strong> and can only be used once. Resetting your password will sign out your existing AMT sessions.</div>
                <p style="margin:0 0 10px 0;font-size:13px;line-height:20px;color:#64748b;">If you did not request a password reset, you can safely ignore this email.</p>
                <p style="margin:0;font-size:13px;line-height:20px;color:#64748b;">This email is sent from an unmonitored address. Replies are directed to <a href="mailto:{support}" style="color:#2563eb;text-decoration:none;">{support}</a>.</p>
              </td>
            </tr>
            <tr><td style="padding:18px 36px;background:#0f172a;text-align:center;"><div style="font-size:12px;line-height:18px;color:#cbd5e1;">Powered by <strong style="color:#ffffff;">LogiSource Digital</strong></div></td></tr>
          </table>
          <p style="max-width:600px;margin:14px auto 0 auto;font-size:11px;line-height:17px;color:#94a3b8;text-align:center;">For your security, never forward this password reset email or share the reset link.</p>
        </td>
      </tr>
    </table>
  </body>
</html>'''

    msg.add_alternative(html_body, subtype="html")
    if logo_bytes:
        html_part = msg.get_payload()[-1]
        html_part.add_related(
            logo_bytes,
            maintype="image",
            subtype=_image_subtype(logo_bytes),
            cid="<amt-current-company-logo>",
            filename="company-logo",
            disposition="inline",
        )
    return msg


def _send_message_sync(message: EmailMessage) -> None:
    cfg = _smtp_config()
    context = ssl.create_default_context()

    if cfg["secure"]:
        with smtplib.SMTP_SSL(
            cfg["host"], cfg["port"], timeout=20, context=context
        ) as smtp:
            smtp.login(cfg["username"], cfg["password"])
            smtp.send_message(message)
        return

    with smtplib.SMTP(cfg["host"], cfg["port"], timeout=20) as smtp:
        smtp.ehlo()
        if cfg["starttls"]:
            smtp.starttls(context=context)
            smtp.ehlo()
        smtp.login(cfg["username"], cfg["password"])
        smtp.send_message(message)


async def send_password_reset_email(
    *,
    recipient: str,
    display_name: str,
    reset_url: str,
    expires_minutes: int,
) -> None:
    logo_bytes = await _current_logo_bytes()
    message = _build_password_reset_message(
        recipient=recipient,
        display_name=display_name,
        reset_url=reset_url,
        expires_minutes=expires_minutes,
        logo_bytes=logo_bytes,
    )
    await asyncio.to_thread(_send_message_sync, message)


def check_smtp_connection_sync() -> None:
    cfg = _smtp_config()
    context = ssl.create_default_context()

    if cfg["secure"]:
        with smtplib.SMTP_SSL(
            cfg["host"], cfg["port"], timeout=20, context=context
        ) as smtp:
            smtp.login(cfg["username"], cfg["password"])
            smtp.noop()
        return

    with smtplib.SMTP(cfg["host"], cfg["port"], timeout=20) as smtp:
        smtp.ehlo()
        if cfg["starttls"]:
            smtp.starttls(context=context)
            smtp.ehlo()
        smtp.login(cfg["username"], cfg["password"])
        smtp.noop()
