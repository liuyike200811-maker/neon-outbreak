#!/usr/bin/env python3
"""Publish the neon-outbreak static game to GitHub over the GitHub REST API.

Used because this Windows host's git/curl TLS backend (schannel) is broken
(`SEC_E_NO_CREDENTIALS`), so `git push` cannot reach github.com. The REST
Git Data API produces a genuine commit with identical tree content.

Usage:
    python tests/publish.py            # create repo, push commit, enable Pages
    python tests/publish.py --check    # only report auth + repo state
"""
import base64
import json
import os
import socket
import ssl
import sys

PROXY = os.environ.get("GITHUB_PROXY", "127.0.0.1:7890")
API_HOST = "api.github.com"
OWNER = "liuyike200811-maker"
REPO = "neon-outbreak"
BRANCH = "main"
COMMIT_MSG = "1.4.0 · NEON OUTBREAK 更新：冲刺取消冷却、完美闪避机制、威胁等级 6 档、升级卡重抽与跳过、无尽超频成长"

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def token():
    tok = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if tok:
        return tok.strip()
    raise SystemExit("GH_TOKEN / GITHUB_TOKEN not set")


def _conn():
    host, port = PROXY.split(":")
    raw = socket.create_connection((host, int(port)), timeout=30)
    raw.sendall(f"CONNECT {API_HOST}:443 HTTP/1.1\r\nHost: {API_HOST}:443\r\n\r\n".encode())
    head = raw.recv(200).decode("latin1")
    if "200" not in head.split("\r\n")[0]:
        raise RuntimeError("proxy CONNECT failed: " + head.split("\r\n")[0])
    ctx = ssl._create_unverified_context()
    return ctx.wrap_socket(raw, server_hostname=API_HOST)


def api(method, path, payload=None, want_raw=False):
    body = b""
    if payload is not None:
        body = json.dumps(payload).encode()
    headers = [
        f"{method} {path} HTTP/1.1",
        f"Host: {API_HOST}",
        "User-Agent: neon-outbreak-publisher",
        "Accept: application/vnd.github+json",
        f"Authorization: Bearer {token()}",
        "Content-Type: application/json",
        f"Content-Length: {len(body)}",
        "Connection: close",
        "",
        "",
    ]
    sock = _conn()
    try:
        sock.sendall("\r\n".join(headers).encode() + body)
        chunks = []
        while True:
            c = sock.recv(65536)
            if not c:
                break
            chunks.append(c)
    finally:
        sock.close()
    raw = b"".join(chunks)
    head, _, resp = raw.partition(b"\r\n\r\n")
    status = int(head.split(b" ")[1])
    # chunked transfer?
    low = head.lower()
    if b"transfer-encoding: chunked" in low:
        out, rest = b"", resp
        while rest:
            line, _, rest = rest.partition(b"\r\n")
            try:
                size = int(line.strip(), 16)
            except ValueError:
                break
            if size == 0:
                break
            out += rest[:size]
            rest = rest[size + 2:]
        resp = out
    if want_raw:
        return status, resp
    try:
        data = json.loads(resp) if resp else None
    except json.JSONDecodeError:
        data = {"_raw": resp[:400].decode("utf-8", "replace")}
    return status, data


def collect_files():
    skip_dirs = {".git", "node_modules", "test-results", "playwright-report", "dist", ".playwright"}
    files = []
    for base, dirs, names in os.walk(ROOT):
        dirs[:] = [d for d in dirs if d not in skip_dirs]
        for n in names:
            full = os.path.join(base, n)
            rel = os.path.relpath(full, ROOT).replace("\\", "/")
            files.append((rel, full))
    return sorted(files)


def main():
    check_only = "--check" in sys.argv

    status, me = api("GET", "/user")
    if status != 200:
        raise SystemExit(f"auth failed: {status} {me}")
    print(f"authenticated as {me['login']}")

    status, repo = api("GET", f"/repos/{OWNER}/{REPO}")
    exists = status == 200
    print(f"repo {OWNER}/{REPO}: {'exists' if exists else 'missing'} ({status})")

    if check_only:
        if exists:
            print("default_branch:", repo.get("default_branch"), "private:", repo.get("private"))
        return

    if not exists:
        status, repo = api("POST", "/user/repos", {
            "name": REPO,
            "description": "《霓虹禁区：最后防线》NEON OUTBREAK — 2D 俯视角 Roguelite 生存射击网页游戏",
            "homepage": f"https://{OWNER}.github.io/{REPO}/",
            "private": False,
            "has_issues": True,
            "has_wiki": False,
            "has_projects": False,
            "auto_init": False,
        })
        if status not in (200, 201):
            raise SystemExit(f"create repo failed: {status} {repo}")
        print("created repo:", repo["html_url"])

    # An empty repository rejects blob creation with 409 "Git Repository is empty".
    # Seed it with one placeholder commit through the contents API, then the
    # real tree commit will simply have that placeholder as its parent.
    status, branch = api("GET", f"/repos/{OWNER}/{REPO}/git/ref/heads/{BRANCH}")
    if status in (404, 409):
        status, seed = api("PUT", f"/repos/{OWNER}/{REPO}/contents/README.md", {
            "message": "chore: bootstrap repository",
            "content": base64.b64encode("# NEON OUTBREAK\n\n初始化仓库。\n".encode()).decode(),
            "branch": BRANCH,
        })
        if status not in (200, 201):
            raise SystemExit(f"bootstrap commit failed: {status} {seed}")
        print("bootstrapped empty repo with initial commit")

    # build tree
    entries = []
    for rel, full in collect_files():
        if rel == ".gitignore.bak" or "__pycache__" in rel:
            continue
        with open(full, "rb") as fh:
            content = fh.read()
        if b"\x00" in content:
            print("skip binary:", rel)
            continue
        status, blob = api("POST", f"/repos/{OWNER}/{REPO}/git/blobs", {
            "content": base64.b64encode(content).decode(),
            "encoding": "base64",
        })
        if status not in (200, 201):
            raise SystemExit(f"blob failed for {rel}: {status} {blob}")
        mode = "100755" if rel.endswith(".sh") else "100644"
        entries.append({"path": rel, "mode": mode, "type": "blob", "sha": blob["sha"]})
        print("  blob", rel, blob["sha"][:8])

    status, tree = api("POST", f"/repos/{OWNER}/{REPO}/git/trees", {"tree": entries})
    if status not in (200, 201):
        raise SystemExit(f"tree failed: {status} {tree}")

    status, parents = api("GET", f"/repos/{OWNER}/{REPO}/git/ref/heads/{BRANCH}")
    parent_shas = []
    if status == 200:
        parent_shas = [parents["object"]["sha"]]
        print("existing branch head:", parent_shas[0][:8])

    payload = {"message": COMMIT_MSG, "tree": tree["sha"], "parents": parent_shas}
    status, commit = api("POST", f"/repos/{OWNER}/{REPO}/git/commits", payload)
    if status not in (200, 201):
        raise SystemExit(f"commit failed: {status} {commit}")
    print("commit:", commit["sha"][:8])

    if parent_shas:
        status, ref = api("PATCH", f"/repos/{OWNER}/{REPO}/git/refs/heads/{BRANCH}",
                          {"sha": commit["sha"], "force": True})
    else:
        status, ref = api("POST", f"/repos/{OWNER}/{REPO}/git/refs",
                          {"ref": f"refs/heads/{BRANCH}", "sha": commit["sha"]})
    if status not in (200, 201):
        raise SystemExit(f"ref update failed: {status} {ref}")
    print("branch", BRANCH, "->", commit["sha"][:8])

    status, pages = api("GET", f"/repos/{OWNER}/{REPO}/pages")
    if status == 200:
        print("pages already enabled:", pages.get("html_url"))
    else:
        status, pages = api("POST", f"/repos/{OWNER}/{REPO}/pages", {
            "source": {"branch": BRANCH, "path": "/"},
        })
        if status in (200, 201):
            print("pages enabled:", pages.get("html_url"))
        else:
            print("pages enable failed:", status, pages)

    print(f"\nrepository: https://github.com/{OWNER}/{REPO}")
    print(f"pages (may take ~1 min): https://{OWNER}.github.io/{REPO}/")


if __name__ == "__main__":
    main()
