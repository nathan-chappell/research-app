from __future__ import annotations

import json
import os
import sys
from pathlib import Path

test_db_path = Path(__file__).with_name("test.db")
if test_db_path.exists():
    test_db_path.unlink()

os.environ.setdefault("RESEARCH_APP_DATABASE_URL", f"sqlite:///{test_db_path}")
os.environ.setdefault("RESEARCH_APP_AUTH_DISABLED", "true")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient

from app.chatkit.server import ResearchChatKitServer
from app.chatkit.store import SQLAlchemyAttachmentStore, SQLAlchemyChatKitStore
from app.core.config import get_settings
from app.db.base import Base
from app.db.session import SessionLocal, engine
from app.main import app
from app.models import ChatAttachment, ChatMessage, ChatThread, OpenAIConversation
from app.services.openai_service import OpenAIService


Base.metadata.create_all(bind=engine)
app.state.openai_service = OpenAIService(get_settings())
app.state.chatkit_server = ResearchChatKitServer(
    store=SQLAlchemyChatKitStore(),
    attachment_store=SQLAlchemyAttachmentStore(),
    openai_service=app.state.openai_service,
)
client = TestClient(app)


def _headers() -> dict[str, str]:
    return {"X-Library-Id": "lib_test"}


def _chat_headers(active_corpus_item_id: str | None = None) -> dict[str, str]:
    headers = _headers()
    if active_corpus_item_id:
        headers["X-Active-Corpus-Item-Id"] = active_corpus_item_id
    return headers


def _sse_events(response) -> list[dict[str, object]]:
    events = []
    for line in response.text.splitlines():
        if line.startswith("data: "):
            events.append(json.loads(line.removeprefix("data: ")))
    return events


def test_register_library() -> None:
    response = client.post("/api/libraries/register", json={"library_id": "lib_test", "name": "Test Library"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["id"] == "lib_test"


def test_embeddings_endpoint() -> None:
    client.post("/api/libraries/register", json={"library_id": "lib_test", "name": "Test Library"})
    response = client.post(
        "/api/embeddings",
        headers=_headers(),
        json={"library_id": "lib_test", "texts": ["hello world", "goodbye"]},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["dimensions"] == 1536
    assert len(payload["embeddings"]) == 2


def test_chatkit_round_trip_streams_progress_and_metadata() -> None:
    client.post("/api/libraries/register", json={"library_id": "lib_test", "name": "Test Library"})

    create_request = {
        "type": "threads.create",
        "params": {
            "input": {
                "content": [{"type": "input_text", "text": "What is the main point?"}],
                "attachments": [],
                "quoted_text": None,
                "inference_options": {},
            }
        },
        "metadata": {},
    }
    response = client.post("/api/chatkit", headers=_chat_headers("corp_1"), json=create_request)
    assert response.status_code == 200
    create_events = _sse_events(response)
    assert any(event["type"] == "progress_update" and event["text"] == "Searching local evidence" for event in create_events)
    thread_id = next(
        event["thread"]["id"] for event in create_events if event["type"] == "thread.created"
    )
    assert thread_id
    tool_call = next(
        event["item"]
        for event in create_events
        if event["type"] == "thread.item.done" and event["item"]["type"] == "client_tool_call"
    )
    assert tool_call["arguments"]["corpusItemIds"] == ["corp_1"]

    with SessionLocal() as db:
        db.add(
            OpenAIConversation(
                thread_id=thread_id,
                conversation_id="conv_seed",
                last_response_id="resp_seed",
                metadata_json={"seeded": True},
            )
        )
        db.commit()

    tool_output_request = {
        "type": "threads.add_client_tool_output",
        "params": {
            "thread_id": thread_id,
            "result": {
                "segments": [
                    {
                        "id": "seg_1",
                        "corpusItemId": "corp_1",
                        "timestampMs": 12000,
                        "timestampLabel": "00:12",
                        "text": "The speaker says the experiment was repeated three times.",
                    }
                ],
                "screenshots": [],
                "refs": [
                    {
                        "id": "ref_1",
                        "title": "00:12",
                        "kind": "transcript",
                        "corpusItemId": "corp_1",
                        "timestampMs": 12000,
                        "excerpt": "The speaker says the experiment was repeated three times.",
                    }
                ],
            },
        },
        "metadata": {},
    }
    response = client.post("/api/chatkit", headers=_chat_headers("corp_1"), json=tool_output_request)
    assert response.status_code == 200
    events = _sse_events(response)
    assert any(event["type"] == "progress_update" and event["text"] == "Synthesizing answer" for event in events)
    assert any(
        event["type"] == "thread.item.added" and event["item"]["type"] == "assistant_message"
        for event in events
    )
    assert any(
        event["type"] == "thread.item.updated"
        and event["update"]["type"] == "assistant_message.content_part.text_delta"
        for event in events
    )
    assistant_item = next(
        event["item"]
        for event in events
        if event["type"] == "thread.item.done" and event["item"]["type"] == "assistant_message"
    )
    assert assistant_item["content"][0]["text"]

    with SessionLocal() as db:
        thread = db.query(ChatThread).filter(ChatThread.id == thread_id).one()
        assert thread.metadata_json["phase"] == "answered_fallback"
        assert thread.metadata_json["active_query"] == "What is the main point?"
        assert thread.metadata_json["library_id"] == "lib_test"
        assert thread.metadata_json["corpus_item_ids"] == ["corp_1"]
        assert thread.metadata_json["openai_conversation_id"] == "conv_seed"
        assert thread.metadata_json["previous_response_id"] == "resp_seed"
        assert thread.metadata_json["last_evidence_ref_count"] == 1

        assistant_row = (
            db.query(ChatMessage)
            .filter(ChatMessage.thread_id == thread_id, ChatMessage.item_type == "assistant_message")
            .order_by(ChatMessage.created_at.desc())
            .first()
        )
        assert assistant_row is not None
        assert assistant_row.phase == "answered_fallback"
        assert assistant_row.metadata_json["phase"] == "answered_fallback"
        assert assistant_row.metadata_json["conversation_id"] == "conv_seed"
        assert assistant_row.metadata_json["response_id"] is None
        assert assistant_row.evidence_refs_json[0]["corpusItemId"] == "corp_1"


def test_chatkit_empty_retrieval_short_circuits_without_openai_call() -> None:
    client.post("/api/libraries/register", json={"library_id": "lib_test", "name": "Test Library"})

    create_request = {
        "type": "threads.create",
        "params": {
            "input": {
                "content": [{"type": "input_text", "text": "Do we have enough evidence?"}],
                "attachments": [],
                "quoted_text": None,
                "inference_options": {},
            }
        },
        "metadata": {},
    }
    response = client.post("/api/chatkit", headers=_chat_headers("corp_2"), json=create_request)
    assert response.status_code == 200
    thread_id = next(
        event["thread"]["id"] for event in _sse_events(response) if event["type"] == "thread.created"
    )

    class _FailingResponses:
        def stream(self, *args, **kwargs):  # noqa: ANN002, ANN003
            raise AssertionError("Responses streaming should not be called for empty retrieval.")

    class _FailingConversations:
        def create(self, *args, **kwargs):  # noqa: ANN002, ANN003
            raise AssertionError("Conversation creation should not happen for empty retrieval.")

    class _FailingClient:
        responses = _FailingResponses()
        conversations = _FailingConversations()

    original_client = app.state.openai_service.client
    app.state.openai_service.client = _FailingClient()
    try:
        tool_output_request = {
            "type": "threads.add_client_tool_output",
            "params": {
                "thread_id": thread_id,
                "result": {
                    "segments": [],
                    "screenshots": [],
                    "refs": [],
                },
            },
            "metadata": {},
        }
        response = client.post("/api/chatkit", headers=_chat_headers("corp_2"), json=tool_output_request)
    finally:
        app.state.openai_service.client = original_client

    assert response.status_code == 200
    assistant_item = next(
        event["item"]
        for event in _sse_events(response)
        if event["type"] == "thread.item.done" and event["item"]["type"] == "assistant_message"
    )
    assert "I do not have enough local evidence" in assistant_item["content"][0]["text"]

    with SessionLocal() as db:
        conversation = db.query(OpenAIConversation).filter(OpenAIConversation.thread_id == thread_id).one_or_none()
        assert conversation is None


def test_chatkit_attachment_creation_is_not_supported() -> None:
    client.post("/api/libraries/register", json={"library_id": "lib_test", "name": "Test Library"})

    with SessionLocal() as db:
        before_count = db.query(ChatAttachment).count()

    response = client.post(
        "/api/chatkit",
        headers=_chat_headers(),
        json={
            "type": "attachments.create",
            "params": {
                "name": "notes.txt",
                "size": 11,
                "mime_type": "text/plain",
            },
            "metadata": {},
        },
    )

    assert response.status_code == 501
    assert "not supported" in response.json()["detail"].lower()

    with SessionLocal() as db:
        after_count = db.query(ChatAttachment).count()
    assert after_count == before_count
