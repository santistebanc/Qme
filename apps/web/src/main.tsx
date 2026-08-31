import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { codeToHtml } from "shiki";
import commandJobSource from "../../../examples/node-scraper/src/command-job.ts?raw";
import dependencyFlowSource from "../../../examples/node-scraper/src/dependency-flow.recipe.ts?raw";
import dynamicParentSource from "../../../examples/node-scraper/src/dynamic-parent-job.ts?raw";
import flakyJobSource from "../../../examples/node-scraper/src/flaky-job.ts?raw";
import longJobSource from "../../../examples/node-scraper/src/long-job.ts?raw";
import quickJobSource from "../../../examples/node-scraper/src/quick-job.ts?raw";
import rateLimitedSource from "../../../examples/node-scraper/src/rate-limited.recipe.ts?raw";
import scrapeJobSource from "../../../examples/node-scraper/src/scrape-job.ts?raw";
import {
  Boxes,
  Ban,
  BookOpen,
  Database,
  Gauge,
  GitBranch,
  ListChecks,
  Pause,
  Play,
  Radio,
  RefreshCw,
  RotateCcw,
  Send,
  Settings,
  Terminal,
  X
} from "lucide-react";
import "./styles.css";

interface Job {
  id: string;
  queue: string;
  flowId: string | null;
  dedupeKey: string | null;
  dedupeScope: string | null;
  rateLimitBuckets: string[];
  state: string;
  priority: number;
  payload: { type: string; script: string; args?: string[]; cwd?: string; originApp?: string };
  retryPolicy: { attempts: number; backoff: string; delayMs: number };
  progressPercent: number | null;
  progressMeta: unknown;
  resultMeta: unknown;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

interface Flow {
  id: string;
  name: string | null;
  state: string;
  originApp: string | null;
  completionPolicy: string;
  failurePolicy: string;
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  activeJobs: number;
  waitingJobs: number;
}

interface Queue {
  name: string;
  state: string;
  maxConcurrency: number;
  depth: number;
  active: number;
}

interface RateLimitBucket {
  name: string;
  max: number;
  durationMs: number;
  used: number;
  windowStartedAt: string | null;
}

type View = "work" | "examples" | "flows" | "queues" | "jobs" | "rateLimits" | "store" | "library" | "settings";

interface ExampleResult {
  title: string;
  jobIds: string[];
  flowId?: string;
  commandId?: string;
}

interface ScriptSource {
  path: string;
  language: string;
  code: string;
}

const api = "/api/v1";
const isStaticDemo = location.hostname.endsWith("github.io");

function App() {
  const [view, setView] = useState<View>(initialView());
  const [jobs, setJobs] = useState<Job[]>([]);
  const [queues, setQueues] = useState<Queue[]>([]);
  const [flows, setFlows] = useState<Flow[]>([]);
  const [buckets, setBuckets] = useState<RateLimitBucket[]>([]);
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [metrics, setMetrics] = useState<Record<string, number>>({});
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [logs, setLogs] = useState<Array<{ stream: string; line: string; createdAt: string }>>([]);
  const [commands, setCommands] = useState<Array<{ id: string; state: string; payload: unknown; createdAt: string }>>([]);
  const [scriptSource, setScriptSource] = useState<ScriptSource | null>(null);
  const [exampleSource, setExampleSource] = useState<ScriptSource | null>(null);
  const [connected, setConnected] = useState(false);
  const [priorityDraft, setPriorityDraft] = useState("100");
  const [commandDraft, setCommandDraft] = useState('{"instruction":"continue"}');
  const [runningExample, setRunningExample] = useState<string | null>(null);
  const [selectedExampleId, setSelectedExampleId] = useState("quick");
  const [exampleResult, setExampleResult] = useState<ExampleResult | null>(null);
  const [exampleError, setExampleError] = useState<string | null>(null);

  const refresh = async () => {
    let nextJobs: Job[];
    let nextQueues: Queue[];
    let nextFlows: Flow[];
    let nextBuckets: RateLimitBucket[];
    let nextHealth: Record<string, unknown>;
    let nextMetrics: Record<string, number>;

    try {
      [nextJobs, nextQueues, nextFlows, nextBuckets, nextHealth, nextMetrics] = await Promise.all([
        getJson<Job[]>("/jobs"),
        getJson<Queue[]>("/queues"),
        getJson<Flow[]>("/flows"),
        getJson<RateLimitBucket[]>("/rate-limit-buckets"),
        getJson<Record<string, unknown>>("/health"),
        getJson<Record<string, number>>("/metrics")
      ]);
    } catch (error) {
      if (!isStaticDemo) throw error;
      nextJobs = demoJobs;
      nextQueues = demoQueues;
      nextFlows = demoFlows;
      nextBuckets = demoBuckets;
      nextHealth = demoHealth;
      nextMetrics = demoMetrics;
      setConnected(false);
    }

    setJobs(nextJobs);
    setQueues(nextQueues);
    setFlows(nextFlows);
    setBuckets(nextBuckets);
    setHealth(nextHealth);
    setMetrics(nextMetrics);
    setSelectedJob((current) => nextJobs.find((job) => job.id === current?.id) ?? current);
  };

  const post = async (path: string, body?: unknown) => {
    if (isStaticDemo) return;
    await request("POST", path, body);
    await refresh();
  };

  const runExample = async (example: ExampleDefinition) => {
    setSelectedExampleId(example.id);
    setRunningExample(example.id);
    setExampleError(null);
    try {
      if (isStaticDemo) {
        const job = demoJobForExample(example);
        setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
        setSelectedJob(job);
        setExampleResult({ title: example.title, jobIds: [job.id], flowId: job.flowId ?? undefined });
        return;
      }
      const result = await example.run(String(health?.workspaceRoot ?? ""));
      setExampleResult(result);
      await refresh();
      if (result.jobIds.length > 0) {
        const job = await getJson<Job>(`/jobs/${encodeURIComponent(result.jobIds[0])}`);
        setSelectedJob(job);
      }
    } catch (error) {
      setExampleError(error instanceof Error ? error.message : String(error));
    } finally {
      setRunningExample(null);
    }
  };

  const request = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${api}${path}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    if (!response.ok) throw new Error(await response.text());
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  };

  useEffect(() => {
    void refresh();
    if (isStaticDemo) return;
    const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${api}/events`);
    socket.addEventListener("open", () => setConnected(true));
    socket.addEventListener("close", () => setConnected(false));
    socket.addEventListener("message", () => void refresh());
    return () => socket.close();
  }, []);

  useEffect(() => {
    if (!selectedJob) {
      setScriptSource(null);
      return;
    }
    if (isStaticDemo) {
      setLogs(demoLogs[selectedJob.id] ?? []);
      setCommands(demoCommands[selectedJob.id] ?? []);
      setScriptSource(demoSourceFor(selectedJob.payload.script));
      return;
    }
    fetch(`${api}/jobs/${encodeURIComponent(selectedJob.id)}/logs`)
      .then((r) => r.json())
      .then(setLogs)
      .catch(() => setLogs([]));
    fetch(`${api}/jobs/${encodeURIComponent(selectedJob.id)}/commands`)
      .then((r) => r.json())
      .then(setCommands)
      .catch(() => setCommands([]));
    fetch(`${api}/jobs/${encodeURIComponent(selectedJob.id)}/script`)
      .then((r) => r.json())
      .then(setScriptSource)
      .catch(() => setScriptSource(null));
  }, [selectedJob, jobs]);

  const showExampleCode = async (example: ExampleDefinition) => {
    setSelectedExampleId(example.id);
    setExampleError(null);
    try {
      if (isStaticDemo) {
        setExampleSource(demoSourceFor(example.script));
        return;
      }
      const workspaceRoot = String(health?.workspaceRoot ?? "");
      if (!workspaceRoot) throw new Error("Qme health has not reported a workspace root yet. Refresh and try again.");
      const cwd = exampleCwd(workspaceRoot);
      const source = await getJson<ScriptSource>(`/scripts/source?script=${encodeURIComponent(example.script)}&cwd=${encodeURIComponent(cwd)}`);
      setExampleSource(source);
    } catch (error) {
      setExampleError(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    if (view !== "examples" || exampleSource || !health?.workspaceRoot) return;
    const selected = examples.find((example) => example.id === selectedExampleId) ?? examples[0];
    void showExampleCode(selected);
  }, [view, exampleSource, health, selectedExampleId]);

  const selectExample = (example: ExampleDefinition) => {
    setSelectedJob(null);
    setSelectedExampleId(example.id);
    void showExampleCode(example);
  };

  const changeView = (nextView: View) => {
    setView(nextView);
    const url = new URL(location.href);
    if (nextView === "work") {
      url.searchParams.delete("view");
    } else {
      url.searchParams.set("view", nextView);
    }
    history.replaceState(null, "", url);
  };

  const title = viewTitles[view];
  const selectedExample = examples.find((example) => example.id === selectedExampleId) ?? examples[0];
  const primaryContent =
    view === "work" ? <WorkView flows={flows} jobs={jobs} metrics={metrics} onSelectJob={setSelectedJob} /> :
    view === "examples" ? <ExamplesList selectedExampleId={selectedExampleId} onSelect={selectExample} /> :
    view === "flows" ? <FlowsView flows={flows} onPost={post} /> :
    view === "queues" ? <QueuesView queues={queues} onPost={post} /> :
    view === "jobs" ? <JobsView jobs={jobs} onSelectJob={setSelectedJob} /> :
    view === "rateLimits" ? <RateLimitsView buckets={buckets} /> :
    view === "store" ? <StoreView health={health} metrics={metrics} /> :
    view === "library" ? <LibraryDocs /> :
    <SettingsView health={health} />;

  const detailsContent = selectedJob ? (
    <JobDetails
      job={selectedJob}
      logs={logs}
      commands={commands}
      scriptSource={scriptSource}
      priorityDraft={priorityDraft}
      commandDraft={commandDraft}
      setPriorityDraft={setPriorityDraft}
      setCommandDraft={setCommandDraft}
      onClose={() => setSelectedJob(null)}
      onPost={post}
    />
  ) : view === "examples" ? (
    <ExampleInspector
      selected={selectedExample}
      runningExample={runningExample}
      result={exampleResult}
      error={exampleError}
      source={exampleSource}
      onRun={runExample}
    />
  ) : view === "library" ? (
    <LibraryReference />
  ) : (
    <HealthRail connected={connected} queues={queues} flows={flows} onPost={post} />
  );

  return (
    <main className={`appShell view-${view}`}>
      <header className="topbar">
        <div className="topbarInner">
          <div className="brand">
            <span className="brandMark">
              <Radio size={20} />
            </span>
            <span>Qme</span>
          </div>
          <nav>
            <NavButton icon={<ListChecks size={16} />} label="Work" active={view === "work"} onClick={() => changeView("work")} />
            <NavButton icon={<Play size={16} />} label="Examples" active={view === "examples"} onClick={() => changeView("examples")} />
            <NavButton icon={<GitBranch size={16} />} label="Flows" active={view === "flows"} onClick={() => changeView("flows")} />
            <NavButton icon={<Boxes size={16} />} label="Queues" active={view === "queues"} onClick={() => changeView("queues")} />
            <NavButton icon={<Terminal size={16} />} label="Jobs" active={view === "jobs"} onClick={() => changeView("jobs")} />
            <NavButton icon={<Gauge size={16} />} label="Rate Limits" active={view === "rateLimits"} onClick={() => changeView("rateLimits")} />
            <NavButton icon={<Database size={16} />} label="Store" active={view === "store"} onClick={() => changeView("store")} />
            <NavButton icon={<BookOpen size={16} />} label="Library" active={view === "library"} onClick={() => changeView("library")} />
            <NavButton icon={<Settings size={16} />} label="Settings" active={view === "settings"} onClick={() => changeView("settings")} />
          </nav>
          <button className="iconButton" onClick={() => void refresh()} title="Refresh" aria-label="Refresh">
            <RefreshCw size={18} />
          </button>
        </div>
      </header>

      <section className="workspaceLayout">
        <section className="primaryPane">
          <div className="pageHeader">
          <div>
            <h1>{title.heading}</h1>
            <p>{title.copy}</p>
          </div>
          </div>
          {primaryContent}
        </section>
        <aside className={`detailsPane ${selectedJob || view === "examples" ? "hasSelection" : ""}`}>
          {detailsContent}
        </aside>
      </section>
    </main>
  );
}

interface ExampleDefinition {
  id: string;
  title: string;
  queue: string;
  script: string;
  scriptLabel?: string;
  detail: string;
  run: (workspaceRoot: string) => Promise<ExampleResult>;
}

const examples: ExampleDefinition[] = [
  {
    id: "quick",
    title: "Quick Job",
    queue: "examples",
    script: "quick-job.ts",
    detail: "Small job that reports 50 percent, completes, and writes two log lines.",
    run: async (workspaceRoot) => {
      const job = await createExampleJob(workspaceRoot, "examples", "quick-job.ts", { args: [`quick-${Date.now()}`], priority: 20 });
      return { title: "Quick Job", jobIds: [job.id] };
    }
  },
  {
    id: "scrape",
    title: "Scrape Job",
    queue: "scraping",
    script: "scrape-job.ts",
    detail: "Five simulated chunks with progress updates and an artifact protocol event.",
    run: async (workspaceRoot) => {
      const job = await createExampleJob(workspaceRoot, "scraping", "scrape-job.ts", { args: ["https://example.com"], priority: 10 });
      return { title: "Scrape Job", jobIds: [job.id] };
    }
  },
  {
    id: "flaky",
    title: "Retry Job",
    queue: "retry",
    script: "flaky-job.ts",
    detail: "Fails once, then succeeds on the second attempt through fixed backoff retry.",
    run: async (workspaceRoot) => {
      const job = await createExampleJob(workspaceRoot, "retry", "flaky-job.ts", {
        retry: { attempts: 2, backoff: "fixed", delayMs: 250 }
      });
      return { title: "Retry Job", jobIds: [job.id] };
    }
  },
  {
    id: "long",
    title: "Long Job",
    queue: "cancel",
    script: "long-job.ts",
    detail: "Thirty-second job that keeps reporting progress, useful for trying cancel.",
    run: async (workspaceRoot) => {
      const job = await createExampleJob(workspaceRoot, "cancel", "long-job.ts");
      return { title: "Long Job", jobIds: [job.id] };
    }
  },
  {
    id: "command",
    title: "Command Job",
    queue: "commands",
    script: "command-job.ts",
    detail: "Starts a job that waits for instructions, then sends it a command.",
    run: async (workspaceRoot) => {
      const job = await createExampleJob(workspaceRoot, "commands", "command-job.ts");
      const command = await apiRequest<{ id: string }>("POST", `/jobs/${encodeURIComponent(job.id)}/commands`, {
        payload: { instruction: "continue from Examples" },
        ttlMs: 5000
      });
      return { title: "Command Job", jobIds: [job.id], commandId: command.id };
    }
  },
  {
    id: "dependency-flow",
    title: "Dependency Flow",
    queue: "flow",
    script: "dependency-flow.recipe.ts",
    detail: "Creates one flow with two jobs; the second waits for the first.",
    run: async (workspaceRoot) => {
      const job = await createExampleJob(workspaceRoot, "flow", "dependency-flow.recipe.ts");
      return { title: "Dependency Flow", jobIds: [job.id] };
    }
  },
  {
    id: "rate-limited",
    title: "Rate-Limited Pair",
    queue: "limited",
    script: "rate-limited.recipe.ts",
    detail: "Creates a bucket and two jobs that must start at least about 1.5s apart.",
    run: async (workspaceRoot) => {
      const job = await createExampleJob(workspaceRoot, "limited", "rate-limited.recipe.ts");
      return { title: "Rate-Limited Pair", jobIds: [job.id] };
    }
  },
  {
    id: "dynamic-flow",
    title: "Dynamic Flow",
    queue: "dynamic",
    script: "dynamic-parent-job.ts",
    detail: "Parent job emits a protocol line that adds a child job to the same flow.",
    run: async (workspaceRoot) => {
      const flow = await apiRequest<{ flow: { id: string } }>("POST", "/flows", {
        name: "example-dynamic-flow",
        originApp: "qme-web-examples"
      });
      const parent = await createExampleJob(workspaceRoot, "dynamic", "dynamic-parent-job.ts", { flowId: flow.flow.id });
      return { title: "Dynamic Flow", flowId: flow.flow.id, jobIds: [parent.id] };
    }
  }
];

const demoSources: Record<string, ScriptSource> = {
  "quick-job.ts": { path: "examples/node-scraper/src/quick-job.ts", language: "typescript", code: quickJobSource },
  "scrape-job.ts": { path: "examples/node-scraper/src/scrape-job.ts", language: "typescript", code: scrapeJobSource },
  "flaky-job.ts": { path: "examples/node-scraper/src/flaky-job.ts", language: "typescript", code: flakyJobSource },
  "long-job.ts": { path: "examples/node-scraper/src/long-job.ts", language: "typescript", code: longJobSource },
  "command-job.ts": { path: "examples/node-scraper/src/command-job.ts", language: "typescript", code: commandJobSource },
  "dependency-flow.recipe.ts": { path: "examples/node-scraper/src/dependency-flow.recipe.ts", language: "typescript", code: dependencyFlowSource },
  "rate-limited.recipe.ts": { path: "examples/node-scraper/src/rate-limited.recipe.ts", language: "typescript", code: rateLimitedSource },
  "dynamic-parent-job.ts": { path: "examples/node-scraper/src/dynamic-parent-job.ts", language: "typescript", code: dynamicParentSource }
};

const demoNow = Date.now();
const demoQueues: Queue[] = [
  { name: "scraping", state: "active", maxConcurrency: 4, depth: 3, active: 2 },
  { name: "flow", state: "active", maxConcurrency: 4, depth: 1, active: 1 },
  { name: "limited", state: "active", maxConcurrency: 2, depth: 2, active: 0 },
  { name: "commands", state: "paused", maxConcurrency: 1, depth: 1, active: 0 },
  { name: "examples", state: "active", maxConcurrency: 4, depth: 0, active: 1 }
];
const demoFlows: Flow[] = [
  {
    id: "flow_demo_site_crawl",
    name: "example-dependency-flow",
    state: "active",
    originApp: "qme-web-examples",
    completionPolicy: "all",
    failurePolicy: "fail-flow",
    totalJobs: 3,
    completedJobs: 1,
    failedJobs: 0,
    activeJobs: 1,
    waitingJobs: 1
  },
  {
    id: "flow_demo_dynamic_research",
    name: "dynamic-research-pass",
    state: "completed",
    originApp: "embedded-qme-demo",
    completionPolicy: "all",
    failurePolicy: "continue",
    totalJobs: 4,
    completedJobs: 4,
    failedJobs: 0,
    activeJobs: 0,
    waitingJobs: 0
  }
];
const demoBuckets: RateLimitBucket[] = [
  { name: "domain:example.com", max: 2, durationMs: 1500, used: 1, windowStartedAt: ago(18_000) },
  { name: "ai:local-model", max: 3, durationMs: 5000, used: 2, windowStartedAt: ago(32_000) }
];
const demoJobs: Job[] = [
  demoJob({
    id: "job_demo_scrape_active",
    queue: "scraping",
    script: "scrape-job.ts",
    args: ["https://example.com/catalog"],
    state: "active",
    priority: 10,
    progressPercent: 60,
    rateLimitBuckets: ["domain:example.com"],
    resultMeta: {
      outputs: [{ name: "summary", value: { target: "https://example.com/catalog", chunks: 3 }, at: ago(8_000) }],
      artifacts: [{ path: "outputs/example.jsonl", meta: { format: "jsonl", target: "https://example.com/catalog" }, at: ago(6_000) }]
    }
  }),
  demoJob({
    id: "job_demo_flow_recipe",
    queue: "flow",
    script: "dependency-flow.recipe.ts",
    state: "completed",
    flowId: "flow_demo_site_crawl",
    priority: 100,
    progressPercent: 100,
    resultMeta: { outputs: [{ name: "created", value: { flowId: "flow_demo_site_crawl", jobs: ["job_demo_flow_first", "job_demo_flow_second"] } }] }
  }),
  demoJob({
    id: "job_demo_flow_second",
    queue: "flow",
    script: "quick-job.ts",
    args: ["flow-second"],
    state: "waiting",
    flowId: "flow_demo_site_crawl",
    priority: 100,
    progressPercent: 0
  }),
  demoJob({
    id: "job_demo_command",
    queue: "commands",
    script: "command-job.ts",
    state: "waiting",
    priority: 50,
    progressPercent: 0
  }),
  demoJob({
    id: "job_demo_quick_done",
    queue: "examples",
    script: "quick-job.ts",
    args: ["quick-demo"],
    state: "completed",
    priority: 20,
    progressPercent: 100,
    resultMeta: { outputs: [{ name: "summary", value: { label: "quick-demo", message: "Quick job completed" }, at: ago(90_000) }] }
  })
];
const demoMetrics = {
  waiting: 5,
  active: 3,
  completed: 18,
  failed: 1,
  canceled: 2,
  interrupted: 0,
  completedFlows: 4
};
const demoHealth: Record<string, unknown> = {
  version: "0.1.0",
  store: ".qme/qme.sqlite",
  discovery: ".qme/discovery.json",
  workspaceRoot: "/demo/qme",
  mode: "GitHub Pages static demo"
};
const demoLogs: Record<string, Array<{ stream: string; line: string; createdAt: string }>> = {
  job_demo_scrape_active: [
    { stream: "stdout", line: "Starting scrape for https://example.com/catalog", createdAt: ago(42_000) },
    { stream: "stdout", line: "Fetched page chunk 1", createdAt: ago(35_000) },
    { stream: "stdout", line: "Fetched page chunk 2", createdAt: ago(29_000) },
    { stream: "stdout", line: "Fetched page chunk 3", createdAt: ago(20_000) }
  ],
  job_demo_command: [{ stream: "stdout", line: "command-job waiting", createdAt: ago(26_000) }],
  job_demo_quick_done: [
    { stream: "stdout", line: "quick-job quick-demo started", createdAt: ago(96_000) },
    { stream: "stdout", line: "quick-job quick-demo done", createdAt: ago(90_000) }
  ],
  job_demo_flow_recipe: [
    { stream: "stdout", line: "Creating dependency flow", createdAt: ago(75_000) },
    { stream: "stdout", line: "Created dependency flow flow_demo_site_crawl", createdAt: ago(69_000) }
  ]
};
const demoCommands: Record<string, Array<{ id: string; state: string; payload: unknown; createdAt: string }>> = {
  job_demo_command: [
    { id: "cmd_demo_continue", state: "queued", payload: { instruction: "continue from dashboard" }, createdAt: ago(12_000) }
  ]
};

function demoSourceFor(script: string): ScriptSource | null {
  return demoSources[basename(script)] ?? null;
}

function demoJobForExample(example: ExampleDefinition): Job {
  return demoJobs.find((job) => basename(job.payload.script) === example.script) ?? demoJob({
    id: `job_demo_${example.id}`,
    queue: example.queue,
    script: example.script,
    state: "waiting",
    priority: 100,
    progressPercent: 0
  });
}

function demoJob(input: {
  id: string;
  queue: string;
  script: string;
  args?: string[];
  state: string;
  flowId?: string;
  priority: number;
  progressPercent: number;
  rateLimitBuckets?: string[];
  resultMeta?: unknown;
}): Job {
  return {
    id: input.id,
    queue: input.queue,
    flowId: input.flowId ?? null,
    dedupeKey: null,
    dedupeScope: null,
    rateLimitBuckets: input.rateLimitBuckets ?? [],
    state: input.state,
    priority: input.priority,
    payload: {
      type: "node",
      script: input.script,
      args: input.args ?? [],
      cwd: "/demo/qme/examples/node-scraper/src",
      originApp: "qme-pages-demo"
    },
    retryPolicy: { attempts: input.script === "flaky-job.ts" ? 2 : 1, backoff: "fixed", delayMs: input.script === "flaky-job.ts" ? 250 : 0 },
    progressPercent: input.progressPercent,
    progressMeta: null,
    resultMeta: input.resultMeta ?? null,
    failureReason: null,
    createdAt: ago(120_000),
    updatedAt: ago(10_000),
    startedAt: input.state === "waiting" ? null : ago(80_000),
    finishedAt: ["completed", "failed", "canceled"].includes(input.state) ? ago(40_000) : null
  };
}

function ExamplesList(props: {
  selectedExampleId: string;
  onSelect: (example: ExampleDefinition) => void;
}) {
  return (
    <div className="examplesList">
      {examples.map((example) => (
        <button
          className={`exampleItem ${example.id === props.selectedExampleId ? "selected" : ""}`}
          key={example.id}
          onClick={() => props.onSelect(example)}
        >
          <div className="exampleTitleRow">
            <span className="exampleIcon"><Play size={15} /></span>
            <h2>{example.title}</h2>
            <span className="miniPill">{example.queue}</span>
          </div>
          <p>{example.detail}</p>
          <div className="exampleMetaRow">
            <span>{example.scriptLabel ?? example.script}</span>
          </div>
        </button>
      ))}
    </div>
  );
}

function ExampleInspector(props: {
  selected: ExampleDefinition;
  runningExample: string | null;
  result: ExampleResult | null;
  error: string | null;
  source: ScriptSource | null;
  onRun: (example: ExampleDefinition) => void;
}) {
  return (
    <section className="details">
      <div className="detailHeader">
        <div>
          <div className="detailEyebrow">Example</div>
          <h2>{props.selected.title}</h2>
          <p>{props.selected.detail}</p>
          <div className="detailMeta">
            <span>{props.selected.queue}</span>
            <span>{props.selected.scriptLabel ?? props.selected.script}</span>
          </div>
        </div>
        <ActionGroup>
          <IconAction
            className="primary"
            disabled={props.runningExample !== null}
            icon={<Play size={15} />}
            label={props.runningExample === props.selected.id ? "Running" : "Run"}
            onClick={() => props.onRun(props.selected)}
          />
        </ActionGroup>
      </div>
      <div className="detailGrid">
        {props.error && <p className="exampleError">{props.error}</p>}
        {props.result && (
          <div className="detailBlock">
            <h3>Last Run</h3>
            {props.result.flowId && <KeyValue label="Flow" value={props.result.flowId} />}
            <KeyValue label="Jobs" value={props.result.jobIds.join(", ")} />
            {props.result.commandId && <KeyValue label="Command" value={props.result.commandId} />}
          </div>
        )}
        <CodePanel source={props.source} compact />
      </div>
    </section>
  );
}

function WorkView(props: {
  flows: Flow[];
  jobs: Job[];
  metrics: Record<string, number>;
  onSelectJob: (job: Job) => void;
}) {
  return (
    <section className="work">
      <MetricGrid metrics={props.metrics} />
      <FlowList flows={props.flows.slice(0, 5)} compact />
      <JobTable jobs={props.jobs.slice(0, 12)} onSelectJob={props.onSelectJob} />
    </section>
  );
}

function FlowsView(props: { flows: Flow[]; onPost: (path: string, body?: unknown) => Promise<void> }) {
  return <FlowList flows={props.flows} onPost={props.onPost} />;
}

function QueuesView(props: { queues: Queue[]; onPost: (path: string, body?: unknown) => Promise<void> }) {
  return (
    <section className="panel">
      <DataTable columns={["Queue", "State", "Waiting", "Active", "Concurrency", "Controls"]}>
        {props.queues.map((queue) => (
          <div className="dataRow six queueRow" key={queue.name}>
            <span className="recordMain">
              <strong>{queue.name}</strong>
              <span>{queue.depth} waiting - {queue.active} active</span>
            </span>
            <span><Status state={queue.state} /></span>
            <span className="rowStat" data-label="Waiting">{queue.depth}</span>
            <span className="rowStat" data-label="Active">{queue.active}</span>
            <span className="rowStat" data-label="Concurrency">{queue.maxConcurrency}</span>
            <ActionGroup>
              <IconAction
                icon={queue.state === "paused" ? <Play size={14} /> : <Pause size={14} />}
                label={queue.state === "paused" ? "Resume" : "Pause"}
                active={queue.state === "paused"}
                onClick={() => void props.onPost(`/queues/${encodeURIComponent(queue.name)}/${queue.state === "paused" ? "resume" : "pause"}`)}
              />
            </ActionGroup>
          </div>
        ))}
      </DataTable>
    </section>
  );
}

function JobsView(props: { jobs: Job[]; onSelectJob: (job: Job) => void }) {
  return (
    <section className="panel">
      <JobTable jobs={props.jobs} onSelectJob={props.onSelectJob} />
    </section>
  );
}

function RateLimitsView(props: { buckets: RateLimitBucket[] }) {
  return (
    <section className="panel">
      <DataTable columns={["Bucket", "Window", "Used", "Started"]}>
        {props.buckets.map((bucket) => (
          <div className="dataRow four" key={bucket.name}>
            <span>{bucket.name}</span>
            <span>{bucket.max} per {bucket.durationMs}ms</span>
            <span>{bucket.used}</span>
            <span>{formatDate(bucket.windowStartedAt)}</span>
          </div>
        ))}
      </DataTable>
    </section>
  );
}

function StoreView(props: { health: Record<string, unknown> | null; metrics: Record<string, number> }) {
  return (
    <section className="panel split">
      <div>
        <h2>SQLite Store</h2>
        <KeyValue label="Database" value={String(props.health?.store ?? "unknown")} />
        <KeyValue label="Discovery" value={String(props.health?.discovery ?? "unknown")} />
        <KeyValue label="API version" value={String(props.health?.version ?? "unknown")} />
      </div>
      <div>
        <h2>Stored Work</h2>
        <KeyValue label="Completed jobs" value={String(props.metrics.completed ?? 0)} />
        <KeyValue label="Canceled jobs" value={String(props.metrics.canceled ?? 0)} />
        <KeyValue label="Interrupted jobs" value={String(props.metrics.interrupted ?? 0)} />
        <KeyValue label="Completed flows" value={String(props.metrics.completedFlows ?? 0)} />
      </div>
    </section>
  );
}

const librarySnippets: Array<{ title: string; eyebrow: string; copy: string; code: string }> = [
  {
    eyebrow: "Core",
    title: "Embed Qme In Your App",
    copy: "Create one local runtime, choose the SQLite location, and let the app own workers directly.",
    code: `import { Qme } from "qme";

const qme = new Qme({
  db: ".qme/qme.sqlite",
  workspaceRoots: [process.cwd()],
  pollMs: 500
});`
  },
  {
    eyebrow: "Handlers",
    title: "Queue Inline TypeScript Work",
    copy: "Use handlers when the job belongs inside the host app and you want typed data, progress, outputs, and cancellation.",
    code: `await qme.add(
  "scraping",
  "scrape-page",
  async ({ data, progress, output, artifact, signal }) => {
    const { url } = data as { url: string };

    progress(25, { url });
    await crawlPage(url, { signal });
    output("url", url);
    artifact("runs/latest/page.json", { url });

    return { ok: true };
  },
  {
    data: { url: "https://example.com" },
    originApp: "my-scraper",
    retry: qme.retry.exponential({ attempts: 3, delayMs: 1000 })
  }
);`
  },
  {
    eyebrow: "Scripts",
    title: "Queue Script Files",
    copy: "Use script jobs when work should run as a separate Node, Python, or shell process.",
    code: `const job = await qme.jobs.create("scraping", {
  payload: qme.scripts.node("jobs/scrape.ts", {
    args: ["https://example.com"],
    cwd: process.cwd(),
    originApp: "my-node-app"
  }),
  priority: 10,
  rateLimitBuckets: ["domain:example.com"]
});`
  },
  {
    eyebrow: "Flows",
    title: "Group Dependent Work",
    copy: "Create a flow when several jobs are one logical run and need shared progress, pause, resume, or cancellation.",
    code: `const { flow } = await qme.flows.create({
  name: "crawl-site",
  originApp: "my-scraper"
});

const index = await qme.jobs.create("scraping", {
  flowId: flow.id,
  payload: qme.scripts.node("jobs/index-page.ts")
});

const details = await qme.jobs.create("scraping", {
  flowId: flow.id,
  dependsOn: [index.id],
  payload: qme.scripts.node("jobs/detail-pages.ts")
});`
  },
  {
    eyebrow: "Dashboard",
    title: "Expose The Optional Dashboard",
    copy: "Keep Qme embedded, then attach the HTTP API and web UI when you want another process or browser to monitor it.",
    code: `import { Qme, createApp } from "qme";

const qme = new Qme({
  db: ".qme/qme.sqlite",
  workspaceRoots: [process.cwd()]
});

const app = await createApp({
  qme,
  paths: qme.paths,
  port: 47321,
  workspaceRoot: process.cwd()
});

await app.listen({ host: "127.0.0.1", port: 47321 });`
  },
  {
    eyebrow: "Scripts",
    title: "Report From A Script Job",
    copy: "Script files call Qme.fromEnv so they can read args, report progress, emit outputs, and receive commands.",
    code: `import { Qme } from "qme";

const qme = Qme.fromEnv();

const url = qme.args.require(0, "url");

qme.job.log(\`Scraping \${url}\`);
qme.job.progress(10, { url });

const command = await qme.commands.next({ timeoutMs: qme.seconds(10) });
if (!command) qme.job.fail("No command received", { url });

await qme.commands.ack(command.id);
qme.job.output("url", url);`
  }
];

function LibraryDocs() {
  return (
    <section className="libraryDocs">
      <div className="panel libraryIntro">
        <div>
          <h2>Library-First Runtime</h2>
          <p>Import one package, create one Qme object, then use the same nouns for jobs, queues, flows, rate limits, commands, and script reporting.</p>
        </div>
        <div className="libraryPackageGrid">
          <span><strong>new Qme()</strong> own the runtime</span>
          <span><strong>Qme.connect()</strong> use a running runtime</span>
          <span><strong>Qme.fromEnv()</strong> run inside a script job</span>
        </div>
      </div>
      <div className="docsGrid">
        {librarySnippets.map((snippet) => (
          <article className="panel docsCard" key={snippet.title}>
            <div className="docsCardText">
              <div className="detailEyebrow">{snippet.eyebrow}</div>
              <h2>{snippet.title}</h2>
              <p>{snippet.copy}</p>
            </div>
            <SnippetPanel title={snippet.eyebrow} code={snippet.code} />
          </article>
        ))}
      </div>
    </section>
  );
}

function LibraryReference() {
  const modes = [
    ["new Qme(options)", "Own SQLite, queues, workers, handlers, and events."],
    ["Qme.connect(options)", "Talk to an already running trusted local runtime."],
    ["Qme.fromEnv(options)", "Discover job id, API URL, and args inside a launched script."]
  ] as const;
  const methods = [
    ["import { Qme } from \"qme\"", "The only public import most code should need."],
    ["qme.add(queue, name, handler, options)", "Register and enqueue an inline handler job."],
    ["qme.jobs", "create, list, get, logs, commands, cancel, retry, setPriority."],
    ["qme.queues", "list, pause, resume."],
    ["qme.flows", "create, list, get, jobs, pause, resume, cancel."],
    ["qme.rateLimitBuckets", "list and upsert shared throttling buckets."],
    ["qme.commands", "send commands to jobs and ack them from scripts."]
  ] as const;

  return (
    <aside className="rail libraryRail">
      <div className="railHeader">
        <div>
          <div className="detailEyebrow">Library</div>
          <h2>API Reference</h2>
          <p>The compact map for deciding which package and surface to reach for.</p>
        </div>
        <BookOpen size={20} />
      </div>
      <div className="detailStats">
        <Metric label="Package" value="1" />
        <Metric label="Runtime" value="SQLite" />
        <Metric label="Modes" value="3" />
        <Metric label="Mode" value="Local" />
      </div>
      <div className="detailBlock">
        <h3>Construction</h3>
        {modes.map(([name, description]) => (
          <KeyValue key={name} label={name} value={description} />
        ))}
      </div>
      <div className="detailBlock">
        <h3>Main Surface</h3>
        {methods.map(([name, description]) => (
          <KeyValue key={name} label={name} value={description} />
        ))}
      </div>
      <div className="detailBlock">
        <h3>Options</h3>
        <div className="tokenList">
          {["db", "home", "scriptsDir", "workspaceRoots", "apiUrl", "pollMs", "startWorkers"].map((item) => (
            <code key={item}>{item}</code>
          ))}
        </div>
      </div>
      <div className="detailBlock">
        <h3>When To Use What</h3>
        <p className="emptyText">Use a job for one unit of work, a queue for an execution lane, a flow for a related multi-job run, and a rate limit bucket when starts must be throttled across jobs.</p>
      </div>
    </aside>
  );
}

function SnippetPanel(props: { title: string; code: string }) {
  return (
    <CodePanel
      compact
      source={{
        path: props.title,
        language: "typescript",
        code: props.code
      }}
    />
  );
}

function SettingsView(props: { health: Record<string, unknown> | null }) {
  return (
    <section className="panel split">
      <div>
        <h2>Runtime</h2>
        <KeyValue label="Bind address" value="127.0.0.1" />
        <KeyValue label="API" value={String(props.health ? "online" : "checking")} />
        <KeyValue label="Scripts" value="Trusted local workspace" />
      </div>
      <div>
        <h2>Planned Controls</h2>
        <KeyValue label="Workspace roots" value="Environment configured" />
        <KeyValue label="Runtime config" value="System PATH" />
        <KeyValue label="Retention" value="Default TTL cleanup" />
      </div>
    </section>
  );
}

function HealthRail(props: { connected: boolean; queues: Queue[]; flows: Flow[]; onPost: (path: string, body?: unknown) => Promise<void> }) {
  const activeJobs = props.queues.reduce((total, queue) => total + queue.active, 0);
  const waitingJobs = props.queues.reduce((total, queue) => total + queue.depth, 0);

  return (
    <aside className="rail">
      <div className="railHeader">
        <div>
          <div className="detailEyebrow">Runtime</div>
          <h2>Health</h2>
          <p>Live execution state across the local hub.</p>
        </div>
        <Status state={props.connected ? "live" : "offline"} />
      </div>
      <div className="detailStats">
        <Metric label="Queues" value={props.queues.length} />
        <Metric label="Flows" value={props.flows.length} />
        <Metric label="Active" value={activeJobs} />
        <Metric label="Waiting" value={waitingJobs} />
      </div>
      <div className="detailBlock">
        <h3>Queues</h3>
        {props.queues.length === 0 ? (
          <p className="emptyText">No queues have been created yet.</p>
        ) : props.queues.map((queue) => (
          <div className="queue" key={queue.name}>
            <div className="recordMain">
              <strong>{queue.name}</strong>
              <span>{queue.state} - {queue.active} active, {queue.depth} waiting</span>
            </div>
            <ActionGroup>
              <IconAction
                icon={queue.state === "paused" ? <Play size={14} /> : <Pause size={14} />}
                label={queue.state === "paused" ? "Resume" : "Pause"}
                active={queue.state === "paused"}
                onClick={() => void props.onPost(`/queues/${encodeURIComponent(queue.name)}/${queue.state === "paused" ? "resume" : "pause"}`)}
              />
            </ActionGroup>
          </div>
        ))}
      </div>
    </aside>
  );
}

function MetricGrid(props: { metrics: Record<string, number> }) {
  const items = [
    ["Waiting", props.metrics.waiting ?? 0],
    ["Active", props.metrics.active ?? 0],
    ["Completed", props.metrics.completed ?? 0],
    ["Failed", props.metrics.failed ?? 0]
  ] as const;
  return (
    <div className="summary">
      {items.map(([label, value]) => <Metric key={label} label={label} value={value} />)}
    </div>
  );
}

function FlowList(props: { flows: Flow[]; compact?: boolean; onPost?: (path: string, body?: unknown) => Promise<void> }) {
  const onPost = props.onPost;
  if (props.flows.length === 0) {
    return <div className="panel"><h2>Flows</h2><p>No flows yet.</p></div>;
  }
  return (
    <div className="panel">
      <h2>Flows</h2>
      {props.flows.map((flow) => (
        <div className={`flow ${props.compact ? "compact" : ""}`} key={flow.id}>
          <div className="recordMain">
            <span className="recordTitleRow">
              <strong>{flow.name ?? flow.id}</strong>
              <Status state={flow.state} />
            </span>
            <span>{flow.originApp ?? "local"} - {flow.completionPolicy}/{flow.failurePolicy}</span>
          </div>
          <div className="flowProgress">
            <div className="progressTrack" aria-label={`${flow.completedJobs} of ${flow.totalJobs} jobs completed`}>
              <span style={{ width: `${Math.min(100, (flow.completedJobs / Math.max(flow.totalJobs, 1)) * 100)}%` }} />
            </div>
            <span>{flow.completedJobs}/{flow.totalJobs}</span>
          </div>
          {!props.compact && onPost && (
            <ActionGroup>
              <IconAction
                icon={flow.state === "paused" ? <Play size={14} /> : <Pause size={14} />}
                label={flow.state === "paused" ? "Resume" : "Pause"}
                active={flow.state === "paused"}
                onClick={() => void onPost(`/flows/${encodeURIComponent(flow.id)}/${flow.state === "paused" ? "resume" : "pause"}`)}
              />
              <IconAction icon={<Ban size={14} />} label="Cancel" danger onClick={() => void onPost(`/flows/${encodeURIComponent(flow.id)}/cancel`)} />
            </ActionGroup>
          )}
        </div>
      ))}
    </div>
  );
}

function JobTable(props: { jobs: Job[]; onSelectJob: (job: Job) => void }) {
  return (
    <DataTable columns={["Job", "State", "Progress", "Priority"]}>
      {props.jobs.map((job) => (
        <button className="dataRow four jobRow interactive" key={job.id} onClick={() => props.onSelectJob(job)}>
          <span className="recordMain">
            <strong>{basename(job.payload.script)}</strong>
            <span>{job.queue} - {job.payload.originApp ?? "local"} - {job.payload.type}</span>
          </span>
          <span><Status state={job.state} /></span>
          <span className="progressCell">
            <div className="progressTrack" aria-label={`${job.progressPercent ?? 0}% complete`}>
              <span style={{ width: `${Math.min(100, job.progressPercent ?? 0)}%` }} />
            </div>
            <span>{job.progressPercent ?? 0}%</span>
          </span>
          <span className="priorityChip">P{job.priority}</span>
        </button>
      ))}
    </DataTable>
  );
}

function JobDetails(props: {
  job: Job;
  logs: Array<{ stream: string; line: string; createdAt: string }>;
  commands: Array<{ id: string; state: string; payload: unknown; createdAt: string }>;
  scriptSource: ScriptSource | null;
  priorityDraft: string;
  commandDraft: string;
  setPriorityDraft: (value: string) => void;
  setCommandDraft: (value: string) => void;
  onClose: () => void;
  onPost: (path: string, body?: unknown) => Promise<void>;
}) {
  const sendCommand = () => {
    let payload: unknown;
    try {
      payload = JSON.parse(props.commandDraft);
    } catch {
      payload = { instruction: props.commandDraft };
    }
    void props.onPost(`/jobs/${encodeURIComponent(props.job.id)}/commands`, { payload, ttlMs: 30_000 });
  };

  return (
    <section className="details">
      <div className="detailHeader">
        <div>
          <div className="detailEyebrow">Job</div>
          <h2>{basename(props.job.payload.script)}</h2>
          <p>{props.job.id}</p>
          <div className="detailMeta">
            <span>{props.job.queue}</span>
            <span>{props.job.payload.originApp ?? "local"}</span>
            <span>{props.job.payload.type}</span>
          </div>
        </div>
        <div className="detailActions compactActions">
          <Status state={props.job.state} />
          <ActionGroup>
            <IconAction icon={<Ban size={14} />} label="Cancel" danger onClick={() => void props.onPost(`/jobs/${encodeURIComponent(props.job.id)}/cancel`)} />
            <IconAction icon={<RotateCcw size={14} />} label="Retry" onClick={() => void props.onPost(`/jobs/${encodeURIComponent(props.job.id)}/retry`, { delayMs: 0 })} />
          </ActionGroup>
          <div className="inputActionGroup">
            <input aria-label="Priority" value={props.priorityDraft} onChange={(event) => props.setPriorityDraft(event.target.value)} />
            <IconAction icon={<Gauge size={14} />} label="Set" onClick={() => void props.onPost(`/jobs/${encodeURIComponent(props.job.id)}/priority`, { priority: Number(props.priorityDraft) })} />
          </div>
          <IconAction className="iconOnly" icon={<X size={16} />} label="Close" onClick={props.onClose} />
        </div>
      </div>
      <div className="detailStats">
        <Metric label="Progress" value={`${props.job.progressPercent ?? 0}%`} />
        <Metric label="Priority" value={props.job.priority} />
        <Metric label="Max tries" value={props.job.retryPolicy.attempts} />
        <Metric label="Args" value={props.job.payload.args?.length ?? 0} />
      </div>
      <div className="detailGrid">
        <div className="detailBlock">
          <h3>Execution</h3>
          <KeyValue label="Script" value={props.job.payload.script} />
          <KeyValue label="CWD" value={props.job.payload.cwd ?? "default"} />
          <KeyValue label="Flow" value={props.job.flowId ?? "none"} />
          <KeyValue label="Retry" value={`${props.job.retryPolicy.attempts} ${props.job.retryPolicy.backoff} ${props.job.retryPolicy.delayMs}ms`} />
          <KeyValue label="Created" value={formatDate(props.job.createdAt)} />
          <KeyValue label="Started" value={formatDate(props.job.startedAt)} />
          <KeyValue label="Finished" value={formatDate(props.job.finishedAt)} />
          {props.job.rateLimitBuckets.length > 0 && <KeyValue label="Buckets" value={props.job.rateLimitBuckets.join(", ")} />}
          {props.job.dedupeKey && <KeyValue label="Dedupe" value={`${props.job.dedupeScope}:${props.job.dedupeKey}`} />}
        </div>
        <div className="detailBlock">
          <h3>Arguments</h3>
          <ArgsList args={props.job.payload.args ?? []} />
        </div>
        <div className="detailBlock">
          <h3>Outputs</h3>
          <OutputsBlock resultMeta={props.job.resultMeta} />
        </div>
        <div className="detailBlock">
          <h3>Command</h3>
          <div className="commandComposer">
            <input value={props.commandDraft} onChange={(event) => props.setCommandDraft(event.target.value)} aria-label="Command payload" />
            <IconAction className="primary" icon={<Send size={14} />} label="Send" onClick={sendCommand} />
          </div>
        </div>
        <CodePanel source={props.scriptSource} />
        <div className="detailBlock">
          <h3>Logs</h3>
          <pre>{props.logs.map((log) => `[${log.stream}] ${log.line}`).join("\n") || "No logs yet."}</pre>
        </div>
        <div className="detailBlock">
          <h3>Commands</h3>
          <pre>{props.commands.map((command) => `${command.state} ${command.id} ${JSON.stringify(command.payload)}`).join("\n") || "No commands yet."}</pre>
        </div>
      </div>
    </section>
  );
}

function OutputsBlock(props: { resultMeta: unknown }) {
  const result = normalizeResultMeta(props.resultMeta);
  if (result.artifacts.length === 0 && result.outputs.length === 0 && result.raw === null) {
    return <p className="emptyText">No outputs have been reported yet.</p>;
  }

  return (
    <div className="outputsList">
      {result.artifacts.length > 0 && (
        <div>
          <h4>Artifacts</h4>
          {result.artifacts.map((artifact, index) => (
            <div className="outputItem" key={`artifact-${index}`}>
              <span>{artifact.at ? formatDate(artifact.at) : "artifact"}</span>
              <code>{artifact.path}</code>
              {artifact.meta !== undefined && artifact.meta !== null && <pre>{formatJson(artifact.meta)}</pre>}
            </div>
          ))}
        </div>
      )}
      {result.outputs.length > 0 && (
        <div>
          <h4>Values</h4>
          {result.outputs.map((output, index) => (
            <div className="outputItem" key={`output-${index}`}>
              <span>{output.name}</span>
              <pre>{formatJson(output.value)}</pre>
            </div>
          ))}
        </div>
      )}
      {result.raw !== null && <pre>{formatJson(result.raw)}</pre>}
    </div>
  );
}

function ArgsList(props: { args: string[] }) {
  if (props.args.length === 0) {
    return <p className="emptyText">No positional args were passed to this job.</p>;
  }

  return (
    <ol className="argsList">
      {props.args.map((arg, index) => (
        <li key={`${index}-${arg}`}>
          <span>{index}</span>
          <code>{arg}</code>
        </li>
      ))}
    </ol>
  );
}

function normalizeResultMeta(value: unknown): {
  artifacts: Array<{ path: string; meta?: unknown; at?: string }>;
  outputs: Array<{ name: string; value: unknown; at?: string }>;
  raw: unknown | null;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { artifacts: [], outputs: [], raw: value ?? null };
  }

  const record = value as Record<string, unknown>;
  const artifacts = Array.isArray(record.artifacts)
    ? record.artifacts.flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const artifact = item as Record<string, unknown>;
        return typeof artifact.path === "string"
          ? [{ path: artifact.path, meta: artifact.meta, at: typeof artifact.at === "string" ? artifact.at : undefined }]
          : [];
      })
    : [];
  const outputs = Array.isArray(record.outputs)
    ? record.outputs.flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const output = item as Record<string, unknown>;
        return typeof output.name === "string" ? [{ name: output.name, value: output.value, at: typeof output.at === "string" ? output.at : undefined }] : [];
      })
    : [];
  const rest = Object.fromEntries(Object.entries(record).filter(([key]) => key !== "artifacts" && key !== "outputs"));
  return { artifacts, outputs, raw: Object.keys(rest).length > 0 ? rest : null };
}

function formatJson(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function CodePanel(props: { source: ScriptSource | null; compact?: boolean }) {
  const [html, setHtml] = useState("");

  useEffect(() => {
    let canceled = false;

    if (!props.source) {
      setHtml("");
      return;
    }

    void codeToHtml(props.source.code, {
      lang: props.source.language,
      theme: "github-dark"
    })
      .then((nextHtml) => {
        if (!canceled) setHtml(nextHtml);
      })
      .catch(() => {
        if (!canceled) setHtml("");
      });

    return () => {
      canceled = true;
    };
  }, [props.source]);

  return (
    <div className={props.compact ? "codePanel compact" : "codePanel"}>
      <h3>Script</h3>
      {props.source ? (
        <>
          <div className="codeMeta">
            <span>{props.source.language}</span>
            <strong>{props.source.path}</strong>
          </div>
          {html ? (
            <div className="codeBlock" dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <pre className="codeBlock plainCode">{props.source.code}</pre>
          )}
        </>
      ) : (
        <pre className="codeBlock plainCode">Script source unavailable.</pre>
      )}
    </div>
  );
}

function DataTable(props: { columns: string[]; children: React.ReactNode }) {
  const cls = props.columns.length === 6 ? "six" : props.columns.length === 5 ? "five" : "four";
  return (
    <div className="table">
      <div className={`dataRow head ${cls}`}>
        {props.columns.map((column) => <span key={column}>{column}</span>)}
      </div>
      {props.children}
    </div>
  );
}

function ActionGroup(props: { children: React.ReactNode }) {
  return <span className="actionGroup">{props.children}</span>;
}

function IconAction(props: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  className?: string;
  onClick: () => void;
}) {
  const classes = ["actionButton", props.active ? "active" : "", props.danger ? "danger" : "", props.className ?? ""].filter(Boolean).join(" ");
  return (
    <button className={classes} disabled={props.disabled} title={props.label} aria-label={props.label} onClick={props.onClick}>
      {props.icon}
      <span className="actionLabel">{props.label}</span>
    </button>
  );
}

function NavButton(props: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button className={props.active ? "active" : ""} onClick={props.onClick}>
      {props.icon}
      {props.label}
    </button>
  );
}

function Metric(props: { label: string; value: number | string }) {
  return (
    <div className="metric">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function Status(props: { state: string }) {
  return <span className={`status ${props.state}`}><span aria-hidden="true" />{props.state}</span>;
}

function KeyValue(props: { label: string; value: string }) {
  return (
    <div className="keyValue">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${api}${path}`);
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

async function apiRequest<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  if (!response.ok) throw new Error(await response.text());
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

async function createExampleJob(
  workspaceRoot: string,
  queue: string,
  script: string,
  options: Partial<{
    args: string[];
    dependsOn: string[];
    flowId: string;
    priority: number;
    rateLimitBuckets: string[];
    retry: { attempts: number; backoff: "fixed" | "exponential"; delayMs: number };
  }> = {}
): Promise<{ id: string }> {
  if (!workspaceRoot) {
    throw new Error("Qme health has not reported a workspace root yet. Refresh and try again.");
  }
  const cwd = exampleCwd(workspaceRoot);
  return apiRequest<{ id: string }>("POST", `/queues/${encodeURIComponent(queue)}/jobs`, {
    flowId: options.flowId,
    dependsOn: options.dependsOn ?? [],
    rateLimitBuckets: options.rateLimitBuckets ?? [],
    payload: {
      type: "node",
      script,
      args: options.args ?? [],
      cwd,
      originApp: "qme-web-examples"
    },
    priority: options.priority ?? 100,
    retry: options.retry
  });
}

function exampleCwd(workspaceRoot: string): string {
  return `${workspaceRoot.replace(/\/$/, "")}/examples/node-scraper/src`;
}

function basename(value: string) {
  return value.split(/[\\/]/).at(-1) ?? value;
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleTimeString() : "not used";
}

function ago(ms: number): string {
  return new Date(demoNow - ms).toISOString();
}

function initialView(): View {
  const requested = new URLSearchParams(location.search).get("view");
  return isView(requested) ? requested : "work";
}

function isView(value: string | null): value is View {
  return value !== null && validViews.includes(value as View);
}

const validViews: View[] = ["work", "examples", "flows", "queues", "jobs", "rateLimits", "store", "library", "settings"];

const viewTitles: Record<View, { heading: string; copy: string }> = {
  work: { heading: "Active Work", copy: "Local queue execution, script output, and progress in real time." },
  examples: { heading: "Examples", copy: "Launch the bundled jobs and flows into Qme." },
  flows: { heading: "Flows", copy: "Multi-job scraping and AI AFK runs with dependency-aware controls." },
  queues: { heading: "Queues", copy: "Named execution lanes with pause, resume, depth, and concurrency state." },
  jobs: { heading: "Jobs", copy: "Inspect every job, open logs, retry, cancel, reprioritize, and send commands." },
  rateLimits: { heading: "Rate Limits", copy: "Declared buckets used to avoid hammering domains, APIs, accounts, or proxies." },
  store: { heading: "Store", copy: "SQLite and discovery file locations, plus persisted work counts." },
  library: { heading: "Library", copy: "Embed Qme directly in TypeScript apps, then opt into scripts and the dashboard when useful." },
  settings: { heading: "Settings", copy: "Current runtime defaults and planned configuration surfaces." }
};

createRoot(document.getElementById("root")!).render(<App />);
