import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  BarChart3,
  Bot,
  Check,
  ChevronDown,
  CircleHelp,
  CircleAlert,
  Command,
  Database,
  FileChartColumn,
  FileDown,
  FileSpreadsheet,
  Files,
  FolderKanban,
  Gauge,
  LayoutDashboard,
  LockKeyhole,
  Menu,
  Moon,
  Paperclip,
  Plus,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  TableProperties,
  Upload,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

type Dataset = {
  id: string;
  name: string;
  kind?: "table" | "sqlite" | "sqlite-table" | "image";
  format?: string;
  rows: number;
  columns: number;
  size_bytes: number;
  uploaded_at: string;
  column_names: string[];
  types: Record<string, string>;
  missing: Record<string, number>;
  duplicate_rows: number;
  outliers?: Record<string, number>;
  memory_bytes?: number;
  tables?: string[];
  table_name?: string;
  validation_warnings?: string[];
  preview: Array<Record<string, unknown>>;
};

type Section =
  | "Overview"
  | "Data Management"
  | "Data Library"
  | "Data Explorer"
  | "Exploratory Analysis"
  | "Statistical Tests"
  | "Time Series"
  | "Machine Learning"
  | "Deep Learning"
  | "Geospatial ML"
  | "Explainable AI"
  | "Visualizations"
  | "AI Code Generator"
  | "AI Data Analyst"
  | "Dashboard"
  | "Reports"
  | "Settings";

const navGroups: Array<{ label: string; items: Array<{ label: Section; icon: LucideIcon }> }> = [
  {
    label: "WORKSPACE",
    items: [
      { label: "Data Management", icon: Database },
      { label: "Exploratory Analysis", icon: BarChart3 },
      { label: "Statistical Tests", icon: Activity },
      { label: "Time Series", icon: FileChartColumn },
    ],
  },
  {
    label: "MODELING",
    items: [
      { label: "Machine Learning", icon: Gauge },
      { label: "Deep Learning", icon: Command },
      { label: "Geospatial ML", icon: FolderKanban },
      { label: "Explainable AI", icon: Sparkles },
      { label: "Visualizations", icon: FileChartColumn },
    ],
  },
  {
    label: "INTELLIGENCE",
    items: [
      { label: "AI Code Generator", icon: Command },
      { label: "AI Data Analyst", icon: Bot },
      { label: "Dashboard", icon: LayoutDashboard },
      { label: "Reports", icon: Files },
    ],
  },
];

const starterPrompts = [
  "Profile my dataset and flag quality issues",
  "What analysis methods fit these columns?",
  "Explain the missing values in my data",
];

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json();
    return body.detail ?? "The request could not be completed.";
  } catch {
    return "The server returned an unexpected response.";
  }
}

async function refreshSqlTable(id: string, table: string) {
  const response = await fetch(`/api/datasets/${id}/tables/${encodeURIComponent(table)}`);
  if (!response.ok) throw new Error(await readError(response));
  return await response.json() as Dataset;
}

export default function App() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selected, setSelected] = useState<Dataset | null>(null);
  const [section, setSection] = useState<Section>("Data Management");
  const [apiKey, setApiKey] = useState("");
  const [showKeyDialog, setShowKeyDialog] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");
  const [pendingQuestion, setPendingQuestion] = useState("");
  const [prompt, setPrompt] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [error, setError] = useState("");
  const [apiReady, setApiReady] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dark, setDark] = useState(() => localStorage.getItem("data-studio-theme") !== "light");
  const [testSplit, setTestSplit] = useState(() => localStorage.getItem("data-studio-test-split") ?? "0.2");
  const [cvFolds, setCvFolds] = useState(() => localStorage.getItem("data-studio-cv-folds") ?? "5");
  const [randomSeed, setRandomSeed] = useState(() => localStorage.getItem("data-studio-random-seed") ?? "42");
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((response) => setApiReady(response.ok))
      .catch(() => setApiReady(false));
    fetch("/api/datasets")
      .then(async (response) => {
        if (!response.ok) throw new Error(await readError(response));
        const result: Dataset[] = await response.json();
        setDatasets(result);
        if (result.length) setSelected(result[0]);
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : "Could not load datasets.");
      });
  }, []);

  const totalMissing = useMemo(
    () => selected ? Object.values(selected.missing).reduce((sum, value) => sum + value, 0) : 0,
    [selected],
  );

  function navigate(nextSection: Section) {
    setSection(nextSection);
    setError("");
  }

  function changeTheme(value: boolean) {
    setDark(value);
    localStorage.setItem("data-studio-theme", value ? "dark" : "light");
  }

  async function uploadFile(file?: File) {
    if (!file) return;
    setError("");
    setUploadBusy(true);
    const form = new FormData();
    form.append("file", file);
    try {
      const response = await fetch("/api/datasets/upload", { method: "POST", body: form });
      if (!response.ok) throw new Error(await readError(response));
      const dataset: Dataset = await response.json();
      setDatasets((current) => [dataset, ...current]);
      setSelected(dataset);
      setSection("Data Management");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Upload failed.");
    } finally {
      setUploadBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function refreshDataset(id: string) {
    const response = await fetch(`/api/datasets/${id}`);
    if (!response.ok) throw new Error(await readError(response));
    const dataset: Dataset = await response.json();
    setDatasets((current) => current.map((item) => item.id === id ? dataset : item));
    setSelected(dataset);
  }

  async function askAI(question = prompt, key = apiKey) {
    const cleanQuestion = question.trim();
    if (!cleanQuestion) return;
    setPrompt(cleanQuestion);
    if (!key) {
      setPendingQuestion(cleanQuestion);
      setKeyDraft("");
      setShowKeyDialog(true);
      return;
    }
    setError("");
    setBusy(true);
    setPrompt(cleanQuestion);
    setAnswer("");
    try {
      const response = await fetch("/api/ai/ask", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-OpenAI-API-Key": key,
        },
        body: JSON.stringify({
          question: cleanQuestion,
          dataset_id: selected?.id ?? null,
          table_name: selected?.table_name ?? null,
        }),
      });
      if (!response.ok) {
        const message = await readError(response);
        if (response.status === 401 || response.status === 403) {
          setApiKey("");
          setKeyDraft("");
          setShowKeyDialog(true);
        }
        throw new Error(message);
      }
      const result: { answer: string } = await response.json();
      setAnswer(result.answer);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "AI request failed.");
    } finally {
      setBusy(false);
    }
  }

  function saveKey() {
    const value = keyDraft.trim();
    if (!value) return;
    setApiKey(value);
    setShowKeyDialog(false);
    const question = pendingQuestion;
    setPendingQuestion("");
    if (question) void askAI(question, value);
  }

  return (
    <div className={dark ? "app-shell" : "app-shell light"}>
      <aside className={`sidebar ${menuOpen ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark"><span>m</span></div>
          <div className="brand-text"><strong>moses<span>.</span></strong><small>DATA STUDIO</small></div>
          <button className="icon-button mobile-close" aria-label="Close menu" onClick={() => setMenuOpen(false)}><X size={18} /></button>
        </div>
        <button className="project-switch" onClick={() => navigate("Dashboard")}>
          <span className="project-icon"><FolderKanban size={16} /></span>
          <span><b>Research workspace</b><small>Personal project</small></span>
          <ChevronDown size={15} className="muted-icon" />
        </button>
        <div className="side-nav">
          {navGroups.map((group) => (
            <div className="nav-group" key={group.label}>
              <p>{group.label}</p>
              {group.items.map(({ label, icon: Icon }) => {
                const active = section === label;
                return (
                  <button
                    key={label}
                    className={`nav-item ${active ? "active" : ""}`}
                    onClick={() => {
                      navigate(label);
                      setMenuOpen(false);
                    }}
                  >
                    <Icon size={17} strokeWidth={1.8} /><span>{label}</span>
                    {label === "AI Data Analyst" && <span className="new-dot" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="sidebar-bottom">
          <div className="privacy-note"><ShieldCheck size={15} /><span>Your data stays yours</span></div>
          <button className={`nav-item ${section === "Settings" ? "active" : ""}`} onClick={() => navigate("Settings")}><Settings2 size={17} /><span>Settings</span></button>
          <div className="user-profile"><div className="avatar">MK</div><span><b>Moses Kithaka</b><small>Personal plan</small></span><ChevronDown size={15} /></div>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div className="top-left">
            <button className="icon-button menu-toggle" aria-label="Open menu" onClick={() => setMenuOpen(true)}><Menu size={19} /></button>
            <div className="breadcrumb"><span>Workspace</span><span className="crumb-slash">/</span><b>{section}</b></div>
          </div>
          <div className="top-actions">
            <div className="runtime-status"><span className={apiReady ? "status-dot" : "status-dot offline"} />API {apiReady ? "connected" : "offline"}</div>
            <button className="icon-button theme-toggle" aria-label="Toggle theme" onClick={() => changeTheme(!dark)}>{dark ? <Sun size={17} /> : <Moon size={17} />}</button>
            <button className="connect-button" onClick={() => { setKeyDraft(""); setShowKeyDialog(true); }}>
              <LockKeyhole size={15} /> {apiKey ? "OpenAI connected" : "Connect OpenAI"}
            </button>
          </div>
        </header>
        {error && <div className="toast-error" role="alert"><CircleHelp size={16} />{error}<button aria-label="Dismiss error" onClick={() => setError("")}><X size={15} /></button></div>}
        <div className="content">
          {section === "Dashboard" && (
            <Overview
              datasets={datasets}
              selected={selected}
              totalMissing={totalMissing}
              uploadBusy={uploadBusy}
              onSelect={setSelected}
              openFile={() => fileInput.current?.click()}
              goTo={navigate}
              openKey={() => { setKeyDraft(""); setShowKeyDialog(true); }}
            />
          )}
          {(section === "Data Management" || section === "Data Library") && (
            <DataManagement datasets={datasets} selected={selected} onSelect={setSelected} onUpload={(file) => void uploadFile(file)} openFile={() => fileInput.current?.click()} />
          )}
          {section === "Data Management" && selected && (
            <DataExplorer dataset={selected} onUpload={() => fileInput.current?.click()} onRefresh={refreshDataset} onRefreshTable={refreshSqlTable} onTableSelect={setSelected} />
          )}
          {section === "Exploratory Analysis" && (
            <EDAView dataset={selected} onManage={() => navigate("Data Management")} />
          )}
          {section === "AI Data Analyst" && (
            <AIAnalyst
              dataset={selected}
              prompt={prompt}
              setPrompt={setPrompt}
              answer={answer}
              busy={busy}
              apiKeyReady={Boolean(apiKey)}
              onAsk={askAI}
              onConnect={() => { setKeyDraft(""); setShowKeyDialog(true); }}
            />
          )}
          {section === "Reports" && <ReportsPage dataset={selected} />}
          {section === "Settings" && (
            <SettingsPage
              dark={dark}
              onThemeChange={changeTheme}
              testSplit={testSplit}
              onTestSplitChange={(value) => { setTestSplit(value); localStorage.setItem("data-studio-test-split", value); }}
              cvFolds={cvFolds}
              onCvFoldsChange={(value) => { setCvFolds(value); localStorage.setItem("data-studio-cv-folds", value); }}
              randomSeed={randomSeed}
              onRandomSeedChange={(value) => { setRandomSeed(value); localStorage.setItem("data-studio-random-seed", value); }}
              openKey={() => setShowKeyDialog(true)}
            />
          )}
          {!["Dashboard", "Data Management", "Data Library", "Data Explorer", "Exploratory Analysis", "AI Data Analyst", "Reports", "Settings"].includes(section) && (
            <PlannedModule name={section} />
          )}
        </div>
        <input
          ref={fileInput}
          type="file"
          hidden
          accept=".csv,.tsv,.json,.xlsx,.xls,.parquet,.db,.sqlite,.sqlite3,.jpg,.jpeg,.png,.tif,.tiff"
          onChange={(event) => void uploadFile(event.target.files?.[0])}
        />
      </main>
      {showKeyDialog && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setShowKeyDialog(false);
        }}>
          <section className="key-modal" role="dialog" aria-modal="true" aria-labelledby="key-title">
            <button className="modal-close icon-button" aria-label="Close" onClick={() => setShowKeyDialog(false)}><X size={18} /></button>
            <div className="modal-icon"><Sparkles size={21} /></div>
            <p className="eyebrow">AI DATA ANALYST</p>
            <h2 id="key-title">Connect your OpenAI key</h2>
            <p className="modal-description">Add an OpenAI API key to ask questions about your dataset. Your key is held in this tab’s memory and sent to the backend only when you make an AI request.</p>
            <label htmlFor="api-key">OpenAI API key</label>
            <input
              id="api-key"
              type="password"
              autoComplete="off"
              placeholder="sk-..."
              value={keyDraft}
              onChange={(event) => setKeyDraft(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") saveKey(); }}
            />
            <div className="key-footnote"><LockKeyhole size={13} /> Not saved to local storage, files, or logs.</div>
            <button className="primary-button full-button" disabled={!keyDraft.trim()} onClick={saveKey}>Connect securely <ArrowRight size={16} /></button>
            <a className="external-link" href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">Get an API key from OpenAI <ArrowRight size={13} /></a>
          </section>
        </div>
      )}
    </div>
  );
}

function PageHeading({ kicker, title, description, action }: { kicker: string; title: React.ReactNode; description: string; action?: React.ReactNode }) {
  return <div className="page-heading"><div><p className="eyebrow">{kicker}</p><h1>{title}</h1><p className="page-description">{description}</p></div>{action}</div>;
}

function Overview({
  datasets, selected, totalMissing, uploadBusy, onSelect, openFile, goTo, openKey,
}: {
  datasets: Dataset[];
  selected: Dataset | null;
  totalMissing: number;
  uploadBusy: boolean;
  onSelect: (dataset: Dataset) => void;
  openFile: () => void;
  goTo: (section: Section) => void;
  openKey: () => void;
}) {
  return (
    <>
      <PageHeading
        kicker={new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }).toUpperCase()}
        title={<>Make your data <span className="gradient-text">make sense.</span></>}
        description="Your research workspace is ready. Bring in a dataset and start uncovering what it has to say."
        action={<button className="primary-button" onClick={openFile}><Plus size={17} /> New analysis</button>}
      />
      <section className="welcome-banner">
        <div className="welcome-copy">
          <div className="welcome-label"><span className="sparkle-pill"><Sparkles size={13} /></span> YOUR ANALYTICS WORKSPACE</div>
          <h2>From raw data to<br />statistical insight.</h2>
          <p>Upload a dataset to explore its structure, quality, and patterns — then ask AI to help you decide what to do next.</p>
          <button className="banner-button" onClick={openFile}><Upload size={16} />{uploadBusy ? "Uploading…" : "Upload a dataset"}<ArrowRight size={15} /></button>
        </div>
        <div className="banner-graphic" aria-hidden="true">
          <div className="orb orb-one" /><div className="orb orb-two" />
          <div className="chart-card">
            <div className="chart-card-head"><span>Data signals</span><span className="live-pill"><span /> READY</span></div>
            <div className="bar-chart">
              {[28, 43, 36, 61, 47, 70, 53, 82, 66, 94, 73, 86, 58, 75, 48, 65].map((height, index) => <i key={index} style={{ height: `${height}%`, opacity: 0.34 + (index / 30) }} />)}
            </div>
            <div className="chart-card-foot"><span>UPLOAD YOUR DATA</span><span>INSIGHT FOLLOWS <ArrowRight size={11} /></span></div>
          </div>
          <div className="float-chip"><span className="chip-icon"><Activity size={13} /></span><span>Analysis ready<small>Waiting for data</small></span><span className="chip-check"><Check size={12} /></span></div>
        </div>
      </section>
      <section className="stats-grid">
        <StatCard icon={<Database size={17} />} label="Datasets" value={datasets.length.toString()} detail={datasets.length ? "In your library" : "Upload your first"} color="blue" />
        <StatCard icon={<BarChart3 size={17} />} label="Rows in focus" value={selected?.kind === "sqlite" || selected?.kind === "image" ? "—" : selected ? selected.rows.toLocaleString() : "—"} detail={selected ? selected.kind === "sqlite" ? "Select a table to inspect" : selected.name : "No dataset selected"} color="violet" />
        <StatCard icon={<Activity size={17} />} label="Columns" value={selected?.kind === "sqlite" || selected?.kind === "image" ? "—" : selected ? selected.columns.toString() : "—"} detail={selected ? selected.kind === "sqlite" ? "Select a table to inspect" : "Variables detected" : "Awaiting your data"} color="mint" />
        <StatCard icon={<ShieldCheck size={17} />} label="Missing values" value={selected?.kind === "sqlite" || selected?.kind === "image" ? "—" : selected ? totalMissing.toLocaleString() : "—"} detail={selected ? selected.kind === "sqlite" || selected.kind === "image" ? "Not applicable to this file" : (totalMissing ? "Review data quality" : "Dataset looks complete") : "Profile after upload"} color="amber" />
      </section>
      <section className="lower-grid">
        <div className="panel recent-panel">
          <div className="panel-heading"><div><h3>Recent datasets</h3><p>Your latest uploads, ready to explore</p></div>          <button className="text-button" onClick={() => goTo("Data Management")}>View library <ArrowRight size={14} /></button></div>
          {datasets.length ? datasets.slice(0, 3).map((dataset) => (
            <button className="dataset-row" key={dataset.id} onClick={() => { onSelect(dataset); goTo("Data Management"); }}>
              <div className="file-icon"><FileSpreadsheet size={17} /></div>
              <span className="dataset-row-name"><b>{dataset.name}</b><small>{dataset.rows.toLocaleString()} rows · {dataset.columns} columns</small></span>
              <span className="quality-badge"><span /> Profiled</span><ArrowRight size={15} className="row-arrow" />
            </button>
          )) : <div className="empty-inline"><div className="empty-icon"><Database size={18} /></div><span><b>No datasets yet</b><small>Upload a CSV, Excel, or JSON file to get started.</small></span><button className="quiet-button" onClick={openFile}>Browse files</button></div>}
        </div>
        <div className="panel ai-card">
          <div className="ai-card-top"><div className="ai-icon"><Sparkles size={18} /></div><span className="beta-tag">AI ASSISTANT</span></div>
          <h3>A second mind for<br />your data.</h3>
          <p>Ask research questions, get method suggestions, and make sense of your results — with your data as context.</p>
          <button className="ai-link" onClick={() => goTo("AI Data Analyst")}>Meet your AI analyst <ArrowRight size={15} /></button>
          <button className="small-key-link" onClick={openKey}><LockKeyhole size={13} /> Connect your OpenAI API key</button>
        </div>
      </section>
      <div className="bottom-note"><ShieldCheck size={14} /><span>Built for reproducible research</span><span className="note-divider" /><span>No fabricated results. Your analysis, your evidence.</span></div>
    </>
  );
}

function StatCard({ icon, label, value, detail, color }: { icon: React.ReactNode; label: string; value: string; detail: string; color: string }) {
  return <div className="stat-card"><div className={`stat-icon ${color}`}>{icon}</div><span className="stat-label">{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function DataManagement({
  datasets, selected, onSelect, onUpload, openFile,
}: {
  datasets: Dataset[];
  selected: Dataset | null;
  onSelect: (dataset: Dataset) => void;
  onUpload: (file: File) => void;
  openFile: () => void;
}) {
  const [query, setQuery] = useState("");
  const [dragging, setDragging] = useState(false);
  const filteredDatasets = datasets.filter((dataset) => dataset.name.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <>
      <PageHeading kicker="LOCAL DATA WORKSPACE" title="Data management" description="Upload, preview, validate, and inspect data quality. Files are stored locally on this device." action={<button className="primary-button" onClick={openFile}><Upload size={16} /> Upload a file</button>} />
      <div
        className={`upload-dropzone ${dragging ? "dragging" : ""}`}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer.files[0];
          if (file) onUpload(file);
        }}
      >
        <div className="upload-drop-icon"><Upload size={20} /></div>
        <b>Drop a file here or click to browse</b>
        <span>CSV · TSV · JSON · Excel · Parquet · SQLite · JPG · PNG · TIFF</span>
        <button className="outline-button" onClick={openFile}>Choose file</button>
        <small>Maximum 50 MB per file. SQLite uploads are opened read-only.</small>
      </div>
      <div className="library-toolbar"><div className="search-box"><Search size={16} /><input placeholder="Search datasets…" aria-label="Search datasets" value={query} onChange={(event) => setQuery(event.target.value)} /></div><span>{filteredDatasets.length} dataset{filteredDatasets.length === 1 ? "" : "s"}</span></div>
      {filteredDatasets.length ? <div className="dataset-grid">{filteredDatasets.map((dataset) => (
        <button key={dataset.id} className={`library-card ${selected?.id === dataset.id ? "selected" : ""}`} onClick={() => onSelect(dataset)}>
          <div className="library-card-top"><div className="file-icon large"><FileSpreadsheet size={19} /></div><span className="quality-badge"><span /> Ready</span></div>
          <h3>{dataset.name}</h3><p>{dataset.kind === "image" ? `${dataset.format?.toUpperCase()} image · metadata only` : dataset.kind === "sqlite" ? `${dataset.tables?.length ?? 0} database tables` : `${dataset.rows.toLocaleString()} rows · ${dataset.columns} columns`}</p>
          <div className="library-card-foot"><span>{formatBytes(dataset.size_bytes)}</span><span>{new Date(dataset.uploaded_at).toLocaleDateString()}</span></div>
        </button>
      ))}</div> : <EmptyState icon={<Database size={23} />} title="Your library is ready" body="Upload a supported table, SQLite database, or image file to start." action="Upload a dataset" onClick={openFile} />}
    </>
  );
}

function DataExplorer({
  dataset, onUpload, onRefresh, onRefreshTable, onTableSelect,
}: {
  dataset: Dataset | null;
  onUpload: () => void;
  onRefresh: (id: string) => Promise<void>;
  onRefreshTable: (id: string, table: string) => Promise<Dataset>;
  onTableSelect: (dataset: Dataset) => void;
}) {
  const [page, setPage] = useState(0);
  const pageSize = 8;
  const [refreshing, setRefreshing] = useState(false);
  const [activeTable, setActiveTable] = useState<Dataset | null>(null);
  const [tableError, setTableError] = useState("");
  const [variableSearch, setVariableSearch] = useState("");
  useEffect(() => {
    setActiveTable(null);
    setTableError("");
    setPage(0);
  }, [dataset?.id, dataset?.kind, dataset?.table_name]);
  if (!dataset) return <><PageHeading kicker="EXPLORE" title="Data explorer" description="Inspect real data, dimensions, and quality indicators." /><EmptyState icon={<Database size={23} />} title="Choose a dataset to explore" body="Upload a file to see its real rows, columns, and quality profile." action="Upload a dataset" onClick={onUpload} /></>;
  if (dataset.kind === "image") {
    return <div className="panel image-detail"><div className="image-mark"><FileSpreadsheet size={22} /></div><p className="eyebrow">IMAGE UPLOAD · {dataset.format?.toUpperCase()}</p><h3>{dataset.name}</h3><p>This image has been uploaded and its file signature validated. Pixel analysis and computer-vision workflows are not implemented yet.</p><div className="quality-facts"><span>File size <b>{formatBytes(dataset.size_bytes)}</b></span><span>Validation <b>Signature verified</b></span></div><a className="outline-button download-link" href={`/api/datasets/${dataset.id}/download`}><ArrowDownToLine size={15} /> Download original</a></div>;
  }
  const effectiveDataset = activeTable ?? dataset;
  const rows = effectiveDataset.preview.slice(page * pageSize, (page + 1) * pageSize);
  const pageCount = Math.max(1, Math.ceil(effectiveDataset.preview.length / pageSize));
  const refresh = async () => {
    setRefreshing(true);
    setTableError("");
    try {
      const tableName = activeTable?.table_name ?? dataset.table_name;
      if ((dataset.kind === "sqlite" || dataset.kind === "sqlite-table") && tableName) {
        const refreshed = await onRefreshTable(dataset.id, tableName);
        setActiveTable(refreshed);
        onTableSelect(refreshed);
      } else {
        await onRefresh(dataset.id);
      }
    } catch (reason) {
      setTableError(reason instanceof Error ? reason.message : "Could not refresh data.");
    } finally {
      setRefreshing(false);
    }
  };
  return (
    <>
      <PageHeading kicker={dataset.kind === "sqlite" ? "READ-ONLY SQLITE" : "DATA PROFILE"} title={dataset.table_name ? `${dataset.name} / ${dataset.table_name}` : dataset.name} description="Dimensions, inferred types, missing values, duplicates, outlier flags, and memory use are computed from the uploaded file." action={<button className="outline-button" disabled={refreshing} onClick={() => void refresh()}><Activity size={15} />{refreshing ? "Refreshing…" : "Refresh profile"}</button>} />
      {dataset.kind === "sqlite" && <div className="table-picker"><TableProperties size={16} /><label htmlFor="sqlite-table">Choose database table</label><select id="sqlite-table" value={activeTable?.table_name ?? ""} onChange={async (event) => {
        const tableName = event.target.value;
        setActiveTable(null);
        setTableError("");
        setPage(0);
        if (!tableName) return;
        try {
          const tableData = await onRefreshTable(dataset.id, tableName);
          setActiveTable(tableData);
          onTableSelect(tableData);
        } catch (reason) {
          setTableError(reason instanceof Error ? reason.message : "Could not read this table.");
        }
      }}><option value="">Select a table…</option>{dataset.tables?.map((table) => <option key={table} value={table}>{table}</option>)}</select></div>}
      {tableError && <div className="inline-error" role="alert"><CircleAlert size={15} />{tableError}</div>}
      {dataset.kind === "sqlite" && !activeTable ? <div className="empty-state compact-empty"><div className="empty-icon large"><TableProperties size={23} /></div><h2>{dataset.tables?.length ? "Select a table to inspect" : "No tables found"}</h2><p>{dataset.tables?.length ? "Tables are opened read-only. Select one to see its actual preview and profile." : "This SQLite database contains no user tables."}</p></div> : <>
      <div className="stats-grid explorer-stats">
        <StatCard icon={<RowsIcon />} label="Rows" value={effectiveDataset.rows.toLocaleString()} detail={effectiveDataset.table_name ? `Table: ${effectiveDataset.table_name}` : "Records in dataset"} color="blue" />
        <StatCard icon={<Database size={17} />} label="Variables" value={effectiveDataset.columns.toString()} detail="Detected columns" color="violet" />
        <StatCard icon={<CircleHelp size={17} />} label="Missing values" value={Object.values(effectiveDataset.missing).reduce((sum, value) => sum + value, 0).toLocaleString()} detail="Across selected variables" color={Object.values(effectiveDataset.missing).some((value) => value > 0) ? "amber" : "mint"} />
        <StatCard icon={<Files size={17} />} label="Duplicate rows" value={effectiveDataset.duplicate_rows.toLocaleString()} detail={`${formatBytes(effectiveDataset.memory_bytes ?? 0)} in memory`} color={effectiveDataset.duplicate_rows ? "amber" : "mint"} />
      </div>
      <div className="panel preview-panel">
        <div className="panel-heading"><div><h3>Data preview</h3><p>Showing {effectiveDataset.preview.length} actual rows in this preview · {effectiveDataset.rows.toLocaleString()} total rows</p></div><a className="text-button download-link" href={`/api/datasets/${dataset.id}/download`}><ArrowDownToLine size={14} /> Download original</a></div>
        {effectiveDataset.columns ? <div className="table-wrap"><table><thead><tr>{effectiveDataset.column_names.map((name) => <th key={name}>{name}<small>{effectiveDataset.types[name] ?? "unknown"}</small></th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={`${page}-${index}`}>{effectiveDataset.column_names.map((column) => <td key={column}>{formatCell(row[column])}</td>)}</tr>)}</tbody></table></div> : <p className="no-columns-note">No tabular columns were found.</p>}
        <div className="table-foot"><span>Preview rows {effectiveDataset.preview.length ? page * pageSize + 1 : 0}–{Math.min((page + 1) * pageSize, effectiveDataset.preview.length)} of {effectiveDataset.preview.length}</span><div className="pagination"><button disabled={page === 0} onClick={() => setPage((current) => current - 1)}>Previous</button><span>{page + 1} / {pageCount}</span><button disabled={page + 1 >= pageCount} onClick={() => setPage((current) => current + 1)}>Next</button></div></div>
      </div>
      <div className="panel profile-panel">
        <div className="panel-heading"><div><h3>Column quality profile</h3><p>Missing values and 1.5 × IQR outlier screening by numeric variable</p></div><div className="profile-actions"><div className="search-box compact-search"><Search size={14} /><input placeholder="Search variables…" aria-label="Search variables" value={variableSearch} onChange={(event) => setVariableSearch(event.target.value)} /></div><a className="text-button download-link" href={`/api/datasets/${dataset.id}/quality-report.html${effectiveDataset.table_name ? `?table=${encodeURIComponent(effectiveDataset.table_name)}` : ""}`}><FileDown size={14} /> Quality report</a></div></div>
        <div className="profile-list">{effectiveDataset.column_names.filter((column) => column.toLowerCase().includes(variableSearch.trim().toLowerCase())).map((column) => {
          const missing = effectiveDataset.missing[column] ?? 0;
          const percentage = effectiveDataset.rows ? Math.round((missing / effectiveDataset.rows) * 100) : 0;
          return <div className="profile-row" key={column}><span className="profile-name">{column}</span><span className="type-pill">{effectiveDataset.types[column]}</span><span className="profile-bar"><i style={{ width: `${percentage}%` }} /></span><span className="profile-missing">{missing.toLocaleString()} missing · {effectiveDataset.outliers?.[column] ?? "—"} outliers</span></div>;
        })}</div>
      </div>
      {effectiveDataset.validation_warnings?.length ? <div className="validation-warning"><CircleAlert size={15} /><div><b>Data validation notes</b>{effectiveDataset.validation_warnings.map((warning) => <span key={warning}>{warning}</span>)}</div></div> : null}
      </>}
    </>
  );
}

type EdaResult = {
  row_count: number;
  column_count: number;
  numeric_columns: string[];
  categorical_columns: string[];
  numeric_summary: Record<string, Record<string, number | null>>;
  categorical_summary: Record<string, { unique: number; top_values: Array<{ value: unknown; count: number }> }>;
  correlations: Record<string, Record<string, Record<string, number | null>>>;
  class_balance: Record<string, Array<{ value: unknown; count: number }>>;
  interpretation_note: string;
};

function EDAView({ dataset, onManage }: { dataset: Dataset | null; onManage: () => void }) {
  const [eda, setEda] = useState<EdaResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setEda(null);
    setError("");
    setLoading(false);
    if (!dataset) return () => controller.abort();
    if (dataset.kind !== "table" && dataset.kind !== "sqlite-table") {
      setError(dataset.kind === "sqlite" ? "Choose a database table in Data Management before running EDA." : "EDA requires a tabular dataset.");
      return () => controller.abort();
    }
    setLoading(true);
    const edaUrl = dataset.kind === "sqlite-table" && dataset.table_name
      ? `/api/datasets/${dataset.id}/eda?table=${encodeURIComponent(dataset.table_name)}`
      : `/api/datasets/${dataset.id}/eda`;
    fetch(edaUrl, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(await readError(response));
        return await response.json() as EdaResult;
      })
      .then(setEda)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not compute EDA.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [dataset]);

  return (
    <>
      <PageHeading kicker="EXPLORATORY DATA ANALYSIS" title="Explore your dataset" description={dataset ? `Computed summaries and correlations for ${dataset.name}.` : "Upload a tabular dataset to compute descriptive summaries and correlations."} />
      {loading && <div className="panel loading-panel"><div className="loading-spinner" />Computing summaries from your dataset…</div>}
      {error && <div className="inline-error"><CircleAlert size={15} />{error}</div>}
      {!dataset && <EmptyState icon={<BarChart3 size={23} />} title="No dataset selected" body="Upload a CSV, Excel, JSON, or Parquet file in Data Management." action="Open Data Management" onClick={onManage} />}
      {eda && <>
        <div className="stats-grid explorer-stats">
          <StatCard icon={<RowsIcon />} label="Observations" value={eda.row_count.toLocaleString()} detail="Rows used in summaries" color="blue" />
          <StatCard icon={<Database size={17} />} label="Variables" value={eda.column_count.toString()} detail="Columns in dataset" color="violet" />
          <StatCard icon={<Activity size={17} />} label="Numeric" value={eda.numeric_columns.length.toString()} detail="Numeric variables" color="mint" />
          <StatCard icon={<TableProperties size={17} />} label="Categorical" value={eda.categorical_columns.length.toString()} detail="Non-numeric variables" color="amber" />
        </div>
        <div className="panel profile-panel">
          <div className="panel-heading"><div><h3>Numerical summary</h3><p>Descriptive statistics calculated from the uploaded dataset</p></div></div>
          {eda.numeric_columns.length ? <div className="table-wrap"><table><thead><tr><th>Statistic</th>{eda.numeric_columns.map((name) => <th key={name}>{name}</th>)}</tr></thead><tbody>{["count", "mean", "std", "min", "25%", "50%", "75%", "max"].map((statistic) => <tr key={statistic}><th>{statistic}</th>{eda.numeric_columns.map((column) => <td key={column}>{formatCell(eda.numeric_summary[column]?.[statistic])}</td>)}</tr>)}</tbody></table></div> : <p className="no-columns-note">No numeric columns were detected.</p>}
        </div>
        <div className="panel profile-panel">
          <div className="panel-heading"><div><h3>Correlation matrices</h3><p>Pearson, Spearman, and Kendall rank/linear associations</p></div></div>
          {eda.numeric_columns.length > 1 ? <CorrelationTable columns={eda.numeric_columns} values={eda.correlations.pearson} /> : <p className="no-columns-note">At least two numeric variables are needed for correlation analysis.</p>}
          <p className="interpretation-note"><ShieldCheck size={14} />{eda.interpretation_note}</p>
        </div>
        <div className="eda-bottom-grid">
          <div className="panel profile-panel">
            <div className="panel-heading"><div><h3>Categorical summaries</h3><p>Unique counts and five most common observed values</p></div></div>
            {eda.categorical_columns.length ? <div className="profile-list">{eda.categorical_columns.slice(0, 12).map((column) => <div className="category-summary" key={column}><b>{column}</b><span>{eda.categorical_summary[column]?.unique ?? 0} distinct values</span><small>{eda.categorical_summary[column]?.top_values.map((item) => `${formatCell(item.value)} (${item.count})`).join(" · ")}</small></div>)}</div> : <p className="no-columns-note">No categorical variables were detected.</p>}
          </div>
          <div className="panel profile-panel">
            <div className="panel-heading"><div><h3>Potential class balance</h3><p>Counts for categorical columns with at most 20 levels</p></div></div>
            {Object.keys(eda.class_balance).length ? <div className="profile-list">{Object.entries(eda.class_balance).slice(0, 6).map(([column, values]) => {
              const total = values.reduce((sum, item) => sum + item.count, 0);
              return <div className="balance-group" key={column}><b>{column}</b>{values.slice(0, 6).map((item) => <div className="balance-row" key={String(item.value)}><span>{formatCell(item.value)}</span><i><em style={{ width: `${total ? item.count / total * 100 : 0}%` }} /></i><small>{item.count}</small></div>)}</div>;
            })}</div> : <p className="no-columns-note">No low-cardinality categorical columns to summarize.</p>}
          </div>
        </div>
        <div className="interpretation-note standalone-note"><ShieldCheck size={14} />Descriptive summaries are exploratory. They do not establish statistical significance or causal effects.</div>
      </>}
    </>
  );
}

function CorrelationTable({ columns, values }: { columns: string[]; values: Record<string, Record<string, number | null>> | undefined }) {
  return <div className="table-wrap"><table className="correlation-table"><thead><tr><th>Variable</th>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{columns.map((row) => <tr key={row}><th>{row}</th>{columns.map((column) => {
    const value = values?.[row]?.[column] ?? null;
    return <td key={column} style={typeof value === "number" ? { backgroundColor: `rgba(101, 144, 240, ${Math.abs(value) * 0.24})` } : undefined}>{typeof value === "number" ? value.toFixed(3) : "—"}</td>;
  })}</tr>)}</tbody></table></div>;
}

function ReportsPage({ dataset }: { dataset: Dataset | null }) {
  return (
    <>
      <PageHeading kicker="REPORTS & EXPORTS" title="Research reports" description="Download the reports that are implemented for your selected dataset." />
      {dataset && (dataset.kind === "table" || dataset.kind === "sqlite-table") ? <div className="report-grid">
        <div className="panel report-card"><div className="report-icon"><ShieldCheck size={19} /></div><h3>Data Quality Report</h3><p>Dataset dimensions, type profile, missing values, duplicates, IQR outlier screening, validation notes, and memory estimate.</p><div className="report-actions"><a href={`/api/datasets/${dataset.id}/quality-report.html${dataset.table_name ? `?table=${encodeURIComponent(dataset.table_name)}` : ""}`} className="outline-button"><FileDown size={14} /> HTML report</a><a href={`/api/datasets/${dataset.id}/quality-report${dataset.table_name ? `?table=${encodeURIComponent(dataset.table_name)}` : ""}`} className="outline-button"><FileDown size={14} /> JSON data</a></div></div>
        <div className="panel report-card pending-report"><div className="report-icon subdued"><Files size={19} /></div><h3>Analysis and model reports</h3><p>EDA narrative, inferential statistics, model comparisons, executive summaries, and PDF/Word exports are not implemented yet.</p><span className="pending-tag">PLANNED</span></div>
      </div> : <div className="empty-state"><div className="empty-icon large"><Files size={23} /></div><h2>Select a tabular dataset</h2><p>Choose a tabular dataset in Data Management to download its generated data-quality report.</p></div>}
    </>
  );
}

function SettingsPage({
  dark, onThemeChange, testSplit, onTestSplitChange, cvFolds, onCvFoldsChange, randomSeed, onRandomSeedChange, openKey,
}: {
  dark: boolean;
  onThemeChange: (dark: boolean) => void;
  testSplit: string;
  onTestSplitChange: (value: string) => void;
  cvFolds: string;
  onCvFoldsChange: (value: string) => void;
  randomSeed: string;
  onRandomSeedChange: (value: string) => void;
  openKey: () => void;
}) {
  const [language, setLanguage] = useState(() => localStorage.getItem("data-studio-language") ?? "en");
  const [reportFormat, setReportFormat] = useState(() => localStorage.getItem("data-studio-report-format") ?? "html");
  const [optimizer, setOptimizer] = useState(() => localStorage.getItem("data-studio-optimizer") ?? "adam");
  const [learningRate, setLearningRate] = useState(() => localStorage.getItem("data-studio-learning-rate") ?? "0.001");
  const [batchSize, setBatchSize] = useState(() => localStorage.getItem("data-studio-batch-size") ?? "32");
  const [epochs, setEpochs] = useState(() => localStorage.getItem("data-studio-epochs") ?? "50");
  const [tuningEnabled, setTuningEnabled] = useState(() => localStorage.getItem("data-studio-tuning") === "true");
  return (
    <>
      <PageHeading kicker="PREFERENCES" title="Settings" description="Configure your local workspace and analysis defaults." />
      <div className="settings-grid">
        <section className="panel settings-panel"><h3>Appearance & language</h3><p>These preferences are stored in this browser, not with your API key.</p><label className="setting-row"><span><b>Theme</b><small>Choose your workspace appearance</small></span><select value={dark ? "dark" : "light"} onChange={(event) => onThemeChange(event.target.value === "dark")}><option value="dark">Dark</option><option value="light">Light</option></select></label><label className="setting-row"><span><b>Language</b><small>Interface language</small></span><select value={language} onChange={(event) => { setLanguage(event.target.value); localStorage.setItem("data-studio-language", event.target.value); }}><option value="en">English</option><option value="sw">Kiswahili (preferences only)</option></select></label></section>
        <section className="panel settings-panel"><h3>Analysis defaults</h3><p>Saved defaults for model workflows; model training is not available yet.</p><label className="setting-row"><span><b>Test split</b><small>Fraction reserved for evaluation</small></span><select value={testSplit} onChange={(event) => onTestSplitChange(event.target.value)}><option value="0.1">10%</option><option value="0.2">20%</option><option value="0.25">25%</option><option value="0.3">30%</option></select></label><label className="setting-row"><span><b>Cross-validation folds</b><small>Default fold count</small></span><select value={cvFolds} onChange={(event) => onCvFoldsChange(event.target.value)}>{["3", "5", "10"].map((folds) => <option key={folds} value={folds}>{folds} folds</option>)}</select></label><label className="setting-row"><span><b>Random seed</b><small>Reproducibility default</small></span><input type="number" value={randomSeed} onChange={(event) => onRandomSeedChange(event.target.value)} /></label></section>
        <section className="panel settings-panel"><h3>Deep learning defaults</h3><p>Saved preferences only; model training and hyperparameter tuning are not implemented yet.</p><label className="setting-row"><span><b>Optimizer</b><small>Preferred optimizer</small></span><select value={optimizer} onChange={(event) => { setOptimizer(event.target.value); localStorage.setItem("data-studio-optimizer", event.target.value); }}><option value="adam">Adam</option><option value="sgd">SGD</option><option value="rmsprop">RMSprop</option></select></label><label className="setting-row"><span><b>Learning rate</b><small>Default optimizer learning rate</small></span><input type="number" min="0.000001" max="1" step="0.0001" value={learningRate} onChange={(event) => { setLearningRate(event.target.value); localStorage.setItem("data-studio-learning-rate", event.target.value); }} /></label><label className="setting-row"><span><b>Batch size</b><small>Preferred training batch</small></span><select value={batchSize} onChange={(event) => { setBatchSize(event.target.value); localStorage.setItem("data-studio-batch-size", event.target.value); }}>{["16", "32", "64", "128"].map((size) => <option key={size} value={size}>{size}</option>)}</select></label><label className="setting-row"><span><b>Epochs</b><small>Maximum training epochs</small></span><input type="number" min="1" max="10000" value={epochs} onChange={(event) => { setEpochs(event.target.value); localStorage.setItem("data-studio-epochs", event.target.value); }} /></label><label className="setting-row"><span><b>Hyperparameter tuning</b><small>Optuna/KerasTuner are not wired up</small></span><input type="checkbox" checked={tuningEnabled} onChange={(event) => { setTuningEnabled(event.target.checked); localStorage.setItem("data-studio-tuning", String(event.target.checked)); }} /></label></section>
        <section className="panel settings-panel"><h3>Export & integrations</h3><p>Only implemented report formats are offered as available.</p><label className="setting-row"><span><b>Default report format</b><small>Data quality reports can be exported as HTML or JSON</small></span><select value={reportFormat} onChange={(event) => { setReportFormat(event.target.value); localStorage.setItem("data-studio-report-format", event.target.value); }}><option value="html">HTML</option><option value="json">JSON</option></select></label><button className="outline-button" onClick={openKey}><LockKeyhole size={15} /> Manage OpenAI API key</button></section>
      </div>
    </>
  );
}

function PlannedModule({ name }: { name: string }) {
  return (
    <>
      <PageHeading kicker="ANALYSIS MODULE" title={name} description="This module is included in the workspace navigation." />
      <div className="panel planned-module"><div className="planned-icon"><Settings2 size={19} /></div><span className="pending-tag">PLANNED — NOT RUNNING</span><h2>{name} workflows are not available yet</h2><p>This screen does not simulate analysis. The current working features are local data upload and profiling, downloadable quality reports, descriptive EDA summaries, correlation matrices, and OpenAI-assisted discussion of dataset metadata.</p><div className="planned-divider" /><p>Model training, statistical tests, interactive chart generation, GIS, and isolated Python/R execution require dedicated runtime and dependency work before they can be offered safely.</p></div>
    </>
  );
}

function AIAnalyst({
  dataset, prompt, setPrompt, answer, busy, apiKeyReady, onAsk, onConnect,
}: {
  dataset: Dataset | null;
  prompt: string;
  setPrompt: (value: string) => void;
  answer: string;
  busy: boolean;
  apiKeyReady: boolean;
  onAsk: (question?: string) => void;
  onConnect: () => void;
}) {
  return (
    <>
      <PageHeading kicker="AI DATA ANALYST" title="Think through your data." description="Ask a research question, explore methods, and get an evidence-aware starting point." action={apiKeyReady ? <span className="connected-label"><span /> OpenAI connected for this tab</span> : <button className="outline-button" onClick={onConnect}><LockKeyhole size={15} /> Add API key</button>} />
      <div className="analyst-layout">
        <div className="panel chat-panel">
          <div className="chat-header"><div className="assistant-avatar"><Sparkles size={16} /></div><div><b>Data analyst</b><small>Answers based on your dataset profile</small></div><span className="secure-label"><LockKeyhole size={12} /> Private</span></div>
          <div className="chat-body">
            {!answer && !busy ? <div className="chat-welcome"><div className="welcome-spark"><Sparkles size={21} /></div><h2>Let’s make sense of<br />your dataset.</h2><p>{dataset ? <>I can see <b>{dataset.name}</b> — {dataset.rows.toLocaleString()} rows and {dataset.columns} columns. Ask a question to get started.</> : "Upload a dataset for tailored recommendations, or ask a general research question."}</p><div className="prompt-chips">{starterPrompts.map((item) => <button key={item} onClick={() => { setPrompt(item); onAsk(item); }}>{item}<ArrowRight size={13} /></button>)}</div></div> : (
              <div className="conversation">
                {prompt && <div className="user-message"><div>{prompt}</div></div>}
                {busy ? <div className="assistant-message"><div className="typing"><i /><i /><i /></div><span>Thinking through your question…</span></div> : answer ? <div className="assistant-message"><div className="assistant-avatar small"><Sparkles size={13} /></div><div className="answer-copy">{answer.split("\n").map((line, index) => line ? <p key={index}>{line}</p> : <br key={index} />)}<div className="evidence-note"><ShieldCheck size={13} /> Suggestions are not a substitute for validating assumptions against your full data.</div></div></div> : null}
              </div>
            )}
          </div>
          <form className="composer" onSubmit={(event) => { event.preventDefault(); onAsk(); }}>
            <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Ask a question about your data…" rows={2} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); onAsk(); } }} />
            <div className="composer-bottom"><span><Paperclip size={13} />{dataset ? `Context: ${dataset.name}` : "No dataset selected"}</span><button className="send-button" type="submit" disabled={busy || !prompt.trim()} aria-label="Send question"><Send size={15} /></button></div>
          </form>
          <p className="ai-disclaimer">AI responses can be wrong. Review methods and results before drawing conclusions.</p>
        </div>
        <aside className="analyst-aside">
          <div className="panel context-card"><div className="aside-title"><span className="aside-icon"><Database size={15} /></span><h3>Data context</h3></div>{dataset ? <><p className="context-name">{dataset.name}</p><div className="context-metrics"><div><b>{dataset.rows.toLocaleString()}</b><small>rows</small></div><div><b>{dataset.columns}</b><small>columns</small></div><div><b>{Object.keys(dataset.missing).filter((key) => dataset.missing[key] > 0).length}</b><small>columns with missing</small></div></div><div className="context-columns"><span>AVAILABLE VARIABLES</span>{dataset.column_names.slice(0, 8).map((name) => <i key={name}>{name}<small>{dataset.types[name]}</small></i>)}{dataset.column_names.length > 8 && <small>+ {dataset.column_names.length - 8} more</small>}</div></> : <p className="context-empty">Select a dataset in the Data Library to include its profile in your questions.</p>}</div>
          <div className="panel privacy-card"><div className="aside-title"><span className="aside-icon green"><ShieldCheck size={15} /></span><h3>Privacy by design</h3></div><p>Your dataset rows and raw values are not sent to OpenAI. Only column names, data types, row counts, and quality summaries are included as context.</p><div className="privacy-check"><Check size={13} /> API key held in tab memory</div><div className="privacy-check"><Check size={13} /> Key sent only for AI requests</div><div className="privacy-check"><Check size={13} /> No dataset values shared</div></div>
        </aside>
      </div>
    </>
  );
}

function EmptyState({ icon, title, body, action, onClick }: { icon: React.ReactNode; title: string; body: string; action: string; onClick: () => void }) {
  return <div className="empty-state"><div className="empty-icon large">{icon}</div><h2>{title}</h2><p>{body}</p><button className="primary-button" onClick={onClick}><Upload size={16} />{action}</button></div>;
}

function RowsIcon() {
  return <FileSpreadsheet size={17} />;
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
