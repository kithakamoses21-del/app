from fastapi.testclient import TestClient
import sqlite3

from backend.app.main import app

client = TestClient(app)


def test_health_reports_ready():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_upload_and_profile_csv(tmp_path, monkeypatch):
    import backend.app.main as main

    monkeypatch.setattr(main, "DATA_DIR", tmp_path)
    response = client.post(
        "/api/datasets/upload",
        files={"file": ("observations.csv", b"age,score\n31,8.5\n,9.0\n31,8.5\n", "text/csv")},
    )
    assert response.status_code == 200
    dataset = response.json()
    assert dataset["name"] == "observations.csv"
    assert dataset["rows"] == 3
    assert dataset["columns"] == 2
    assert dataset["missing"]["age"] == 1
    assert dataset["duplicate_rows"] == 1
    assert len(dataset["preview"]) == 3
    detail = client.get(f"/api/datasets/{dataset['id']}")
    assert detail.status_code == 200
    assert detail.json()["column_names"] == ["age", "score"]


def test_upload_rejects_unsupported_file():
    response = client.post(
        "/api/datasets/upload",
        files={"file": ("script.py", b"print('not data')", "text/plain")},
    )
    assert response.status_code == 415


def test_ai_requires_api_key():
    response = client.post("/api/ai/ask", json={"question": "What should I analyze?"})
    assert response.status_code == 401


def test_ai_receives_profile_but_not_dataset_rows(tmp_path, monkeypatch):
    import backend.app.main as main

    monkeypatch.setattr(main, "DATA_DIR", tmp_path)
    uploaded = client.post(
        "/api/datasets/upload",
        files={"file": ("private.csv", b"study_group,result\ncontrol,private-row-value\n", "text/csv")},
    )
    assert uploaded.status_code == 200

    captured: dict[str, object] = {}

    class FakeResponse:
        status_code = 200
        is_error = False

        @staticmethod
        def json():
            return {"choices": [{"message": {"content": "Consider comparing the study groups."}}]}

    class FakeAsyncClient:
        def __init__(self, timeout):
            assert timeout.read == 45.0

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            return None

        async def post(self, url, headers, json):
            captured["url"] = url
            captured["headers"] = headers
            captured["body"] = json
            return FakeResponse()

    monkeypatch.setattr(main.httpx, "AsyncClient", FakeAsyncClient)
    response = client.post(
        "/api/ai/ask",
        headers={"X-OpenAI-API-Key": "test-key"},
        json={"question": "What can I compare?", "dataset_id": uploaded.json()["id"]},
    )

    assert response.status_code == 200
    assert response.json()["answer"] == "Consider comparing the study groups."
    assert captured["url"] == "https://api.openai.com/v1/chat/completions"
    assert captured["headers"] == {"Authorization": "Bearer test-key"}
    messages = captured["body"]["messages"]
    context = messages[1]["content"]
    assert "study_group" in context
    assert "private-row-value" not in context


def test_eda_returns_real_numeric_and_categorical_summaries(tmp_path, monkeypatch):
    import backend.app.main as main

    monkeypatch.setattr(main, "DATA_DIR", tmp_path)
    uploaded = client.post(
        "/api/datasets/upload",
        files={
            "file": (
                "study.csv",
                b"hours,score,group\n1,3,A\n2,5,A\n3,7,B\n",
                "text/csv",
            )
        },
    )
    result = client.get(f"/api/datasets/{uploaded.json()['id']}/eda")
    assert result.status_code == 200
    eda = result.json()
    assert eda["numeric_summary"]["hours"]["mean"] == 2
    assert eda["numeric_summary"]["score"]["mean"] == 5
    assert eda["correlations"]["pearson"]["hours"]["score"] == 1
    assert eda["categorical_summary"]["group"]["unique"] == 2
    assert eda["class_balance"]["group"][0] == {"value": "A", "count": 2}


def test_sqlite_upload_and_table_preview_are_read_only(tmp_path, monkeypatch):
    import backend.app.main as main

    monkeypatch.setattr(main, "DATA_DIR", tmp_path / "datasets")
    source = tmp_path / "source.sqlite"
    with sqlite3.connect(source) as connection:
        connection.execute('CREATE TABLE "study data" (group_name TEXT, score REAL)')
        connection.executemany(
            'INSERT INTO "study data" VALUES (?, ?)',
            [("A", 1.0), ("A", 1.0), ("B", None)],
        )

    uploaded = client.post(
        "/api/datasets/upload",
        files={"file": ("study.sqlite", source.read_bytes(), "application/octet-stream")},
    )
    assert uploaded.status_code == 200
    database = uploaded.json()
    assert database["kind"] == "sqlite"
    assert database["tables"] == ["study data"]

    table = client.get(f"/api/datasets/{database['id']}/tables/study%20data")
    assert table.status_code == 200
    assert table.json()["rows"] == 3
    assert table.json()["missing"]["score"] == 1
    assert table.json()["duplicate_rows"] == 1
    assert table.json()["preview"][0] == {"group_name": "A", "score": 1.0}
    assert not (tmp_path / "datasets" / f"{database['id']}.sqlite-wal").exists()
    eda = client.get(f"/api/datasets/{database['id']}/eda?table=study%20data")
    assert eda.status_code == 200
    assert eda.json()["numeric_summary"]["score"]["count"] == 2


def test_image_upload_checks_file_signature(tmp_path, monkeypatch):
    import backend.app.main as main

    monkeypatch.setattr(main, "DATA_DIR", tmp_path)
    invalid = client.post(
        "/api/datasets/upload",
        files={"file": ("photo.png", b"not a png", "image/png")},
    )
    assert invalid.status_code == 422
    valid = client.post(
        "/api/datasets/upload",
        files={"file": ("photo.png", b"\x89PNG\r\n\x1a\nrest", "image/png")},
    )
    assert valid.status_code == 200
    assert valid.json()["kind"] == "image"


def test_quality_report_is_html_and_escapes_uploaded_filename(tmp_path, monkeypatch):
    import backend.app.main as main

    monkeypatch.setattr(main, "DATA_DIR", tmp_path)
    uploaded = client.post(
        "/api/datasets/upload",
        files={"file": ("unsafe<script>.csv", b"value\n1\n2\n", "text/csv")},
    )
    report = client.get(f"/api/datasets/{uploaded.json()['id']}/quality-report.html")
    assert report.status_code == 200
    assert report.headers["content-type"].startswith("text/html")
    assert "&lt;script&gt;" in report.text
    assert "<script>" not in report.text
