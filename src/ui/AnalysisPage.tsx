import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as Plot from '@observablehq/plot';
import { AlertTriangle, ClipboardCopy, CloudDownload, Database, FileJson, FileText, FlaskConical, Loader2, Trash2, Upload } from 'lucide-react';
import {
  addFile,
  addJSON,
  computeStats,
  dedupe,
  emptyData,
  ensureBlocks,
  statsMarkdown,
  type AnalysisData,
  type MeasureKey,
  type MeasureStats,
  type StudyStats,
} from '@/study/analysis';
import { demoSessions } from '@/study/demoData';
import { downloadText, ENV_SHEETS_URL, fetchFromSheets, readArchive } from '@/study/exporter';
import { toCSV } from '@/study/csv';
import { fmtNum, fmtP, fmtPct } from '@/study/stats';
import { cn } from '@/lib/utils';

/** Condition colours (validated categorical pair, see docs/STUDY.md). */
const C_BASE = '#5b6fd6';
const C_WYS = '#d97706';
const INK = '#0f172a';
const MUTED = '#64748b';
const SHEETS_KEY = 'wysiwyc.study.sheetsUrl';

// --- Plot plumbing --------------------------------------------------------------

function PlotFigure({ build, height = 300 }: { build: (width: number) => Element; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el || width < 50) return;
    const node = build(width);
    el.replaceChildren(node);
    return () => { node.remove(); };
  }, [build, width]);
  return <div ref={ref} style={{ minHeight: height }} className="w-full [&_svg]:max-w-full [&_svg]:overflow-visible" />;
}

const baseStyle = { fontSize: '11px', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', color: MUTED, background: 'transparent' } as const;

/** Paired slope chart: one grey line per participant, coloured endpoints, bold median. */
function pairedChart(m: MeasureStats, opts: { yLabel: string; zero?: boolean; domain?: [number, number] }) {
  return (width: number) => {
    const [sb, sw] = m.sides;
    const long = m.pairs.flatMap((p) => [
      { pid: p.pid, side: sb, value: p.baseline },
      { pid: p.pid, side: sw, value: p.wysiwyc },
    ]);
    const med = [
      { side: sb, value: m.medBaseline },
      { side: sw, value: m.medWysiwyc },
    ];
    return Plot.plot({
      width,
      height: 300,
      marginLeft: 52,
      marginRight: 80,
      marginBottom: 36,
      style: baseStyle,
      x: { type: 'point', domain: [sb, sw], label: null, padding: 0.45 },
      y: { label: opts.yLabel, grid: true, zero: opts.zero ?? true, domain: opts.domain, nice: true },
      color: { domain: [sb, sw], range: [C_BASE, C_WYS] },
      marks: [
        Plot.line(long, { x: 'side', y: 'value', z: 'pid', stroke: '#cbd5e1', strokeWidth: 1.5 }),
        Plot.dot(long, {
          x: 'side', y: 'value', fill: 'side', r: 4.5, stroke: 'white', strokeWidth: 1.5,
          channels: { Participant: 'pid' }, tip: { format: { x: false, fill: false } },
        }),
        Plot.line(med, { x: 'side', y: 'value', stroke: INK, strokeWidth: 3 }),
        // Median labels sit outside the pair: left of the first column, right of the second.
        Plot.text([med[0]], {
          x: 'side', y: 'value', text: (d: { value: number }) => `median ${fmtNum(d.value)}`,
          dx: -12, textAnchor: 'end', fill: INK, fontWeight: 600,
        }),
        Plot.text([med[1]], {
          x: 'side', y: 'value', text: (d: { value: number }) => `median ${fmtNum(d.value)}`,
          dx: 12, textAnchor: 'start', fill: INK, fontWeight: 600,
        }),
      ],
    });
  };
}

// --- Small UI pieces ---------------------------------------------------------------

function Section({ title, kicker, text, children, id }: { title: string; kicker?: string; text?: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      {kicker && <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{kicker}</p>}
      <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
      <div className="mt-3">{children}</div>
      {text && <p className="mt-3 border-t border-slate-100 pt-3 text-[12.5px] leading-relaxed text-slate-600" data-testid="interpretation">{text}</p>}
    </section>
  );
}

function StatCard({ m, label }: { m: MeasureStats | undefined; label: string }) {
  if (!m) return null;
  const ok = m.pairs.length > 0;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" data-testid="stat-card">
      <div className="text-3xl font-bold tracking-tight text-slate-900 tabular-nums">{ok ? fmtPct(m.change) : '—'}</div>
      <div className="mt-0.5 text-[12px] font-medium text-slate-700">{label}</div>
      {ok && (
        <div className="mt-2 space-y-0.5 text-[11px] text-slate-500">
          <div>
            median <span className="font-mono text-slate-700">{fmtNum(m.medBaseline)}</span> → <span className="font-mono text-slate-700">{fmtNum(m.medWysiwyc)}</span>
          </div>
          <div>
            {m.improved}/{m.pairs.length} improved{m.test ? ` · ${fmtP(m.test.p)} · r = ${m.test.r.toFixed(2)}` : ''}
          </div>
        </div>
      )}
    </div>
  );
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="mb-2 flex flex-wrap gap-3 text-[11px] text-slate-600">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} /> {i.label}
        </span>
      ))}
    </div>
  );
}

const btn = 'inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-40';

// --- Page ----------------------------------------------------------------------------

export function AnalysisPage() {
  const [data, setData] = useState<AnalysisData | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [sheetsUrl, setSheetsUrl] = useState(() => {
    try { return localStorage.getItem(SHEETS_KEY) || ENV_SHEETS_URL; } catch { return ENV_SHEETS_URL; }
  });
  const [fetching, setFetching] = useState(false);
  const [copied, setCopied] = useState(false);

  /** Add to the loaded data (synthetic demo data is replaced, never mixed with real data). */
  const merge = (fn: (d: AnalysisData) => string | void) => {
    setError(null);
    const prev = data;
    const next: AnalysisData = prev && !prev.synthetic
      ? { ...prev, participants: [...prev.participants], blocks: [...prev.blocks], calls: [...prev.calls], events: [...prev.events], sources: [...prev.sources] }
      : emptyData();
    try {
      fn(next);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    setData(ensureBlocks(dedupe(next)));
  };

  async function onFiles(files: FileList | File[]) {
    const list = Array.from(files);
    const texts = await Promise.all(list.map(async (f) => ({ name: f.name, text: await f.text() })));
    // One unreadable file must not block the others: load what parses, report the rest.
    const failed: string[] = [];
    merge((d) => {
      for (const { name, text } of texts) {
        try {
          addFile(d, name, text);
        } catch (e) {
          failed.push(`${name}: ${(e as Error).message}`);
        }
      }
    });
    if (failed.length) setError(`Skipped ${failed.length} file${failed.length > 1 ? 's' : ''} — ${failed.join(' · ')}`);
    setLog((l) => [...l, ...list.map((f) => `Loaded ${f.name}`)]);
  }

  async function onFetch() {
    if (!sheetsUrl.trim()) return;
    try { localStorage.setItem(SHEETS_KEY, sheetsUrl.trim()); } catch { /* ignore */ }
    setFetching(true);
    try {
      const json = await fetchFromSheets(sheetsUrl.trim());
      merge((d) => { const k = addJSON(d, json); d.sources.push(`Google Sheets (${k})`); });
      setLog((l) => [...l, 'Fetched from Google Sheets']);
    } catch (e) {
      setError(`Could not fetch from Google Sheets: ${(e as Error).message}`);
    } finally {
      setFetching(false);
    }
  }

  function loadArchive() {
    const sessions = readArchive();
    if (!sessions.length) { setError('No finished sessions are stored in this browser.'); return; }
    merge((d) => { addJSON(d, sessions); d.sources.push(`This browser (${sessions.length} sessions)`); });
  }

  function loadDemo() {
    setError(null);
    const d = emptyData();
    addJSON(d, demoSessions());
    d.synthetic = true;
    d.sources.push('Synthetic demo data (12 generated participants)');
    setData(ensureBlocks(dedupe(d)));
  }

  const stats = useMemo<StudyStats | null>(() => (data && data.blocks.length ? computeStats(data) : null), [data]);
  const m = (k: MeasureKey) => stats?.measures.find((x) => x.key === k);

  // Chart builders are memoised per dataset so the figures only redraw on change.
  const charts = useMemo(() => {
    if (!stats) return null;
    const ms = (k: MeasureKey) => stats.measures.find((x) => x.key === k)!;
    return {
      prompts: pairedChart(ms('prompts'), { yLabel: 'Prompts per task' }),
      time: pairedChart(ms('time'), { yLabel: 'Minutes per task' }),
      tokens: tokensByTask(stats),
      waterfall: waterfallChart(stats),
      proposals: proposalChart(stats),
      dm: dmChart(stats),
      sus: pairedChart(ms('sus'), { yLabel: 'SUS score', domain: [0, 100] }),
      tlx: pairedChart(ms('tlx'), { yLabel: 'Raw TLX', domain: [0, 100] }),
      spec: pairedChart(ms('specVsChat'), { yLabel: 'Words at task end' }),
      preference: preferenceChart(stats),
    };
  }, [stats]);

  const md = stats ? statsMarkdown(stats) : '';
  const stamp = new Date().toISOString().slice(0, 10);

  return (
    <div
      className="min-h-screen bg-slate-50"
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false); }}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) void onFiles(e.dataTransfer.files); }}
    >
      <header className="sticky top-0 z-20 flex h-12 items-center gap-3 border-b border-slate-200 bg-white px-6">
        <span className="text-sm font-bold tracking-tight text-slate-900">WYSIWYC</span>
        <span className="text-[11px] text-slate-500">Study analysis</span>
        <nav className="ml-auto flex items-center gap-4 text-[11px] text-slate-500">
          <a href="./study" className="hover:text-slate-800 hover:underline">Run a session</a>
          <a href="./" className="hover:text-slate-800 hover:underline">← Editor</a>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl space-y-5 px-6 py-8">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">WYSIWYC vs. chat-only</h1>
          <p className="mt-1 text-sm text-slate-500">
            Paired, within-subjects comparison. Each participant contributes the mean of their two tasks per condition; differences are tested with the Wilcoxon signed-rank test.
          </p>
        </div>

        {/* Load panel */}
        <section className={cn('rounded-xl border bg-white p-5 shadow-sm transition-colors', dragOver ? 'border-amber-400 ring-2 ring-amber-100' : 'border-slate-200')}>
          <div className="grid grid-cols-[1.2fr_1fr] gap-6">
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center hover:bg-slate-100" data-testid="dropzone">
              <Upload className="h-5 w-5 text-slate-400" />
              <span className="text-[13px] font-medium text-slate-700">Drop CSV / JSON exports here, or click to choose</span>
              <span className="text-[11px] text-slate-500">Session JSON, *_summary.csv, *_events.csv, *_llm_calls.csv, demographics — several at once</span>
              <input type="file" multiple accept=".csv,.json,application/json,text/csv" className="sr-only" onChange={(e) => { if (e.target.files) void onFiles(e.target.files); e.target.value = ''; }} aria-label="Upload study files" />
            </label>
            <div className="space-y-3">
              <div>
                <span className="mb-1 block text-[11px] font-medium text-slate-600">Google Sheets (Apps Script web-app URL)</span>
                <div className="flex gap-2">
                  <input
                    value={sheetsUrl}
                    onChange={(e) => setSheetsUrl(e.target.value)}
                    placeholder="https://script.google.com/macros/s/…/exec"
                    className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
                    aria-label="Sheets URL"
                  />
                  <button className={btn} onClick={() => void onFetch()} disabled={!sheetsUrl.trim() || fetching}>
                    {fetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CloudDownload className="h-3.5 w-3.5" />} Fetch
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className={btn} onClick={loadArchive}>
                  <Database className="h-3.5 w-3.5" /> Sessions in this browser
                </button>
                <button className={btn} onClick={loadDemo}>
                  <FlaskConical className="h-3.5 w-3.5" /> Load demo data
                </button>
                {data && (
                  <button className={cn(btn, 'text-rose-600')} onClick={() => { setData(null); setLog([]); }}>
                    <Trash2 className="h-3.5 w-3.5" /> Clear
                  </button>
                )}
              </div>
              {data && (
                <p className="text-[11px] text-slate-500" data-testid="data-summary">
                  {stats?.nParticipants ?? 0} participants · {data.blocks.length} blocks · {data.calls.length} model calls · {data.events.length} events
                  <span className="block truncate text-slate-400" title={data.sources.join('\n')}>{data.sources.join(' · ')}</span>
                </p>
              )}
            </div>
          </div>
          {error && (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">
              <AlertTriangle className="h-3.5 w-3.5" /> {error}
            </div>
          )}
          {log.length > 0 && <span className="sr-only">{log.join(', ')}</span>}
        </section>

        {data?.synthetic && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-[12px] font-medium text-amber-900" data-testid="synthetic-banner">
            <FlaskConical className="h-4 w-4 text-amber-600" />
            Synthetic demo data — generated participants for previewing the analysis. Do not report these numbers.
          </div>
        )}

        {!stats && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center text-sm text-slate-500">
            Load study files, fetch from Google Sheets, or try the demo data to see the statistics.
          </div>
        )}

        {stats && (
          <>
            <div className="grid grid-cols-4 gap-4">
              <StatCard m={m('prompts')} label="prompts to reach a target UI" />
              <StatCard m={m('tokens')} label="tokens spent per task" />
              <StatCard m={m('time')} label="time to target" />
              <StatCard m={m('specVsChat')} label="shorter spec than the chat log" />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-1 text-[11px] font-medium text-slate-500">Export computed stats</span>
              <button className={btn} onClick={() => { void navigator.clipboard?.writeText(md).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>
                <ClipboardCopy className="h-3.5 w-3.5" /> {copied ? 'Copied' : 'Copy Markdown'}
              </button>
              <button className={btn} onClick={() => downloadText(`wysiwyc_stats_${stamp}.md`, md, 'text/markdown')}>
                <FileText className="h-3.5 w-3.5" /> stats.md
              </button>
              <button className={btn} onClick={() => downloadText(`wysiwyc_stats_${stamp}.json`, JSON.stringify(stats, null, 2), 'application/json')}>
                <FileJson className="h-3.5 w-3.5" /> stats.json
              </button>
              <button className={btn} onClick={() => downloadText(`wysiwyc_summary_merged_${stamp}.csv`, toCSV(data!.blocks))}>
                <FileText className="h-3.5 w-3.5" /> merged summary.csv
              </button>
            </div>

            <div className="grid grid-cols-2 gap-5">
              <Section kicker="Efficiency" title="Prompts to target, per participant" text={m('prompts')!.text}>
                <PlotFigure build={charts!.prompts} />
              </Section>
              <Section kicker="Efficiency" title="Time to target, per participant" text={m('time')!.text}>
                <PlotFigure build={charts!.time} />
              </Section>
            </div>

            <Section kicker="Cost" title="Tokens to target, by task (medians)" text={tokensByTaskText(stats)}>
              <Legend items={[{ label: 'Chat-only', color: C_BASE }, { label: 'WYSIWYC', color: C_WYS }]} />
              <PlotFigure build={charts!.tokens} height={280} />
            </Section>

            <Section kicker="Cost" title="Where the token savings come from (median per task)" text={stats.waterfall.text}>
              <PlotFigure build={charts!.waterfall} height={300} />
            </Section>

            <div className="grid grid-cols-2 gap-5">
              <Section kicker="Back-channel" title="Proposal outcomes (WYSIWYC)" text={stats.proposals.text}>
                <PlotFigure build={charts!.proposals} height={200} />
              </Section>
              <Section kicker="Interaction" title="Direct manipulations by kind (WYSIWYC, mean per task)" text={dmText(stats)}>
                <PlotFigure build={charts!.dm} height={240} />
              </Section>
            </div>

            <div className="grid grid-cols-2 gap-5">
              <Section kicker="Perception" title="System Usability Scale (higher is better)" text={m('sus')!.text}>
                <PlotFigure build={charts!.sus} />
              </Section>
              <Section kicker="Perception" title="Raw NASA-TLX workload (lower is better)" text={m('tlx')!.text}>
                <PlotFigure build={charts!.tlx} />
              </Section>
            </div>

            <div className="grid grid-cols-2 gap-5">
              <Section kicker="Readability" title="Final spec vs. chat history (words)" text={m('specVsChat')!.text}>
                <PlotFigure build={charts!.spec} />
              </Section>
              <Section kicker="Preference" title="Which tool would you rather use?" text={stats.preference.text}>
                <PlotFigure build={charts!.preference} height={150} />
              </Section>
            </div>

            <Section title="All measures" kicker="Statistics">
              <StatsTable stats={stats} />
            </Section>

            <Section title="Per-participant blocks" kicker="Data">
              <BlocksTable data={data!} />
            </Section>
          </>
        )}
      </main>
    </div>
  );
}

// --- Chart builders ---------------------------------------------------------------------

function tokensByTaskText(s: StudyStats): string {
  const rows = s.perTask;
  const parts = [...new Set(rows.map((r) => r.task))].map((t) => {
    const b = rows.find((r) => r.task === t && r.condition === 'baseline')!;
    const w = rows.find((r) => r.task === t && r.condition === 'wysiwyc')!;
    return { title: b.title, b: b.tokens, w: w.tokens, d: b.tokens - w.tokens };
  }).filter((p) => Number.isFinite(p.d));
  if (!parts.length) return 'Not enough data per task yet.';
  const lower = parts.filter((p) => p.d > 0).length;
  const top = [...parts].sort((a, b) => b.d - a.d)[0];
  return `WYSIWYC used fewer tokens on ${lower} of ${parts.length} targets. The largest absolute reduction was on the ${top.title.toLowerCase()} (${fmtNum(top.b, 0)} → ${fmtNum(top.w, 0)} tokens, ${fmtPct((top.w - top.b) / top.b)}).`;
}

function tokensByTask(s: StudyStats) {
  return (width: number) =>
    Plot.plot({
      width,
      height: 280,
      marginTop: 30,
      marginLeft: 56,
      marginBottom: 30,
      style: baseStyle,
      fx: { label: null, padding: 0.12 },
      x: { axis: null, domain: ['Chat-only', 'WYSIWYC'], padding: 0.08 },
      y: { label: 'Median tokens per task', grid: true, tickFormat: '~s' },
      color: { domain: ['Chat-only', 'WYSIWYC'], range: [C_BASE, C_WYS] },
      marks: [
        Plot.barY(s.perTask.filter((r) => Number.isFinite(r.tokens)), {
          fx: 'title', x: 'conditionLabel', y: 'tokens', fill: 'conditionLabel', rx: 4,
          channels: { Task: 'title', n: 'n' }, tip: { format: { fx: false, x: false, fill: false } },
        }),
        Plot.text(s.perTask.filter((r) => Number.isFinite(r.tokens)), {
          fx: 'title', x: 'conditionLabel', y: 'tokens', text: (d: { tokens: number }) => fmtCompact(d.tokens), dy: -7, fill: INK, fontSize: 10,
        }),
        Plot.ruleY([0], { stroke: '#cbd5e1' }),
      ],
    });
}

function fmtCompact(x: number): string {
  return x >= 1000 ? `${(x / 1000).toFixed(x >= 10000 ? 0 : 1)}k` : String(Math.round(x));
}

function waterfallChart(s: StudyStats) {
  return (width: number) => {
    const w = s.waterfall;
    let level = w.baseline;
    const steps: { label: string; y1: number; y2: number; value: number; kind: string }[] = [
      { label: 'Chat-only', y1: 0, y2: w.baseline, value: w.baseline, kind: 'base' },
    ];
    const parts: [string, number][] = [['Gestures replace re-prompts', w.gesture], ['Widget edits (0 calls)', w.widget]];
    if (Math.abs(w.residual) > 0.5) parts.push(['Other / unexplained', w.residual]);
    for (const [label, v] of parts) {
      steps.push({ label, y1: level - v, y2: level, value: -v, kind: v >= 0 ? 'saving' : 'overshoot' });
      level -= v;
    }
    steps.push({ label: 'WYSIWYC', y1: 0, y2: w.wysiwyc, value: w.wysiwyc, kind: 'wys' });
    steps.push({ label: 'Patch vs. regenerate*', y1: 0, y2: w.patch, value: w.patch, kind: 'counterfactual' });
    steps.push({ label: 'Cache (cost)*', y1: 0, y2: w.cache, value: w.cache, kind: 'counterfactual' });
    const fill: Record<string, string> = { base: C_BASE, wys: C_WYS, saving: '#fcd34d', overshoot: '#e2e8f0', counterfactual: '#e2e8f0' };
    return Plot.plot({
      width,
      height: 300,
      marginTop: 36,
      marginLeft: 56,
      marginBottom: 40,
      style: baseStyle,
      x: { label: null, domain: steps.map((d) => d.label), padding: 0.25 },
      y: { label: 'Tokens per task (median participant)', grid: true, tickFormat: '~s' },
      marks: [
        Plot.barY(steps, {
          x: 'label', y1: (d: { y1: number; y2: number }) => Math.min(d.y1, d.y2), y2: (d: { y1: number; y2: number }) => Math.max(d.y1, d.y2),
          fill: (d: { kind: string }) => fill[d.kind], stroke: (d: { kind: string }) => (d.kind === 'counterfactual' ? '#94a3b8' : 'none'),
          rx: 3,
          channels: { Tokens: 'value' }, tip: { format: { x: true, y1: false, y2: false } },
        }),
        Plot.text(steps, {
          x: 'label', y: (d: { y1: number; y2: number }) => Math.max(d.y1, d.y2),
          text: (d: { value: number; kind: string }) => (d.kind === 'saving' || d.kind === 'overshoot' ? `${d.value <= 0 ? '−' : '+'}${fmtCompact(Math.abs(d.value))}` : fmtCompact(d.value)),
          dy: -7, fill: INK, fontSize: 10, fontWeight: 600,
        }),
        Plot.ruleY([0], { stroke: '#cbd5e1' }),
        Plot.text([`* outside the comparison: counterfactual estimates, not part of the difference`], {
          frameAnchor: 'top-right', fill: MUTED, fontSize: 10, dy: -24,
        }),
      ],
    });
  };
}

function proposalChart(s: StudyStats) {
  return (width: number) => {
    const p = s.proposals;
    const total = p.accepted + p.alternative + p.rephrased + p.dismissed;
    const rows = [
      { outcome: 'Accepted as-is', n: p.accepted, color: '#d97706' },
      { outcome: 'Alternative swapped', n: p.alternative, color: '#0f9d8a' },
      { outcome: 'Rephrased', n: p.rephrased, color: '#5b6fd6' },
      { outcome: 'Dismissed', n: p.dismissed, color: '#c2417a' },
    ].map((r) => ({ ...r, share: total ? r.n / total : 0 }));
    return Plot.plot({
      width,
      height: 190,
      marginLeft: 130,
      marginRight: 60,
      style: baseStyle,
      x: { label: 'Share of resolved proposals', tickFormat: '%', domain: [0, 1], grid: true },
      y: { label: null, domain: rows.map((r) => r.outcome) },
      marks: [
        Plot.barX(rows, { y: 'outcome', x: 'share', fill: (d: { color: string }) => d.color, rx: 3, channels: { Count: 'n' }, tip: { format: { x: '.0%' } } }),
        Plot.text(rows, { y: 'outcome', x: 'share', text: (d: { share: number; n: number }) => `${Math.round(d.share * 100)}% (${d.n})`, dx: 6, textAnchor: 'start', fill: INK, fontSize: 10 }),
      ],
    });
  };
}

function dmText(s: StudyStats): string {
  const rows = s.dmByKind.filter((r) => r.perTask > 0).sort((a, b) => b.perTask - a.perTask);
  const total = rows.reduce((a, r) => a + r.perTask, 0);
  if (!rows.length) return 'No direct manipulations were logged in WYSIWYC tasks.';
  return `Participants made ${fmtNum(total)} direct manipulations per WYSIWYC task on average, most often ${rows.slice(0, 3).map((r) => `${r.kind.toLowerCase()} (${fmtNum(r.perTask)})`).join(', ')}. The chat-only canvas is read-only, so the baseline logs none.`;
}

function dmChart(s: StudyStats) {
  return (width: number) =>
    Plot.plot({
      width,
      height: 240,
      marginLeft: 110,
      marginRight: 40,
      style: baseStyle,
      x: { label: 'Mean per task', grid: true },
      y: { label: null, domain: [...s.dmByKind].sort((a, b) => b.perTask - a.perTask).map((r) => r.kind) },
      marks: [
        Plot.barX(s.dmByKind, { y: 'kind', x: 'perTask', fill: C_WYS, rx: 3, tip: { format: { x: '.1f' } } }),
        Plot.text(s.dmByKind, { y: 'kind', x: 'perTask', text: (d: { perTask: number }) => fmtNum(d.perTask), dx: 6, textAnchor: 'start', fill: INK, fontSize: 10 }),
      ],
    });
}

function preferenceChart(s: StudyStats) {
  return (width: number) => {
    const p = s.preference;
    const rows = [
      { label: 'WYSIWYC', n: p.wysiwyc, color: C_WYS },
      { label: 'Chat-only', n: p.baseline, color: C_BASE },
      { label: 'No preference', n: p.none, color: '#94a3b8' },
    ];
    return Plot.plot({
      width,
      height: 150,
      marginLeft: 100,
      marginRight: 40,
      style: baseStyle,
      x: { label: 'Participants', grid: true, domain: [0, Math.max(1, p.n)] },
      y: { label: null, domain: rows.map((r) => r.label) },
      marks: [
        Plot.barX(rows, { y: 'label', x: 'n', fill: (d: { color: string }) => d.color, rx: 3, tip: true }),
        Plot.text(rows, { y: 'label', x: 'n', text: (d: { n: number }) => String(d.n), dx: 6, textAnchor: 'start', fill: INK, fontSize: 10 }),
      ],
    });
  };
}

// --- Tables ------------------------------------------------------------------------------

function StatsTable({ stats }: { stats: StudyStats }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11.5px]" data-testid="stats-table">
        <thead>
          <tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-wider text-slate-500">
            <th className="py-1.5 pr-3 font-semibold">Measure</th>
            <th className="py-1.5 pr-3 text-right font-semibold">N</th>
            <th className="py-1.5 pr-3 text-right font-semibold">Chat-only median [IQR]</th>
            <th className="py-1.5 pr-3 text-right font-semibold">WYSIWYC median [IQR]</th>
            <th className="py-1.5 pr-3 text-right font-semibold">Change</th>
            <th className="py-1.5 pr-3 text-right font-semibold">Median Δ</th>
            <th className="py-1.5 pr-3 text-right font-semibold">Wilcoxon</th>
            <th className="py-1.5 text-right font-semibold">r</th>
          </tr>
        </thead>
        <tbody>
          {stats.measures.map((m) => (
            <tr key={m.key} className="border-b border-slate-50">
              <td className="py-1.5 pr-3 text-slate-700">
                {m.label} <span className="text-slate-400">({m.unit})</span>
                {m.sides[0] !== 'Chat-only' && <span className="block text-[10px] text-slate-400">{m.sides[0]} vs. {m.sides[1]}</span>}
              </td>
              <td className="py-1.5 pr-3 text-right font-mono">{m.pairs.length || '—'}</td>
              <td className="py-1.5 pr-3 text-right font-mono">{fmtNum(m.medBaseline)} <span className="text-slate-400">[{fmtNum(m.iqrBaseline[0])}–{fmtNum(m.iqrBaseline[1])}]</span></td>
              <td className="py-1.5 pr-3 text-right font-mono">{fmtNum(m.medWysiwyc)} <span className="text-slate-400">[{fmtNum(m.iqrWysiwyc[0])}–{fmtNum(m.iqrWysiwyc[1])}]</span></td>
              <td className="py-1.5 pr-3 text-right font-mono font-semibold text-slate-800">{fmtPct(m.change)}</td>
              <td className="py-1.5 pr-3 text-right font-mono">{fmtNum(m.medDiff)}</td>
              <td className="py-1.5 pr-3 text-right font-mono">{m.test ? `W=${fmtNum(m.test.w)}, ${fmtP(m.test.p)}` : '—'}{m.test && <span className="ml-1 text-slate-400">{m.test.method === 'exact' ? 'ex' : 'z'}</span>}</td>
              <td className="py-1.5 text-right font-mono">{m.test ? m.test.r.toFixed(2) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[10.5px] text-slate-400">
        Two-sided Wilcoxon signed-rank on per-participant means (zero differences dropped); exact distribution for N ≤ 30, otherwise normal approximation. r = |Z|/√N. Change = relative change of the medians.
      </p>
    </div>
  );
}

function BlocksTable({ data }: { data: AnalysisData }) {
  const rows = [...data.blocks].sort((a, b) => a.participant_id.localeCompare(b.participant_id, undefined, { numeric: true }) || a.block_index - b.block_index);
  return (
    <div className="max-h-96 overflow-auto">
      <table className="w-full text-[10.5px]">
        <thead className="sticky top-0 bg-white">
          <tr className="border-b border-slate-200 text-left text-slate-500">
            {['Participant', 'Block', 'Condition', 'Task', 'Prompts', 'Tokens', 'Cached', 'Min', 'DMs', 'Proposals', '1-click', 'Spec w', 'Chat w', 'SUS', 'TLX', 'End'].map((h) => (
              <th key={h} className="py-1 pr-2 font-semibold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="font-mono">
          {rows.map((r) => (
            <tr key={`${r.session_id}-${r.block_index}`} className="border-b border-slate-50">
              <td className="py-1 pr-2">{r.participant_id}</td>
              <td className="py-1 pr-2">{r.block_index + 1}</td>
              <td className="py-1 pr-2" style={{ color: r.condition === 'wysiwyc' ? C_WYS : C_BASE }}>{r.condition}</td>
              <td className="py-1 pr-2">{r.task_id}</td>
              <td className="py-1 pr-2">{r.prompts}</td>
              <td className="py-1 pr-2">{Number(r.total_tokens).toLocaleString('en-US')}</td>
              <td className="py-1 pr-2">{r.cached_share === undefined ? '' : `${Math.round(Number(r.cached_share) * 100)}%`}</td>
              <td className="py-1 pr-2">{(Number(r.duration_s) / 60).toFixed(1)}</td>
              <td className="py-1 pr-2">{r.dm_total}</td>
              <td className="py-1 pr-2">{r.proposals}</td>
              <td className="py-1 pr-2">{r.single_click_share === '' || r.single_click_share === undefined ? '' : `${Math.round(Number(r.single_click_share) * 100)}%`}</td>
              <td className="py-1 pr-2">{r.spec_words}</td>
              <td className="py-1 pr-2">{r.chat_words}</td>
              <td className="py-1 pr-2">{r.sus}</td>
              <td className="py-1 pr-2">{r.tlx_raw}</td>
              <td className="py-1 pr-2">{r.end_reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
