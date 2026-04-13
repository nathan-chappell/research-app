from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class RegisterLibraryRequest(BaseModel):
    library_id: str
    name: str = "My Library"


class LibraryResponse(BaseModel):
    id: str
    user_id: str
    name: str
    created_at: datetime
    updated_at: datetime
