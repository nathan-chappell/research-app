from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from fastapi import Depends, Header, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.models import Library, User
from app.services.auth import VerifiedPrincipal, get_or_create_user


bearer_scheme = HTTPBearer(auto_error=False)


@dataclass
class RequestContext:
    db: Session
    settings: Settings
    principal: VerifiedPrincipal
    library_id: str
    active_corpus_item_id: str | None = None

    @property
    def user(self) -> User:
        return self.principal.user

    @property
    def claims(self) -> dict[str, Any]:
        return self.principal.claims


def get_current_principal(
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> VerifiedPrincipal:
    token = credentials.credentials if credentials else None
    return get_or_create_user(db, settings, token)


def get_request_context(
    library_id: str | None = Header(default=None, alias="X-Library-Id"),
    active_corpus_item_id: str | None = Header(default=None, alias="X-Active-Corpus-Item-Id"),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    principal: VerifiedPrincipal = Depends(get_current_principal),
) -> RequestContext:
    if not library_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing X-Library-Id header.",
        )
    library = db.query(Library).filter(Library.id == library_id, Library.user_id == principal.user.id).one_or_none()
    if library is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Library not registered.")
    return RequestContext(
        db=db,
        settings=settings,
        principal=principal,
        library_id=library_id,
        active_corpus_item_id=active_corpus_item_id or None,
    )


def get_request_context_from_request(
    request: Request,
    db: Session,
    settings: Settings,
    principal: VerifiedPrincipal,
) -> RequestContext:
    library_id = request.headers.get("X-Library-Id")
    if not library_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing X-Library-Id header.")
    library = db.query(Library).filter(Library.id == library_id, Library.user_id == principal.user.id).one_or_none()
    if library is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Library not registered.")
    return RequestContext(
        db=db,
        settings=settings,
        principal=principal,
        library_id=library_id,
        active_corpus_item_id=request.headers.get("X-Active-Corpus-Item-Id") or None,
    )
