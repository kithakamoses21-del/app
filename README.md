# Moses Kithaka — AI Data Analysis Studio

An analytics workspace built in phases. This first working slice provides real dataset upload, preview, quality profiling, and an OpenAI-backed AI analyst.

This repository continues the existing `data analysis` project.

## Current capabilities

- React, TypeScript, and Vite frontend with responsive navigation and light/dark themes.
- FastAPI backend with CSV, TSV, JSON, XLSX/XLS, Parquet, SQLite database, and signature-validated JPG/PNG/TIFF uploads.
- Paginated preview over tabular data, inferred column types, missing-value counts, duplicate-row counts, IQR outlier flags, validation notes, memory estimates, variable search, and original-file download.
- SQLite tables are listed and inspected read-only. Image uploads are stored and validated, but pixel analysis is not implemented.
- Exploratory summaries include numeric and categorical summaries, Pearson/Spearman/Kendall correlations, and categorical count summaries.
- Downloadable Data Quality Report in HTML and JSON formats.
- VS Code Run and Debug launches the FastAPI backend and Vite frontend, then opens the app in Chrome. The **Run App** terminal task starts both services.
- OpenAI `gpt-4o-mini` assistant. It receives the user question and dataset metadata/quality summary, **not row values**.
- API keys are entered in the UI, held only in the current page's memory, sent to FastAPI in the `X-OpenAI-API-Key` header per request, and are not stored by the application.

Uploaded datasets are stored locally in `storage/datasets/` by default. Set `DATA_STUDIO_DATA_DIR` to choose another directory. The local first phase is intended for one trusted developer; it does not yet implement user authentication, project-level authorization, multi-user isolation, encryption at rest, or automated retention.

## Requirements

- Node.js 20 or newer and npm. Complete the install once from `frontend` with `npm.cmd install`; if your system drive is full, free disk space first.
- Python 3.11 or newer.
- An OpenAI API key and an OpenAI account with API access to `gpt-4o-mini` to use AI features.

The dataset upload, preview, and profiling features work without an OpenAI key.
Install the complete backend requirements (including `pyarrow` for Parquet and `scipy` for Kendall correlations) before launching the API. Interactive API documentation is available at <http://127.0.0.1:8000/docs> while the backend is running.

## Run locally on Windows

Open two PowerShell terminals from the repository root.

Backend:

```powershell
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --reload --host 127.0.0.1 --port 8000
```

Frontend:

```powershell
cd frontend
npm.cmd install
npm.cmd run dev
```

Open <http://127.0.0.1:5173>. The frontend proxies `/api` requests to FastAPI on port 8000.

In VS Code, open **Run and Debug** and select **Run Moses Data Studio** to launch both services and open the UI in Chrome. The **Run App** task (Terminal → Run Task) starts both services without opening a browser. These launch entries expect the documented Python virtual environment and frontend dependencies to have been installed first.

## Tests and build

From the repository root:

```powershell
.\.venv\Scripts\Activate.ps1
python -m pytest backend\tests -q
```

Frontend production build:

```powershell
cd frontend
npm.cmd run build
```

## Planned phases

Python/R isolated execution, persistent projects and authentication, data transformations, hypothesis tests, machine learning, deep learning, explainability, interactive chart generation, GIS, and full analysis/model reports have not been implemented yet. The navigation marks these areas as planned; it does not claim they are functioning.
