from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import jwt
from fastapi import HTTPException, status
from jwt import PyJWKClient
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models import User


@dataclass
class VerifiedPrincipal:
    user: User
    claims: dict[str, Any]


def _claim_text(claims: dict[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = claims.get(key)
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return None


def _decode_token(token: str, settings: Settings) -> dict[str, Any]:
    if not settings.oidc_jwks_url or not settings.oidc_issuer or not settings.oidc_audience:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="OIDC settings are incomplete.",
        )

    jwks_client = PyJWKClient(settings.oidc_jwks_url)
    signing_key = jwks_client.get_signing_key_from_jwt(token)
    return jwt.decode(
        token,
        signing_key.key,
        algorithms=["RS256", "RS384", "RS512", "ES256", "ES384", "ES512"],
        audience=settings.oidc_audience,
        issuer=settings.oidc_issuer,
        options={"verify_aud": True},
    )


def get_or_create_user(db: Session, settings: Settings, token: str | None) -> VerifiedPrincipal:
    email: str | None
    display_name: str | None

    if settings.auth_disabled:
        subject = settings.dev_user_subject
        email = settings.dev_user_email
        display_name = settings.dev_user_name
        claims: dict[str, Any] = {
            "sub": subject,
            "email": email,
            "name": display_name,
            "auth_mode": "disabled",
        }
    else:
        if not token:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token.")
        claims = _decode_token(token, settings)
        subject = str(claims["sub"])
        email = _claim_text(claims, "email")
        display_name = _claim_text(claims, "name", "preferred_username")

    user = db.query(User).filter(User.oidc_subject == subject).one_or_none()
    if user is None:
        user = User(oidc_subject=subject, email=email, display_name=display_name)
        db.add(user)
        db.commit()
        db.refresh(user)
    else:
        changed = False
        if email and user.email != email:
            user.email = email
            changed = True
        if display_name and user.display_name != display_name:
            user.display_name = display_name
            changed = True
        if changed:
            db.add(user)
            db.commit()
            db.refresh(user)

    return VerifiedPrincipal(user=user, claims=claims)
