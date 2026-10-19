from __future__ import annotations

import json
import html
import math
import os
import re
import sqlite3
import uuid
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
import pandas as pd
from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

DATA_DIR = Path(os.environ.get("DATA_STUDIO_DATA_DIR", Path(__file__).resolve().parents[2] / "storage" / "datasets"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
MAX_UPLOAD_BYTES = 50 * 1024 * 1024
MAX_PREVIEW_ROWS = 100
TABLE_EXTENSIONS = {".csv", ".tsv", ".json", ".xlsx", ".xls", ".parquet"}
DATABASE_EXTENSIONS = {".db", ".sqlite", ".sqlite3"}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tif", ".tiff"}
ALLOWED_EXTENSIONS = TABLE_EXTENSIONS | DATABASE_EXTENSIONS | IMAGE_EXTENSIONS
SAFE_DATASET_ID = re.compile(r"^[0-9a-f]{32}$")

app = FastAPI(title="Moses Kithaka — AI Data Analysis Studio", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-OpenAI-API-Key"],
)


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    dataset_id: str | None = None
    table_name: str | None = None


def dataset_path(dataset_id: str) -> Path:
    if not SAFE_DATASET_ID.fullmatch(dataset_id):
        raise HTTPException(status_code=404, detail="Dataset not found.")
    for extension in ALLOWED_EXTENSIONS:
        path = DATA_DIR / f"{dataset_id}{extension}"
        if path.is_file():
            return path
    raise HTTPException(status_code=404, detail="Dataset not found.")


def read_dataset(path: Path) -> pd.DataFrame:
    suffix = path.name.rsplit(".", 1)[-1]
    try:
        if suffix == "csv":
            return pd.read_csv(path)
        if suffix == "tsv":
            return pd.read_csv(path, sep="\t")
        if suffix == "json":
            return pd.read_json(path)
        if suffix in {"xlsx", "xls"}:
            return pd.read_excel(path)
        if suffix == "parquet":
            return pd.read_parquet(path)
    except ImportError as error:
        if suffix == "parquet":
            raise HTTPException(
                status_code=503,
                detail="Parquet support needs the optional pyarrow package. Install backend dependencies and retry.",
            ) from error
        raise HTTPException(status_code=503, detail="A required file-reading package is not installed.") from error
    except (ValueError, UnicodeDecodeError, OSError) as error:
        raise HTTPException(status_code=422, detail=f"Could not read dataset: {error}") from error
    raise HTTPException(status_code=415, detail="This file is not a tabular dataset.")


def sqlite_connection(path: Path) -> sqlite3.Connection:
    try:
        return sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)
    except sqlite3.Error as error:
        raise HTTPException(status_code=422, detail="The uploaded SQLite database could not be opened.") from error


def sqlite_tables(path: Path) -> list[str]:
    try:
        with closing(sqlite_connection(path)) as connection:
            return [
                row[0]
                for row in connection.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
                )
            ]
    except sqlite3.Error as error:
        raise HTTPException(status_code=422, detail="The uploaded SQLite database is invalid.") from error


def image_signature_is_valid(path: Path, extension: str) -> bool:
    with path.open("rb") as image:
        header = image.read(8)
    signatures = {
        ".png": lambda: header.startswith(b"\x89PNG\r\n\x1a\n"),
        ".jpg": lambda: header.startswith(b"\xff\xd8\xff"),
        ".jpeg": lambda: header.startswith(b"\xff\xd8\xff"),
        ".tif": lambda: header.startswith((b"II*\x00", b"MM\x00*")),
        ".tiff": lambda: header.startswith((b"II*\x00", b"MM\x00*")),
    }
    return signatures[extension]()


def json_value(value: Any) -> Any:
    if pd.api.types.is_scalar(value) and pd.isna(value):
        return None
    if hasattr(value, "item"):
        value = value.item()
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, (datetime, pd.Timestamp)):
        return value.isoformat()
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def format_bytes(size: int) -> str:
    if size < 1024:
        return f"{size} B"
    if size < 1024 * 1024:
        return f"{size / 1024:.1f} KB"
    return f"{size / (1024 * 1024):.1f} MB"


def dataset_summary(dataset_id: str, stored_path: Path) -> dict[str, Any]:
    original_name = stored_path.with_suffix(".name").read_text(encoding="utf-8")
    suffix = stored_path.suffix.lower()
    if suffix in IMAGE_EXTENSIONS:
        if not image_signature_is_valid(stored_path, suffix):
            raise HTTPException(status_code=422, detail="The file contents do not match a supported image format.")
        return {
            "id": dataset_id,
            "name": original_name,
            "kind": "image",
            "format": suffix[1:],
            "rows": 0,
            "columns": 0,
            "size_bytes": stored_path.stat().st_size,
            "uploaded_at": datetime.fromtimestamp(stored_path.stat().st_mtime, timezone.utc).isoformat(),
            "column_names": [],
            "types": {},
            "missing": {},
            "duplicate_rows": 0,
            "outliers": {},
            "memory_bytes": stored_path.stat().st_size,
            "validation_warnings": ["Image uploaded and signature-validated. Pixel-level analysis is not implemented yet."],
            "preview": [],
        }
    if suffix in DATABASE_EXTENSIONS:
        tables = sqlite_tables(stored_path)
        return {
            "id": dataset_id,
            "name": original_name,
            "kind": "sqlite",
            "format": suffix[1:],
            "rows": 0,
            "columns": 0,
            "size_bytes": stored_path.stat().st_size,
            "uploaded_at": datetime.fromtimestamp(stored_path.stat().st_mtime, timezone.utc).isoformat(),
            "column_names": [],
            "types": {},
            "missing": {},
            "duplicate_rows": 0,
            "outliers": {},
            "memory_bytes": 0,
            "tables": tables,
            "validation_warnings": [] if tables else ["No user tables were found in this database."],
            "preview": [],
        }
    frame = read_dataset(stored_path)
    types = {str(column): str(dtype) for column, dtype in frame.dtypes.items()}
    missing = {str(column): int(count) for column, count in frame.isna().sum().items()}
    outliers = {}
    for column in frame.select_dtypes(include="number").columns:
        values = frame[column].dropna()
        if values.empty:
            outliers[str(column)] = 0
            continue
        lower = values.quantile(0.25)
        upper = values.quantile(0.75)
        spread = upper - lower
        outliers[str(column)] = int(((values < lower - 1.5 * spread) | (values > upper + 1.5 * spread)).sum())
    warnings = []
    if frame.empty:
        warnings.append("The dataset contains no data rows.")
    if frame.columns.has_duplicates:
        warnings.append("Duplicate column names were detected.")
    if frame.isna().all(axis=1).any():
        warnings.append("One or more rows contain only missing values.")
    preview = [
        {str(column): json_value(value) for column, value in row.items()}
        for row in frame.head(MAX_PREVIEW_ROWS).to_dict(orient="records")
    ]
    return {
        "id": dataset_id,
        "name": original_name,
        "kind": "table",
        "format": stored_path.suffix.lower().lstrip("."),
        "rows": int(len(frame)),
        "columns": int(len(frame.columns)),
        "size_bytes": stored_path.stat().st_size,
        "uploaded_at": datetime.fromtimestamp(stored_path.stat().st_mtime, timezone.utc).isoformat(),
        "column_names": [str(column) for column in frame.columns],
        "types": types,
        "missing": missing,
        "duplicate_rows": int(frame.duplicated().sum()),
        "outliers": outliers,
        "memory_bytes": int(frame.memory_usage(index=True, deep=True).sum()),
        "validation_warnings": warnings,
        "preview": preview,
    }


def all_datasets() -> list[dict[str, Any]]:
    datasets: list[dict[str, Any]] = []
    for extension in ALLOWED_EXTENSIONS:
        for path in DATA_DIR.glob(f"*{extension}"):
            dataset_id = path.stem
            if not SAFE_DATASET_ID.fullmatch(dataset_id):
                continue
            try:
                datasets.append(dataset_summary(dataset_id, path))
            except HTTPException:
                continue
    return sorted(datasets, key=lambda dataset: dataset["uploaded_at"], reverse=True)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/datasets")
def list_datasets() -> list[dict[str, Any]]:
    return all_datasets()


@app.post("/api/datasets/upload")
async def upload_dataset(file: UploadFile = File(...)) -> dict[str, Any]:
    original_name = Path(file.filename or "").name
    extension = Path(original_name).suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=415, detail="Supported files: CSV, TSV, JSON, XLSX, XLS, Parquet, SQLite database, JPG, PNG, and TIFF.")

    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if not data:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Files must be 50 MB or smaller.")

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    dataset_id = uuid.uuid4().hex
    stored_path = DATA_DIR / f"{dataset_id}{extension}"
    stored_path.write_bytes(data)
    stored_path.with_suffix(".name").write_text(original_name, encoding="utf-8")
    try:
        if extension in IMAGE_EXTENSIONS and not image_signature_is_valid(stored_path, extension):
            raise HTTPException(status_code=422, detail="The file contents do not match a supported image format.")
        summary = dataset_summary(dataset_id, stored_path)
    except Exception:
        stored_path.unlink(missing_ok=True)
        stored_path.with_suffix(".name").unlink(missing_ok=True)
        raise
    return summary


@app.get("/api/datasets/{dataset_id}")
def get_dataset(dataset_id: str) -> dict[str, Any]:
    return dataset_summary(dataset_id, dataset_path(dataset_id))


def sqlite_table_preview(path: Path, table: str) -> dict[str, Any]:
    tables = sqlite_tables(path)
    if table not in tables:
        raise HTTPException(status_code=404, detail="Table not found in this database.")
    quoted_table = '"' + table.replace('"', '""') + '"'
    try:
        with closing(sqlite_connection(path)) as connection:
            frame = pd.read_sql_query(f"SELECT * FROM {quoted_table} LIMIT 100", connection)
            total_rows = connection.execute(f"SELECT COUNT(*) FROM {quoted_table}").fetchone()[0]
            table_columns = [
                row[1]
                for row in connection.execute(f"PRAGMA table_info({quoted_table})")
            ]
            if table_columns:
                quoted_columns = [
                    '"' + column.replace('"', '""') + '"'
                    for column in table_columns
                ]
                null_counts = connection.execute(
                    "SELECT " + ", ".join(
                        f"SUM({column} IS NULL)"
                        for column in quoted_columns
                    ) + f" FROM {quoted_table}"
                ).fetchone()
                grouping = ", ".join(quoted_columns)
                duplicate_rows = connection.execute(
                    f"SELECT COALESCE(SUM(n - 1), 0) FROM "
                    f"(SELECT COUNT(*) AS n FROM {quoted_table} GROUP BY {grouping} HAVING n > 1)"
                ).fetchone()[0]
            else:
                null_counts = ()
                duplicate_rows = 0
    except sqlite3.Error as error:
        raise HTTPException(status_code=422, detail="Could not read the selected database table.") from error
    summary = dataset_summary(path.stem, path)
    summary.update({
        "kind": "sqlite-table",
        "table_name": table,
        "rows": int(total_rows),
        "columns": int(len(frame.columns)),
        "column_names": [str(column) for column in frame.columns],
        "types": {str(column): str(dtype) for column, dtype in frame.dtypes.items()},
        "missing": {
            str(column): int(count or 0)
            for column, count in zip(table_columns, null_counts, strict=True)
        },
        "duplicate_rows": int(duplicate_rows),
        "outliers": {},
        "preview": [
            {str(column): json_value(value) for column, value in row.items()}
            for row in frame.to_dict(orient="records")
        ],
        "memory_bytes": int(frame.memory_usage(index=True, deep=True).sum()),
    })
    return summary


@app.get("/api/datasets/{dataset_id}/tables/{table_name}")
def get_sqlite_table(dataset_id: str, table_name: str) -> dict[str, Any]:
    path = dataset_path(dataset_id)
    if path.suffix.lower() not in DATABASE_EXTENSIONS:
        raise HTTPException(status_code=415, detail="This dataset is not a SQLite database.")
    return sqlite_table_preview(path, table_name)


@app.get("/api/datasets/{dataset_id}/eda")
def get_eda(dataset_id: str, table: str | None = None) -> dict[str, Any]:
    path = dataset_path(dataset_id)
    if path.suffix.lower() in IMAGE_EXTENSIONS:
        raise HTTPException(status_code=415, detail="EDA is available for tabular datasets.")
    if table is not None and path.suffix.lower() not in DATABASE_EXTENSIONS:
        raise HTTPException(status_code=400, detail="A table selector is only valid for a SQLite database.")
    if path.suffix.lower() in DATABASE_EXTENSIONS:
        if table is None or table not in sqlite_tables(path):
            raise HTTPException(status_code=400, detail="Select a valid table from this SQLite database.")
        quoted_table = '"' + table.replace('"', '""') + '"'
        try:
            with closing(sqlite_connection(path)) as connection:
                frame = pd.read_sql_query(f"SELECT * FROM {quoted_table}", connection)
        except sqlite3.Error as error:
            raise HTTPException(status_code=422, detail="Could not compute EDA for this database table.") from error
    else:
        frame = read_dataset(path)
    numeric = frame.select_dtypes(include="number")
    categorical = frame.select_dtypes(exclude="number")
    numeric_summary = json.loads(numeric.describe().to_json())
    categorical_summary = {
        str(column): {
            "unique": int(frame[column].nunique(dropna=True)),
            "top_values": [
                {"value": json_value(value), "count": int(count)}
                for value, count in frame[column].value_counts(dropna=False).head(5).items()
            ],
        }
        for column in categorical.columns
    }
    correlations = {
        method: json.loads(numeric.corr(method=method).to_json())
        for method in ("pearson", "spearman", "kendall")
    }
    class_balance = {
        str(column): [
            {"value": json_value(value), "count": int(count)}
            for value, count in frame[column].value_counts(dropna=False).head(20).items()
        ]
        for column in categorical.columns
        if frame[column].nunique(dropna=True) <= 20
    }
    return {
        "dataset_id": dataset_id,
        "row_count": len(frame),
        "column_count": len(frame.columns),
        "numeric_columns": [str(column) for column in numeric.columns],
        "categorical_columns": [str(column) for column in categorical.columns],
        "numeric_summary": numeric_summary,
        "categorical_summary": categorical_summary,
        "correlations": correlations,
        "class_balance": class_balance,
        "interpretation_note": (
            "Correlations describe association, not causation. Class-balance tables describe "
            "observed counts only; assess study design and assumptions before inference."
        ),
    }


@app.get("/api/datasets/{dataset_id}/quality-report")
def download_quality_report(dataset_id: str, table: str | None = None) -> FileResponse:
    path = dataset_path(dataset_id)
    if table is not None and path.suffix.lower() not in DATABASE_EXTENSIONS:
        raise HTTPException(status_code=400, detail="A table selector is only valid for a SQLite database.")
    dataset = sqlite_table_preview(path, table) if table and path.suffix.lower() in DATABASE_EXTENSIONS else dataset_summary(dataset_id, path)
    report_path = DATA_DIR / f"{dataset_id}.quality.json"
    report_path.write_text(json.dumps(dataset, ensure_ascii=False, indent=2), encoding="utf-8")
    return FileResponse(
        report_path,
        filename=f"data-quality-{dataset_id}.json",
        media_type="application/json",
    )


@app.get("/api/datasets/{dataset_id}/quality-report.html", response_class=HTMLResponse)
def quality_report_html(dataset_id: str, table: str | None = None) -> HTMLResponse:
    path = dataset_path(dataset_id)
    if table is not None and path.suffix.lower() not in DATABASE_EXTENSIONS:
        raise HTTPException(status_code=400, detail="A table selector is only valid for a SQLite database.")
    dataset = sqlite_table_preview(path, table) if table and path.suffix.lower() in DATABASE_EXTENSIONS else dataset_summary(dataset_id, path)
    title = str(dataset["name"])
    columns = "".join(
        "<tr><td>{}</td><td>{}</td><td>{}</td><td>{}</td></tr>".format(
            html.escape(str(name)),
            html.escape(str(dataset["types"].get(name, "—"))),
            dataset["missing"].get(name, 0),
            dataset.get("outliers", {}).get(name, 0),
        )
        for name in dataset["column_names"]
    )
    warnings = "".join(
        f"<li>{html.escape(warning)}</li>"
        for warning in dataset.get("validation_warnings", [])
    ) or "<li>No structural validation warnings.</li>"
    document = f"""<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Data Quality Report — {html.escape(title)}</title>
<style>body{{font:15px/1.55 system-ui,sans-serif;color:#1d2939;max-width:1000px;margin:40px auto;padding:0 22px}}
h1{{margin-bottom:4px}}.muted{{color:#667085}}.cards{{display:flex;gap:12px;flex-wrap:wrap;margin:24px 0}}
.card{{border:1px solid #d0d5dd;border-radius:8px;padding:14px 18px;min-width:145px}}.card b{{display:block;font-size:24px}}
table{{border-collapse:collapse;width:100%;margin:18px 0}}th,td{{padding:10px;text-align:left;border-bottom:1px solid #eaecf0}}
th{{background:#f2f4f7}}@media print{{body{{margin:0;max-width:none}}}}</style>
<h1>Data Quality Report</h1><p class="muted">{html.escape(title)} · Generated {datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")}</p>
<div class="cards"><div class="card"><b>{dataset["rows"]:,}</b>Rows</div><div class="card"><b>{dataset["columns"]:,}</b>Variables</div>
<div class="card"><b>{sum(dataset["missing"].values()):,}</b>Missing values</div><div class="card"><b>{dataset["duplicate_rows"]:,}</b>Duplicate rows</div>
<div class="card"><b>{format_bytes(dataset.get("memory_bytes", 0))}</b>In-memory size</div></div>
<h2>Column-level checks</h2><table><thead><tr><th>Variable</th><th>Type</th><th>Missing</th><th>IQR outliers</th></tr></thead><tbody>{columns}</tbody></table>
<h2>Validation notes</h2><ul>{warnings}</ul>
<p class="muted">Outliers are flagged using the 1.5 × IQR rule; this is a screening heuristic, not a determination that a value is erroneous.</p>
</html>"""
    return HTMLResponse(
        document,
        headers={"Content-Disposition": f'attachment; filename="data-quality-{dataset_id}.html"'},
    )


@app.get("/api/datasets/{dataset_id}/download")
def download_dataset(dataset_id: str) -> FileResponse:
    path = dataset_path(dataset_id)
    name = path.with_suffix(".name").read_text(encoding="utf-8")
    return FileResponse(path, filename=name, media_type="application/octet-stream")


@app.post("/api/ai/ask")
async def ask_ai(
    request: AskRequest,
    x_openai_api_key: str | None = Header(default=None),
) -> dict[str, str]:
    if not x_openai_api_key or not x_openai_api_key.strip():
        raise HTTPException(status_code=401, detail="Connect an OpenAI API key to use the AI analyst.")

    context: dict[str, Any] | None = None
    if request.dataset_id:
        path = dataset_path(request.dataset_id)
        if request.table_name:
            if path.suffix.lower() not in DATABASE_EXTENSIONS:
                raise HTTPException(status_code=400, detail="A table can only be selected from a SQLite database.")
            context = sqlite_table_preview(path, request.table_name)
        else:
            context = dataset_summary(request.dataset_id, path)
        context.pop("preview", None)
        context.pop("id", None)
        context.pop("size_bytes", None)
        context.pop("uploaded_at", None)

    system_message = (
        "You are a careful statistical data analyst. Answer concisely and transparently. "
        "Use only the dataset metadata and quality summary provided; you do not have access "
        "to individual dataset records. Do not invent statistics or claim that an analysis "
        "has been run. Explain that recommendations are hypotheses to validate. Distinguish "
        "association from causation and state when the available context is insufficient."
    )
    user_message = request.question
    if context is not None:
        user_message += "\n\nDataset metadata and quality summary (no record values):\n"
        user_message += json.dumps(context, ensure_ascii=False, allow_nan=False)

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(45.0)) as client:
            response = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {x_openai_api_key.strip()}"},
                json={
                    "model": "gpt-4o-mini",
                    "messages": [
                        {"role": "system", "content": system_message},
                        {"role": "user", "content": user_message},
                    ],
                    "temperature": 0.2,
                },
            )
    except httpx.TimeoutException as error:
        raise HTTPException(status_code=504, detail="OpenAI did not respond in time. Please try again.") from error
    except httpx.RequestError as error:
        raise HTTPException(status_code=502, detail="Could not reach OpenAI. Check the backend network connection.") from error

    if response.status_code in {401, 403}:
        raise HTTPException(status_code=401, detail="OpenAI rejected this API key. Check the key and try again.")
    if response.status_code == 429:
        raise HTTPException(status_code=429, detail="OpenAI rate limit or quota reached. Check your OpenAI account.")
    if response.is_error:
        raise HTTPException(status_code=502, detail="OpenAI returned an error. Please retry shortly.")
    try:
        result = response.json()["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError, ValueError) as error:
        raise HTTPException(status_code=502, detail="OpenAI returned an unrecognized response.") from error
    if not isinstance(result, str) or not result.strip():
        raise HTTPException(status_code=502, detail="OpenAI returned an empty response.")
    return {"answer": result.strip()}
