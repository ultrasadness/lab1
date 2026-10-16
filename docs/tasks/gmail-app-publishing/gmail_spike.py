#!/usr/bin/env python3
"""Throwaway helper for the ticket "Check that API drafts edit in Gmail iOS and
that tokens outlive 7 days" (ultrasadness/lab1#17). wizard.sh calls it, and
publish.sh reuses it for "Publish the Gmail OAuth app with its pages on
pot.dpdns.org, and check a fresh token outlives 7 days" (ultrasadness/lab1#31),
which is where the day-8 check now posts.

Stdlib only. It never prints a Secret: the client secret and refresh token stay
in .env and token.json (both 0600), and results.md holds only facts.
"""

import argparse
import base64
import email
import email.policy
import email.utils
import hashlib
import json
import os
import re
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage

DIR = os.path.dirname(os.path.abspath(__file__))
ENV = os.path.join(DIR, ".env")
TOKEN = os.path.join(DIR, "token.json")
STATE = os.path.join(DIR, "state.json")
RESULTS = os.path.join(DIR, "results.md")
SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.compose",
]
PORT = int(os.environ.get("SPIKE_PORT", "8765"))
REDIRECT = f"http://127.0.0.1:{PORT}"
API = "https://gmail.googleapis.com/gmail/v1/users/me/"
TOKEN_URL = "https://oauth2.googleapis.com/token"
REPO, TICKET = "ultrasadness/lab1", "31"
CRON_MARK = "# lab1-gmail-spike-day8"
DRAFT_LINE = "Edit this line on the iPhone."


class Fail(Exception):
    pass


class Missing(Fail):
    """An earlier wizard stage hasn't finished; the helper exits 3."""


# ── files ────────────────────────────────────────────────────────────────


def now():
    return datetime.now(timezone.utc)


def stamp(t=None):
    return (t or now()).strftime("%Y-%m-%d %H:%M UTC")


def load_env():
    env = {}
    if os.path.exists(ENV):
        with open(ENV) as f:
            for line in f:
                key, sep, value = line.rstrip("\n").partition("=")
                if sep:
                    env[key] = value
    return env


def load_json(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except FileNotFoundError:
        return default


def save_private(path, data):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(data, f, indent=2)


state = load_json(STATE, {})


def save_state():
    save_private(STATE, state)


def need(key):
    if key not in state:
        raise Missing(f"no '{key}' in state.json yet: run the earlier wizard stage first")
    return state[key]


def mask(text):
    """Swap the Signup mailbox and everyday addresses for placeholders."""
    text = str(text)
    everyday = state.get("everyday")
    if everyday:
        text = re.sub(re.escape(everyday), "<everyday>", text, flags=re.I)
    signup = load_env().get("SIGNUP_ADDRESS", "")
    if "@" in signup:
        local, domain = signup.lower().split("@", 1)
        text = re.sub(
            re.escape(local) + r"(\+[^@\s>]*)?@" + re.escape(domain),
            lambda m: "<signup>" + (m.group(1) or "") + "@" + domain,
            text,
            flags=re.I,
        )
    return text


def record(title, lines):
    with open(RESULTS, "a") as f:
        f.write(f"\n## {title} · {stamp()}\n\n")
        for line in lines:
            f.write(f"- {line}\n")
    print(f"\n  {title}")
    for line in lines:
        print(f"    • {line}")


# ── HTTP, tokens, Gmail ──────────────────────────────────────────────────


def request(method, url, form=None, body=None, token=None):
    headers, data = {}, None
    if form is not None:
        data = urllib.parse.urlencode(form).encode()
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, {"error": raw.decode(errors="replace")[:300]}


_access = None


def token_error(status, r):
    return f"HTTP {status}: {r.get('error')} ({r.get('error_description', '')})"


def refresh():
    """Trade the refresh token for an access token. Returns (ok, detail)."""
    global _access
    env, tok = load_env(), load_json(TOKEN, None)
    if not tok:
        return False, "no token.json yet: run the consent stage first"
    status, r = request("POST", TOKEN_URL, form={
        "grant_type": "refresh_token",
        "refresh_token": tok["refresh_token"],
        "client_id": env["CLIENT_ID"],
        "client_secret": env["CLIENT_SECRET"],
    })
    if status != 200:
        return False, token_error(status, r)
    _access = r["access_token"]
    if r.get("refresh_token"):
        tok["refresh_token"] = r["refresh_token"]
        save_private(TOKEN, tok)
    return True, f"ok (scope: {r.get('scope', '?')})"


def gmail(method, path, params=None, body=None, ok404=False):
    if _access is None:
        if not os.path.exists(TOKEN):
            raise Missing("no token.json yet: run the consent stage first")
        ok, detail = refresh()
        if not ok:
            raise Fail("token refresh failed: " + detail)
    url = API + path
    if params:
        url += "?" + urllib.parse.urlencode(params, doseq=True)
    status, r = request(method, url, body=body, token=_access)
    if status == 404 and ok404:
        return None
    if status >= 300:
        raise Fail(f"{method} {path}: HTTP {status}: {json.dumps(r.get('error', r))[:400]}")
    return r


def header(msg, name):
    for h in msg.get("payload", {}).get("headers", []):
        if h["name"].lower() == name.lower():
            return h["value"]
    return None


def headers_named(msg, name):
    return [h["value"] for h in msg.get("payload", {}).get("headers", []) if h["name"].lower() == name.lower()]


def b64decode(data):
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def text_body(payload):
    if payload.get("mimeType") == "text/plain" and payload.get("body", {}).get("data"):
        return b64decode(payload["body"]["data"]).decode(errors="replace")
    for part in payload.get("parts") or []:
        found = text_body(part)
        if found is not None:
            return found
    return None


def one_line(text, limit=300):
    return mask(" / ".join(line.strip() for line in (text or "").splitlines() if line.strip()))[:limit]


def history(start, types=None, label=None):
    params = [("startHistoryId", start), ("maxResults", 500)]
    params += [("historyTypes", t) for t in types or []]
    if label:
        params.append(("labelId", label))
    records, page = [], None
    while True:
        r = gmail("GET", "history", params + ([("pageToken", page)] if page else []))
        records += r.get("history", [])
        page = r.get("nextPageToken")
        if not page:
            return records


KINDS = {
    "messagesAdded": "messageAdded",
    "messagesDeleted": "messageDeleted",
    "labelsAdded": "labelAdded",
    "labelsRemoved": "labelRemoved",
}


def events(records, msg_id=None):
    out = []
    for rec in records:
        for field, kind in KINDS.items():
            for e in rec.get(field, []):
                m = e["message"]
                if msg_id and m["id"] != msg_id:
                    continue
                labels = e.get("labelIds") or m.get("labelIds") or []
                out.append((kind, m["id"], labels))
    return out


def describe(evs):
    return "; ".join(f"{kind} {mid} [{','.join(labels)}]" for kind, mid, labels in evs) or "nothing reported"


def profile():
    return gmail("GET", "profile")


def raw_of(msg):
    return base64.urlsafe_b64encode(msg.as_bytes()).decode()


def token_age_days():
    tok = load_json(TOKEN, {})
    if "consented_at" not in tok:
        return None
    return (now() - datetime.fromisoformat(tok["consented_at"])).total_seconds() / 86400


# ── commands ─────────────────────────────────────────────────────────────


def cmd_check_client(a):
    """Ask Google whether the stored client ID and secret belong together, with no
    consent needed: Google checks the client before the code, so a dummy code is
    rejected as invalid_grant when the pair is right, invalid_client when not."""
    env = load_env()
    for key in ("CLIENT_ID", "CLIENT_SECRET"):
        if not env.get(key):
            raise Missing(f"{key} is missing from {ENV}: run the client stage first")
    status, r = request("POST", TOKEN_URL, form={
        "grant_type": "authorization_code",
        "code": "4/not-a-real-code",
        "client_id": env["CLIENT_ID"],
        "client_secret": env["CLIENT_SECRET"],
        "redirect_uri": REDIRECT,
        "code_verifier": "x" * 43,
    })
    if r.get("error") == "invalid_client":
        print(f"\n  ✗ Google rejects this client ID + secret pair: {r.get('error_description', '')}")
        return 1
    if r.get("error") in ("invalid_grant", "invalid_request"):
        print("\n  ✓ Google accepts this client ID + secret (it only rejected the dummy code)")
        return 0
    raise Fail("unexpected answer from Google: " + token_error(status, r))


def read_redirect(nonce):
    """Read the pasted redirect address, even when it arrives split over several
    lines. Returns (route, query string)."""
    buf = ""
    while True:
        if buf:
            print("  … more of the address? Paste it, or press Enter if that was all: ", end="", flush=True)
        else:
            print("  > ", end="", flush=True)
        line = sys.stdin.readline()
        if line == "":
            raise Fail("input closed before an address was pasted")
        piece = "".join(line.split())
        if not piece and not buf:
            continue
        buf += piece
        if re.fullmatch(r"\d/[\w-]+", buf):
            return "pasted code only", urllib.parse.urlencode({"code": buf, "state": nonce})
        query = (buf.split("?", 1)[1] if "?" in buf else buf).split("#", 1)[0]
        fields = urllib.parse.parse_qs(query)
        # Google puts scope after code, so once scope arrives the code is whole.
        if "error" in fields or ("code" in fields and "scope" in fields) or not piece:
            return "pasted redirect address", query


def cmd_consent(a):
    env = load_env()
    for key in ("CLIENT_ID", "CLIENT_SECRET", "SIGNUP_ADDRESS"):
        if not env.get(key):
            raise Missing(f"{key} is missing from {ENV}: run the earlier wizard stages")
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    nonce = secrets.token_urlsafe(16)
    url = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode({
        "client_id": env["CLIENT_ID"],
        "redirect_uri": REDIRECT,
        "response_type": "code",
        "scope": " ".join(SCOPES),
        "access_type": "offline",
        "prompt": "consent",
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "state": nonce,
        "login_hint": env["SIGNUP_ADDRESS"],
    })

    print("\n  Open this link in a browser signed in as the Signup mailbox:\n")
    print("  " + url + "\n")
    print("  The browser ends on a page that won't load. Copy that page's whole address")
    print(f"  (it starts {REDIRECT}/?state=…), paste it here and press Enter.")
    route, query = read_redirect(nonce)
    print()

    q = urllib.parse.parse_qs(query)
    if "error" in q:
        raise Fail(f"Google returned error={q['error'][0]}: nothing was granted")
    if q.get("state", [""])[0] != nonce:
        raise Fail("that address is from a different consent attempt (state mismatch): try again")
    if "code" not in q:
        raise Fail("no code in that address: copy the whole address bar and try again")

    status, r = request("POST", TOKEN_URL, form={
        "grant_type": "authorization_code",
        "code": q["code"][0],
        "client_id": env["CLIENT_ID"],
        "client_secret": env["CLIENT_SECRET"],
        "redirect_uri": REDIRECT,
        "code_verifier": verifier,
    })
    if status != 200:
        raise Fail("code exchange failed: " + token_error(status, r))
    if not r.get("refresh_token"):
        raise Fail("Google returned no refresh token")

    consented = now()
    save_private(TOKEN, {"refresh_token": r["refresh_token"], "consented_at": consented.isoformat()})
    global _access
    _access = r["access_token"]

    granted = set(r.get("scope", "").split())
    exact = granted == set(SCOPES)
    prof = profile()
    right_account = prof["emailAddress"].lower() == env["SIGNUP_ADDRESS"].lower()
    state.update(consented_at=consented.isoformat(), start_history_id=prof["historyId"], route=route)
    save_state()
    lifetime = r.get("refresh_token_expires_in")
    record("Consent", [
        f"Route: {route}",
        "refresh_token_expires_in: "
        + (f"{lifetime} s ({int(lifetime) / 86400:.2f} days)" if lifetime is not None else "absent from the token response"),
        f"Granted scopes: {', '.join(sorted(granted)) or '(none reported)'}",
        "Exactly gmail.readonly + gmail.compose: " + ("yes" if exact else "NO"),
        f"Consented as: {mask(prof['emailAddress'])}" + ("" if right_account else " (NOT the Signup mailbox)"),
        f"Refresh token stored in {TOKEN} (0600); value not shown",
        f"Consented at {stamp(consented)}; start historyId {prof['historyId']}",
    ])
    return 0 if exact and right_account else 1


def cmd_wait_mail(a):
    start = need("start_history_id")
    deadline = time.time() + a.minutes * 60
    seen = set()
    print(f"  Waiting for a mail whose subject contains '{a.subject}' (up to {a.minutes} min)…")
    while True:
        for kind, mid, labels in events(history(start, types=["messageAdded"])):
            if mid in seen:
                continue
            seen.add(mid)
            m = gmail("GET", f"messages/{mid}", {
                "format": "metadata",
                "metadataHeaders": ["Subject", "From", "Message-ID", "References"],
            })
            subject = header(m, "Subject") or ""
            if a.subject.lower() in subject.lower() and "SENT" not in m.get("labelIds", []):
                return found_mail(a.key, m, "history.list (historyTypes=messageAdded)")
        if time.time() > deadline:
            break
        time.sleep(10)
    listed = gmail("GET", "messages", {"q": f'subject:"{a.subject}"', "includeSpamTrash": "true"})
    if listed.get("messages"):
        m = gmail("GET", f"messages/{listed['messages'][0]['id']}", {
            "format": "metadata",
            "metadataHeaders": ["Subject", "From", "Message-ID", "References"],
        })
        return found_mail(a.key, m, "messages.list only: history.list never reported it")
    record(f"Mail '{a.subject}'", [f"Nothing arrived within {a.minutes} min"])
    return 1


def found_mail(key, m, via):
    sender = header(m, "From") or ""
    state[key] = {
        "id": m["id"],
        "thread_id": m["threadId"],
        "subject": header(m, "Subject") or "",
        "from": sender,
        "message_id": header(m, "Message-ID"),
        "references": header(m, "References"),
    }
    if key == "test1":
        state["everyday"] = email.utils.parseaddr(sender)[1]
    save_state()
    record(f"Mail '{state[key]['subject']}' arrived", [
        f"Found via {via}",
        f"Message {m['id']} in thread {m['threadId']}, labels {','.join(m.get('labelIds', []))}",
        f"From: {mask(sender)}",
    ])
    return 0


def cmd_auth_results(a):
    m0 = need(a.key)
    full = gmail("GET", f"messages/{m0['id']}", {"format": "full"})
    raw = gmail("GET", f"messages/{m0['id']}", {"format": "raw"})
    parsed = email.message_from_bytes(b64decode(raw["raw"]), policy=email.policy.compat32)
    in_full = [" ".join(v.split()) for v in headers_named(full, "Authentication-Results")]
    in_raw = [" ".join(str(v).split()) for v in parsed.get_all("Authentication-Results") or []]
    lines = [f"Authentication-Results headers: {len(in_full)} in format=full, {len(in_raw)} in format=raw"]
    for i, value in enumerate(in_full, 1):
        dmarc = re.search(r"\bdmarc=(\w+)", value)
        lines.append(
            f"#{i} (topmost first) authserv-id {value.split(';', 1)[0].strip()}, "
            f"dmarc={dmarc.group(1) if dmarc else '(none)'}: `{mask(value)}`"
        )
    if in_full and in_raw:
        lines.append("full and raw agree on the topmost header: " + ("yes" if in_full[0] == in_raw[0] else "no"))
    lines.append(f"ARC-Authentication-Results headers: {len(headers_named(full, 'ARC-Authentication-Results'))}")
    record(f"Authentication-Results on '{m0['subject']}'", lines)
    return 0 if in_full else 1


def cmd_make_draft(a):
    m0 = need(a.key)
    msg = EmailMessage()
    msg["To"] = m0["from"]
    subject = m0["subject"]
    msg["Subject"] = subject if subject.lower().startswith("re:") else "Re: " + subject
    msg["In-Reply-To"] = m0["message_id"]
    msg["References"] = ((m0["references"] + " ") if m0.get("references") else "") + m0["message_id"]
    body = f"Reply draft created through the Gmail API at {stamp()}.\n\n{DRAFT_LINE}\n"
    msg.set_content(body)
    d = gmail("POST", "drafts", body={"message": {"raw": raw_of(msg), "threadId": m0["thread_id"]}})
    state["draft"] = {
        "id": d["id"],
        "message_id": d["message"]["id"],
        "thread_id": d["message"].get("threadId"),
        "body": body,
        "checkpoint": profile()["historyId"],
    }
    save_state()
    record("Reply draft created through the API", [
        f"Draft id {d['id']}, message id {d['message']['id']}",
        "In the test mail's thread: " + ("yes" if d["message"].get("threadId") == m0["thread_id"] else "NO"),
        f"In-Reply-To and References point at {mask(m0['message_id'])}",
    ])
    return 0


def cmd_check_draft(a):
    d0, m0 = need("draft"), need("test1")
    lines = []
    d = gmail("GET", f"drafts/{d0['id']}", {"format": "full"}, ok404=True)
    if d is None:
        lines.append(f"Draft id {d0['id']} kept: NO (404); looking for another draft in the thread")
        drafts = gmail("GET", "drafts", {"maxResults": 50}).get("drafts", [])
        other = next((x for x in drafts if x["message"].get("threadId") == d0["thread_id"]), None)
        if other is None:
            lines.append("No draft in the thread at all")
            record("Reply draft after editing in Gmail iOS", lines)
            return 1
        d = gmail("GET", f"drafts/{other['id']}", {"format": "full"})
        lines.append(f"Draft now has id {d['id']}")
    else:
        lines.append(f"Draft id kept: yes ({d['id']})")
    m = d["message"]
    body = text_body(m["payload"]) or ""
    edited = body.strip() != d0["body"].strip()
    irt, refs = header(m, "In-Reply-To"), header(m, "References") or ""
    lines += [
        f"Message id {d0['message_id']} → {m['id']} (changed: {'yes' if m['id'] != d0['message_id'] else 'no'})",
        "Thread kept: " + ("yes" if m.get("threadId") == d0["thread_id"] else "NO"),
        "In-Reply-To kept: " + ("yes" if irt == m0["message_id"] else f"NO ({mask(irt)})"),
        "References still hold it: " + ("yes" if m0["message_id"] in refs else "NO"),
        f"Subject: {mask(header(m, 'Subject'))}; MIME {m['payload'].get('mimeType')}; labels {','.join(m.get('labelIds', []))}",
        "Body changed from the API's text: " + ("yes" if edited else "no (not synced yet, or not edited)"),
        f"Body now: `{one_line(body)}`",
    ]
    d0.update(latest_id=d["id"], latest_message_id=m["id"], latest_body=body)
    save_state()
    record("Reply draft after editing in Gmail iOS", lines)
    return 0 if edited else 1


def cmd_check_sent(a):
    d0, m0 = need("draft"), need("test1")
    lines = []
    still = gmail("GET", f"drafts/{d0.get('latest_id', d0['id'])}", {"format": "minimal"}, ok404=True)
    lines.append("Draft gone after sending: " + ("yes" if still is None else "NO (still a draft: not sent yet?)"))
    thread = gmail("GET", f"threads/{d0['thread_id']}", {"format": "full"})
    sent = [m for m in thread["messages"] if "SENT" in m.get("labelIds", []) and "DRAFT" not in m.get("labelIds", [])]
    if not sent:
        lines.append("No sent message in the test thread yet")
        record("Reply draft sent from Gmail iOS", lines)
        return 1
    s = sent[-1]
    body = text_body(s["payload"]) or ""
    refs = header(s, "References") or ""
    lines += [
        f"Sent message {s['id']} is in the test thread: yes",
        "Same message id as the last saved draft version: " + ("yes" if s["id"] == d0.get("latest_message_id") else "no"),
        "In-Reply-To intact: " + ("yes" if header(s, "In-Reply-To") == m0["message_id"] else f"NO ({mask(header(s, 'In-Reply-To'))})"),
        "References intact: " + ("yes" if m0["message_id"] in refs else "NO"),
        f"From: {mask(header(s, 'From'))}; To: {mask(header(s, 'To'))}",
        f"Body sent: `{one_line(body)}`",
        "History since the draft was created (all types, oldest first): " + describe(events(history(d0["checkpoint"]))),
    ]
    record("Reply draft sent from Gmail iOS", lines)
    return 0 if still is None else 1


def cmd_plus_send(a):
    everyday = need("everyday")
    local, domain = load_env()["SIGNUP_ADDRESS"].split("@", 1)
    plus = f"{local}+wayfinder@{domain}"
    msg = EmailMessage()
    msg["From"] = plus
    msg["To"] = everyday
    msg["Subject"] = "wayfinder plus-address From test"
    msg.set_content(f"Sent through the Gmail API (drafts.create, then drafts.send) at {stamp()} with From: {plus}\n")
    d = gmail("POST", "drafts", body={"message": {"raw": raw_of(msg)}})
    s = gmail("POST", "drafts/send", body={"id": d["id"]})
    m = gmail("GET", f"messages/{s['id']}", {"format": "metadata", "metadataHeaders": ["From"]})
    stored = header(m, "From") or ""
    record("Plus-address From on an API send", [
        f"Asked for From: {mask(plus)}",
        f"Sent copy's From: {mask(stored)}",
        "Plus-address kept in the Sent copy: " + ("yes" if "+wayfinder@" in stored.lower() else "no"),
    ])
    return 0


def cmd_checkpoint(a):
    state.setdefault("checkpoints", {})[a.name] = profile()["historyId"]
    save_state()
    print(f"  checkpoint '{a.name}' saved")
    return 0


def cmd_spam_check(a):
    start = need("checkpoints")[a.since]
    deadline = time.time() + a.minutes * 60
    print(f"  Waiting for '{a.subject}' to arrive anywhere, Spam included (up to {a.minutes} min)…")
    while True:
        listed = gmail("GET", "messages", {"q": f'subject:"{a.subject}"', "includeSpamTrash": "true"})
        if listed.get("messages"):
            break
        if time.time() > deadline:
            record("Spam and history.list", [f"No mail '{a.subject}' arrived within {a.minutes} min"])
            return 1
        time.sleep(10)
    mid = listed["messages"][0]["id"]
    labels = gmail("GET", f"messages/{mid}", {"format": "minimal"}).get("labelIds", [])
    in_spam = "SPAM" in labels
    lines = [
        f"Mail {mid} arrived with labels {','.join(labels)}",
        "Filed in Spam: " + ("yes" if in_spam else "NO: the block didn't divert it, so this run says nothing about Spam"),
    ]

    def reported(**kw):
        return describe(events(history(start, **kw), mid))

    plain = reported()
    if plain == "nothing reported":
        time.sleep(30)
        plain = reported()
        lines.append("(history.list queried again after 30 s)")
    lines += [
        f"history.list, no filter: {plain}",
        f"history.list, historyTypes=messageAdded: {reported(types=['messageAdded'])}",
        f"history.list, labelId=SPAM: {reported(label='SPAM')}",
        f"history.list, labelId=INBOX: {reported(label='INBOX')}",
        "All records since the checkpoint: " + describe(events(history(start))),
    ]
    record("Spam and history.list", lines)
    return 0 if in_spam else 1


def cmd_refresh(a):
    ok, detail = refresh()
    age = token_age_days()
    record("Token refresh", [
        f"Token age: {age:.2f} days since consent" if age is not None else "Token age: unknown",
        f"Refresh: {detail}",
    ])
    return 0 if ok else 1


def cron_lines_without_mark():
    current = subprocess.run(["crontab", "-l"], capture_output=True, text=True).stdout
    return [line for line in current.splitlines() if CRON_MARK not in line]


def write_crontab(lines):
    subprocess.run(["crontab", "-"], input="".join(line + "\n" for line in lines), text=True, check=True)


def cmd_install_cron(a):
    tok = load_json(TOKEN, None)
    if not tok:
        raise Missing("no token.json yet: run the consent stage first")
    line = (
        f"17 9 * * * PATH=/usr/local/bin:/usr/bin:/bin {sys.executable} -I {os.path.abspath(__file__)} daily"
        f" >> {os.path.join(DIR, 'cron.log')} 2>&1 {CRON_MARK}"
    )
    write_crontab(cron_lines_without_mark() + [line])
    due = datetime.fromisoformat(tok["consented_at"]) + timedelta(days=8)
    post = due.replace(hour=9, minute=17, second=0, microsecond=0)
    if post < due:
        post += timedelta(days=1)
    record("Day-8 check scheduled", [
        f"crontab: `{line}`",
        f"Refreshes daily at 09:17 UTC; posts to the ticket at {stamp(post)} (or on the first failure), then removes itself",
    ])
    return 0


def cmd_daily(a):
    ok, detail = refresh()
    age = token_age_days() or 0.0
    record("Daily token check (cron)", [f"Token age: {age:.2f} days", f"Refresh: {detail}"])
    if state.get("day8_posted") or (ok and age < 8):
        return 0
    verdict = "still refreshes" if ok else "**no longer refreshes**"
    body = (
        f"## Day-{int(age)} token check (posted by the cron job on the VM)\n\n"
        f"The refresh token from the unverified client published \"In production\" {verdict} "
        f"{age:.1f} days after consent.\n\n"
        f"- Refresh result: {detail}\n"
        f"- Checked {stamp()}; the daily log is in `{RESULTS}` on the VM.\n\n"
        "The cron job has removed itself."
    )
    posted = subprocess.run(["gh", "issue", "comment", TICKET, "--repo", REPO, "--body", body])
    if posted.returncode == 0:
        state["day8_posted"] = True
        save_state()
        write_crontab(cron_lines_without_mark())
    return 0 if posted.returncode == 0 else 1


def cmd_note(a):
    record(a.title, [a.text or "(nothing noted)"])
    return 0


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("check-client").set_defaults(fn=cmd_check_client)
    sub.add_parser("consent").set_defaults(fn=cmd_consent)
    s = sub.add_parser("wait-mail")
    s.add_argument("--key", required=True)
    s.add_argument("--subject", required=True)
    s.add_argument("--minutes", type=int, default=10)
    s.set_defaults(fn=cmd_wait_mail)
    s = sub.add_parser("auth-results")
    s.add_argument("--key", required=True)
    s.set_defaults(fn=cmd_auth_results)
    s = sub.add_parser("make-draft")
    s.add_argument("--key", required=True)
    s.set_defaults(fn=cmd_make_draft)
    sub.add_parser("check-draft").set_defaults(fn=cmd_check_draft)
    sub.add_parser("check-sent").set_defaults(fn=cmd_check_sent)
    sub.add_parser("plus-send").set_defaults(fn=cmd_plus_send)
    s = sub.add_parser("checkpoint")
    s.add_argument("--name", required=True)
    s.set_defaults(fn=cmd_checkpoint)
    s = sub.add_parser("spam-check")
    s.add_argument("--subject", required=True)
    s.add_argument("--since", required=True)
    s.add_argument("--minutes", type=int, default=10)
    s.set_defaults(fn=cmd_spam_check)
    sub.add_parser("refresh").set_defaults(fn=cmd_refresh)
    sub.add_parser("install-cron").set_defaults(fn=cmd_install_cron)
    sub.add_parser("daily").set_defaults(fn=cmd_daily)
    s = sub.add_parser("note")
    s.add_argument("--title", required=True)
    s.add_argument("--text", default="")
    s.set_defaults(fn=cmd_note)
    a = p.parse_args()
    try:
        sys.exit(a.fn(a))
    except Missing as e:
        print(f"\n  ✗ {e}", file=sys.stderr)
        sys.exit(3)
    except Fail as e:
        print(f"\n  ✗ {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
