from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_principal
from app.db.session import get_db
from app.models import Library
from app.schemas.library import LibraryResponse, RegisterLibraryRequest
from app.services.auth import VerifiedPrincipal


router = APIRouter(prefix="/libraries", tags=["libraries"])


@router.post("/register", response_model=LibraryResponse)
def register_library(
    payload: RegisterLibraryRequest,
    db: Session = Depends(get_db),
    principal: VerifiedPrincipal = Depends(get_current_principal),
) -> LibraryResponse:
    library = db.query(Library).filter(Library.id == payload.library_id).one_or_none()
    if library is None:
        library = Library(id=payload.library_id, user_id=principal.user.id, name=payload.name)
    else:
        library.name = payload.name
        library.user_id = principal.user.id
    db.add(library)
    db.commit()
    db.refresh(library)
    return LibraryResponse.model_validate(library, from_attributes=True)
