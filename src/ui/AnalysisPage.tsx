import { useEffect, useRef, useState } from 'react';
import * as Plot from '@observablehq/plot';
import type { StudyDataset, StudyRun, LLMCallRecord, StudyEvent } from '@/store/studyStore';
import { Download, Upload } from 'lucide-react';

// ---------------------------------------------------------------------------
// Dataset derivation helpers
// ---------------------------------------------------------------------------

interface RunMetrics {
  runId: string;
  participantId: string;
  condition: string;
  taskId: string;
  promptsToTarget: number;
  tokensToTarget: number;
  timeToTargetMin: number;
  editsAfterFirstRender: number;
  backChannelAcceptRate: number | null;
}

function deriveMetrics(ds: StudyDataset): RunMetrics[] {
  return ds.runs
    .filter((r) => r.completed && r.endedAt)
    .map((run): RunMetrics => {
      const calls = ds.llmCalls.filter((c) => c.runId === run.runId);
      const events = ds.events.filter((e) => e.runId === run.runId);

      const promptsToTarget = calls.filter((c) => c.callType !== 'call_b').length;
      const tokensToTarget = calls.reduce((s, c) => s + c.inputTokens + c.outputTokens, 0);
      const timeToTargetMin = ((run.endedAt! - run.startedAt) / 60_000);

      // Edits after first render: manipulations that happen after the first
      // 'generation' event in the run.
      const firstGen = events.find((e) => e.kind === 'generation');
      const editsAfterFirstRender = firstGen
        ? events.filter((e) => e.kind === 'manipulation' && e.ts > firstGen.ts).length
        : 0;

      // Back-channel accept rate from existing log entries (if any).
      const backChannelEvents = events.filter((e) => e.kind === 'backchannel');
      const accepted = backChannelEvents.filter((e) => e.data?.accepted === true).length;
      const backChannelAcceptRate =
        backChannelEvents.length > 0 ? accepted / backChannelEvents.length : null;

      return {
        runId: run.runId,
        participantId: run.participantId,
        condition: run.condition,
        taskId: run.taskId,
        promptsToTarget,
        tokensToTarget,
        timeToTargetMin,
        editsAfterFirstRender,
        backChannelAcceptRate,
      };
    });
}

// ---------------------------------------------------------------------------
// Individual chart components (each mounts into a <div ref>)
// ---------------------------------------------------------------------------

function PlotChart({ title, buildPlot }: { title: string; buildPlot: () => SVGSVGElement | HTMLElement }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.innerHTML = '';
    ref.current.appendChild(buildPlot());
  });
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-slate-700">{title}</h3>
      <div ref={ref} />
    </div>
  );
}

function PromptsChart({ data }: { data: RunMetrics[] }) {
  return (
    <PlotChart
      title="Prompts to target by condition"
      buildPlot={() =>
        Plot.plot({
          marks: [
            Plot.boxY(data, { x: 'condition', y: 'promptsToTarget', fill: 'condition' }),
            Plot.dot(data, { x: 'condition', y: 'promptsToTarget', fill: 'white', stroke: 'condition', r: 3 }),
          ],
          x: { label: 'Condition' },
          y: { label: 'Prompts sent', grid: true },
          color: { legend: true },
          width: 400,
        })
      }
    />
  );
}

function TokensChart({ data }: { data: RunMetrics[] }) {
  return (
    <PlotChart
      title="Total tokens to target by condition"
      buildPlot={() =>
        Plot.plot({
          marks: [
            Plot.boxY(data, { x: 'condition', y: 'tokensToTarget', fill: 'condition' }),
            Plot.dot(data, { x: 'condition', y: 'tokensToTarget', fill: 'white', stroke: 'condition', r: 3 }),
          ],
          x: { label: 'Condition' },
          y: { label: 'Total tokens (input + output)', grid: true },
          color: { legend: true },
          width: 400,
        })
      }
    />
  );
}

function TimeChart({ data }: { data: RunMetrics[] }) {
  return (
    <PlotChart
      title="Time to target (minutes) by condition"
      buildPlot={() =>
        Plot.plot({
          marks: [
            Plot.boxY(data, { x: 'condition', y: 'timeToTargetMin', fill: 'condition' }),
            Plot.dot(data, { x: 'condition', y: 'timeToTargetMin', fill: 'white', stroke: 'condition', r: 3 }),
          ],
          x: { label: 'Condition' },
          y: { label: 'Minutes', grid: true },
          color: { legend: true },
          width: 400,
        })
      }
    />
  );
}

function EditsChart({ data }: { data: RunMetrics[] }) {
  return (
    <PlotChart
      title="Canvas edits after first render by condition"
      buildPlot={() =>
        Plot.plot({
          marks: [
            Plot.boxY(data, { x: 'condition', y: 'editsAfterFirstRender', fill: 'condition' }),
            Plot.dot(data, { x: 'condition', y: 'editsAfterFirstRender', fill: 'white', stroke: 'condition', r: 3 }),
          ],
          x: { label: 'Condition' },
          y: { label: 'Edits', grid: true },
          color: { legend: true },
          width: 400,
        })
      }
    />
  );
}

function AcceptRateChart({ data }: { data: RunMetrics[] }) {
  const withRate = data.filter((d) => d.backChannelAcceptRate !== null);
  if (withRate.length === 0) return null;
  return (
    <PlotChart
      title="Back-channel accept rate by condition"
      buildPlot={() =>
        Plot.plot({
          marks: [
            Plot.dot(withRate, {
              x: 'condition',
              y: 'backChannelAcceptRate',
              fill: 'condition',
              r: 5,
            }),
            Plot.ruleY([0, 1], { stroke: '#e2e8f0' }),
          ],
          x: { label: 'Condition' },
          y: { label: 'Accept rate (0–1)', domain: [0, 1], grid: true },
          color: { legend: true },
          width: 400,
        })
      }
    />
  );
}

function PerTaskChart({ data }: { data: RunMetrics[] }) {
  return (
    <PlotChart
      title="Prompts to target by task and condition"
      buildPlot={() =>
        Plot.plot({
          marks: [
            Plot.barY(
              data,
              Plot.groupX(
                { y: 'mean' },
                { x: 'taskId', y: 'promptsToTarget', fill: 'condition', fx: 'condition' },
              ),
            ),
            Plot.ruleY([0]),
          ],
          x: { label: 'Task' },
          y: { label: 'Mean prompts', grid: true },
          color: { legend: true },
          width: 600,
        })
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Summary table
// ---------------------------------------------------------------------------

function SummaryTable({ data }: { data: RunMetrics[] }) {
  const conditions = ['full', 'chat_only'];
  const metrics: { key: keyof RunMetrics; label: string; fmt: (v: number) => string }[] = [
    { key: 'promptsToTarget', label: 'Prompts to target', fmt: (v) => v.toFixed(1) },
    { key: 'tokensToTarget', label: 'Tokens to target', fmt: (v) => v.toLocaleString() },
    { key: 'timeToTargetMin', label: 'Time to target (min)', fmt: (v) => v.toFixed(1) },
    { key: 'editsAfterFirstRender', label: 'Edits after first render', fmt: (v) => v.toFixed(1) },
  ];

  function mean(rows: RunMetrics[], key: keyof RunMetrics): number {
    const vals = rows.map((r) => r[key]).filter((v): v is number => typeof v === 'number');
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : NaN;
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-slate-700">Summary (means)</h3>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-slate-100">
            <th className="py-1 text-left text-slate-500">Metric</th>
            {conditions.map((c) => (
              <th key={c} className="py-1 text-right text-slate-500">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {metrics.map(({ key, label, fmt }) => (
            <tr key={key} className="border-b border-slate-50">
              <td className="py-1 text-slate-600">{label}</td>
              {conditions.map((c) => {
                const rows = data.filter((d) => d.condition === c);
                const v = mean(rows, key);
                return (
                  <td key={c} className="py-1 text-right font-mono text-slate-700">
                    {Number.isNaN(v) ? '—' : fmt(v)} <span className="text-slate-400">n={rows.length}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function AnalysisPage() {
  const [dataset, setDataset] = useState<StudyDataset | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load from localStorage on mount (so users can analyze without re-uploading).
  useEffect(() => {
    try {
      const raw = localStorage.getItem('wysiwyc-study');
      if (raw) setDataset(JSON.parse(raw) as StudyDataset);
    } catch {
      // ignore
    }
  }, []);

  function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string) as StudyDataset;
        setDataset(parsed);
        setError(null);
      } catch {
        setError('Could not parse the uploaded file as a study dataset JSON.');
      }
    };
    reader.readAsText(file);
  }

  function handleExport() {
    if (!dataset) return;
    const blob = new Blob([JSON.stringify(dataset, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wysiwyc-analysis-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const metrics = dataset ? deriveMetrics(dataset) : [];
  const runs = dataset?.runs ?? [];

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="flex h-12 items-center gap-3 border-b border-slate-200 bg-white px-6">
        <span className="text-sm font-bold tracking-tight text-slate-900">WYSIWYC</span>
        <span className="text-[11px] text-slate-400">/ Analysis</span>
        <a href="/" className="ml-auto text-[11px] text-slate-500 hover:text-slate-800 hover:underline">← Back to editor</a>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-6 py-8">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-semibold text-slate-800">Study Dataset Analysis</h1>
          <label className="flex cursor-pointer items-center gap-1.5 rounded border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-600 shadow-sm hover:bg-slate-50">
            <Upload className="h-3.5 w-3.5" /> Upload dataset JSON
            <input type="file" accept=".json" className="sr-only" onChange={handleUpload} />
          </label>
          {dataset && (
            <button
              onClick={handleExport}
              className="flex items-center gap-1.5 rounded border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-600 shadow-sm hover:bg-slate-50"
            >
              <Download className="h-3.5 w-3.5" /> Re-download
            </button>
          )}
        </div>

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-[11px] text-rose-700">
            {error}
          </div>
        )}

        {!dataset && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center text-sm text-slate-400">
            Upload a <code>wysiwyc-study-*.json</code> file to see graphs, or open{' '}
            <code>/study</code> and export from there.
          </div>
        )}

        {dataset && (
          <>
            <div className="text-[11px] text-slate-500">
              {runs.length} runs total · {runs.filter((r) => r.completed).length} completed ·{' '}
              {metrics.length} with metrics
            </div>

            {metrics.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white py-12 text-center text-sm text-slate-400">
                No completed runs found in the dataset yet.
              </div>
            ) : (
              <>
                <SummaryTable data={metrics} />

                <div className="grid grid-cols-2 gap-6">
                  <PromptsChart data={metrics} />
                  <TokensChart data={metrics} />
                  <TimeChart data={metrics} />
                  <EditsChart data={metrics} />
                </div>

                <AcceptRateChart data={metrics} />
                <PerTaskChart data={metrics} />

                {/* Raw data table */}
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <h3 className="mb-3 text-sm font-semibold text-slate-700">Per-run data</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[10px]">
                      <thead>
                        <tr className="border-b border-slate-100 text-slate-500">
                          <th className="py-1 text-left">Participant</th>
                          <th className="py-1 text-left">Condition</th>
                          <th className="py-1 text-left">Task</th>
                          <th className="py-1 text-right">Prompts</th>
                          <th className="py-1 text-right">Tokens</th>
                          <th className="py-1 text-right">Time (min)</th>
                          <th className="py-1 text-right">Edits</th>
                        </tr>
                      </thead>
                      <tbody>
                        {metrics.map((m) => (
                          <tr key={m.runId} className="border-b border-slate-50 font-mono">
                            <td className="py-1 text-slate-600">{m.participantId}</td>
                            <td className="py-1 text-slate-600">{m.condition}</td>
                            <td className="py-1 text-slate-600">{m.taskId}</td>
                            <td className="py-1 text-right">{m.promptsToTarget}</td>
                            <td className="py-1 text-right">{m.tokensToTarget.toLocaleString()}</td>
                            <td className="py-1 text-right">{m.timeToTargetMin.toFixed(1)}</td>
                            <td className="py-1 text-right">{m.editsAfterFirstRender}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
