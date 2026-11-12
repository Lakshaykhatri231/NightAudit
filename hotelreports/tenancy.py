"""Users, sign-in and access control.

A Principal is a signed-in user, and every user belongs to exactly one client.
`repo_for()` is the only way from a user to client data: it refuses any client
other than the user's own.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
import threading
import time
from dataclasses import dataclass

from . import config
from .errors import AccessDenied, Unauthorized
from .storage import TenantRepository

log = logging.getLogger("hotelreports.security")


@dataclass(frozen=True)
class Principal:
    username: str
    name: str
    client_id: str
    role: str  # "analyst" | "reviewer"

    def to_dict(self) -> dict:
        client = config.CLIENTS[self.client_id]
        return {"username": self.username, "name": self.name, "role": self.role,
                "client_id": self.client_id, "client_name": client["name"], "brand": client["brand"]}


def principal_for(username: str) -> Principal:
    u = config.USERS.get(username)
    if u is None:
        raise Unauthorized("Unknown user")
    return Principal(username, u["name"], u["client_id"], u["role"])


# Passwords are stored as salted PBKDF2 hashes. All demo users share DEMO_PASSWORD.
def _hash(password: str, salt: bytes) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 120_000)


_SALTS = {u: secrets.token_bytes(16) for u in config.USERS}
_HASHES = {u: _hash(config.DEMO_PASSWORD, s) for u, s in _SALTS.items()}


def authenticate(username: str, password: str) -> Principal:
    username = (username or "").strip().lower()
    salt = _SALTS.get(username)
    if salt is None or not hmac.compare_digest(_hash(password or "", salt), _HASHES[username]):
        raise Unauthorized("Invalid username or password")
    return principal_for(username)


def principal_from_api_key(key: str) -> Principal:
    username = config.API_KEYS.get(key or "")
    if username is None:
        raise Unauthorized("Invalid API key")
    return principal_for(username)


class SessionStore:
    """Sign-in sessions, kept in memory (restarting the server signs everyone out)."""

    def __init__(self):
        self._lock = threading.Lock()
        self._sessions: dict[str, tuple[str, float]] = {}

    def create(self, principal: Principal) -> str:
        token = secrets.token_urlsafe(32)
        with self._lock:
            self._sessions[token] = (principal.username, time.time() + config.SESSION_TTL_SECONDS)
        return token

    def get(self, token: str) -> Principal | None:
        with self._lock:
            entry = self._sessions.get(token or "")
            if entry is None:
                return None
            username, expires = entry
            if expires < time.time():
                del self._sessions[token]
                return None
        return principal_for(username)

    def delete(self, token: str):
        with self._lock:
            self._sessions.pop(token or "", None)


def require_client(principal: Principal, client_id: str):
    if principal.client_id != client_id:
        log.warning("DENIED cross-client access: %s (client=%s) tried client=%s",
                    principal.username, principal.client_id, client_id)
        # Logged in the caller's own audit log; we never write into the other client's database.
        target = config.CLIENTS.get(client_id, {}).get("name", "an unknown client")
        TenantRepository(principal.client_id).add_event(
            None, "access_denied", principal.username, f"Tried to open {target}'s data (HTTP 403)")
        raise AccessDenied(
            f"Access denied: {principal.name} works for {config.CLIENTS[principal.client_id]['name']} "
            f"and cannot access another client's data.")


def require_role(principal: Principal, role: str, action: str):
    if principal.role != role:
        raise AccessDenied(f"Only a {role} can {action} (you are signed in as {principal.role}).")


def repo_for(principal: Principal, client_id: str) -> TenantRepository:
    require_client(principal, client_id)
    return TenantRepository(client_id)
