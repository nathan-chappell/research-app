from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import StreamingResponse

from chatkit.server import NonStreamingResult, StreamingResult

from app.api.deps import get_current_principal, get_request_context_from_request
from app.core.config import get_settings
from app.db.session import get_db
from app.services.auth import VerifiedPrincipal


router = APIRouter(tags=["chatkit"])


@router.post("/chatkit")
async def chatkit_endpoint(
    request: Request,
    db=Depends(get_db),
    settings=Depends(get_settings),
    principal: VerifiedPrincipal = Depends(get_current_principal),
):
    context = get_request_context_from_request(request, db, settings, principal)
    server = request.app.state.chatkit_server
    payload = await request.body()
    try:
        result = await server.process(payload, context=context)
    except NotImplementedError as exc:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail=str(exc) or "This ChatKit capability is not supported in this MVP.",
        ) from exc
    if isinstance(result, StreamingResult):
        return StreamingResponse(result.json_events, media_type="text/event-stream")
    if isinstance(result, NonStreamingResult):
        return Response(content=result.json, media_type="application/json")
    return Response(content=b"{}", media_type="application/json")
