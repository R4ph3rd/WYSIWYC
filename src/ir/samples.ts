import type { IR, IRNode, PromptClause, StructuredPrompt } from './types';

export interface Sample {
  id: string;
  title: string;
  starterPrompt: string;
  prompt: StructuredPrompt;
  ir: IR;
}

function node(
  id: string,
  role: IRNode['role'],
  parentId: string | null,
  order: number,
  tailwind: string,
  clauseId: string | null,
  content?: string,
): IRNode {
  return {
    id,
    role,
    parentId,
    order,
    content,
    tailwind,
    provenance: { promptClauseId: clauseId, source: 'llm' },
  };
}

function clause(id: string, category: PromptClause['category'], text: string): PromptClause {
  return { id, category, text };
}

// --- Login screen ---------------------------------------------------------

const login: Sample = {
  id: 'login',
  title: 'Login screen',
  starterPrompt:
    'A centered login screen on a soft gradient. A white card with a heading "Welcome back", a subtitle, email and password fields, a primary blue "Sign in" button, and a small "Forgot password?" link.',
  prompt: {
    clauses: [
      clause('clause_1', 'layout', 'Center a card on a soft indigo gradient background'),
      clause('clause_2', 'component', 'A white rounded card with generous padding and a subtle shadow'),
      clause('clause_3', 'content', 'Heading "Welcome back" with a muted subtitle'),
      clause('clause_4', 'component', 'Email and password input fields with labels'),
      clause('clause_5', 'style', 'A full-width primary blue "Sign in" button, rounded'),
      clause('clause_6', 'content', 'A small "Forgot password?" link below the button'),
    ],
  },
  ir: {
    canvas: { w: 1000, h: 700, background: '#eef2ff' },
    nodes: [
      node('node_1', 'frame', null, 0,
        'min-h-full w-full flex items-center justify-center bg-gradient-to-br from-indigo-100 via-white to-sky-100 p-10', 'clause_1'),
      node('node_2', 'container', 'node_1', 0,
        'w-full max-w-sm bg-white rounded-2xl shadow-xl shadow-indigo-100 ring-1 ring-slate-100 p-8 flex flex-col gap-5', 'clause_2'),
      node('node_3', 'heading', 'node_2', 0, 'text-2xl font-semibold tracking-tight text-slate-900', 'clause_3', 'Welcome back'),
      node('node_4', 'text', 'node_2', 1, 'text-sm text-slate-500 -mt-3', 'clause_3', 'Sign in to continue to your workspace.'),
      node('node_5', 'text', 'node_2', 2, 'text-xs font-medium text-slate-600', 'clause_4', 'Email'),
      node('node_6', 'input', 'node_2', 3,
        'w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 -mt-3', 'clause_4', 'you@company.com'),
      node('node_7', 'text', 'node_2', 4, 'text-xs font-medium text-slate-600', 'clause_4', 'Password'),
      node('node_8', 'input', 'node_2', 5,
        'w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 -mt-3', 'clause_4', '••••••••'),
      node('node_9', 'button', 'node_2', 6,
        'w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 transition-colors', 'clause_5', 'Sign in'),
      node('node_10', 'text', 'node_2', 7, 'text-center text-xs text-indigo-600 hover:text-indigo-700 cursor-pointer', 'clause_6', 'Forgot password?'),
    ],
  },
};

// --- Pricing card ---------------------------------------------------------

const pricing: Sample = {
  id: 'pricing',
  title: 'Pricing card',
  starterPrompt:
    'A single highlighted pricing card for a "Pro" plan: a badge, the price $29/mo, a short description, a checklist of four features, and a prominent call-to-action button.',
  prompt: {
    clauses: [
      clause('clause_1', 'layout', 'Center a single pricing card on a light neutral background'),
      clause('clause_2', 'component', 'An elevated white card with a colored top accent for the Pro plan'),
      clause('clause_3', 'content', 'A "Most popular" badge and the plan name "Pro"'),
      clause('clause_4', 'style', 'Large price "$29" with a "/mo" suffix in muted text'),
      clause('clause_5', 'content', 'A checklist of four included features'),
      clause('clause_6', 'style', 'A prominent emerald call-to-action button "Start free trial"'),
    ],
  },
  ir: {
    canvas: { w: 1000, h: 760, background: '#f8fafc' },
    nodes: [
      node('node_1', 'frame', null, 0, 'min-h-full w-full flex items-center justify-center bg-slate-50 p-10', 'clause_1'),
      node('node_2', 'container', 'node_1', 0,
        'w-full max-w-sm bg-white rounded-2xl shadow-2xl shadow-slate-200 ring-1 ring-slate-100 overflow-hidden', 'clause_2'),
      node('node_3', 'container', 'node_2', 0, 'h-2 w-full bg-gradient-to-r from-emerald-400 to-teal-500', 'clause_2'),
      node('node_4', 'container', 'node_2', 1, 'p-8 flex flex-col gap-5', 'clause_2'),
      node('node_5', 'badge', 'node_4', 0,
        'self-start rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-100', 'clause_3', 'Most popular'),
      node('node_6', 'heading', 'node_4', 1, 'text-xl font-semibold text-slate-900', 'clause_3', 'Pro'),
      node('node_7', 'container', 'node_4', 2, 'flex items-baseline gap-1', 'clause_4'),
      node('node_8', 'heading', 'node_7', 0, 'text-4xl font-bold tracking-tight text-slate-900', 'clause_4', '$29'),
      node('node_9', 'text', 'node_7', 1, 'text-sm text-slate-500', 'clause_4', '/mo'),
      node('node_10', 'text', 'node_4', 3, 'flex items-center gap-2 text-sm text-slate-600', 'clause_5', '✓  Unlimited projects'),
      node('node_11', 'text', 'node_4', 4, 'flex items-center gap-2 text-sm text-slate-600', 'clause_5', '✓  Advanced analytics'),
      node('node_12', 'text', 'node_4', 5, 'flex items-center gap-2 text-sm text-slate-600', 'clause_5', '✓  Priority support'),
      node('node_13', 'text', 'node_4', 6, 'flex items-center gap-2 text-sm text-slate-600', 'clause_5', '✓  Custom integrations'),
      node('node_14', 'button', 'node_4', 7,
        'mt-2 w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 transition-colors', 'clause_6', 'Start free trial'),
    ],
  },
};

// --- Dashboard header -----------------------------------------------------

const dashboard: Sample = {
  id: 'dashboard',
  title: 'Dashboard header',
  starterPrompt:
    'A dashboard top bar with a product name on the left, a search field in the middle, and a notifications icon plus a round avatar on the right. Below it, a row of three stat cards.',
  prompt: {
    clauses: [
      clause('clause_1', 'layout', 'A white top bar spanning the width with items spaced apart'),
      clause('clause_2', 'content', 'Product name "Northwind" on the left'),
      clause('clause_3', 'component', 'A search field in the center'),
      clause('clause_4', 'component', 'A notifications icon and a round avatar on the right'),
      clause('clause_5', 'layout', 'Below the bar, a row of three equal stat cards'),
      clause('clause_6', 'content', 'Each stat card shows a label and a large value'),
    ],
  },
  ir: {
    canvas: { w: 1100, h: 520, background: '#f8fafc' },
    nodes: [
      node('node_1', 'frame', null, 0, 'min-h-full w-full bg-slate-50 p-6 flex flex-col gap-6', 'clause_1'),
      node('node_2', 'container', 'node_1', 0,
        'w-full flex items-center justify-between bg-white rounded-xl shadow-sm ring-1 ring-slate-100 px-5 py-3', 'clause_1'),
      node('node_3', 'heading', 'node_2', 0, 'text-lg font-bold tracking-tight text-slate-900', 'clause_2', 'Northwind'),
      node('node_4', 'input', 'node_2', 1,
        'w-80 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-sky-100', 'clause_3', 'Search…'),
      node('node_5', 'container', 'node_2', 2, 'flex items-center gap-3', 'clause_4'),
      node('node_6', 'icon', 'node_5', 0, 'h-9 w-9 grid place-items-center rounded-full bg-slate-100 text-slate-600', 'clause_4', '🔔'),
      node('node_7', 'image', 'node_5', 1, 'h-9 w-9 rounded-full bg-gradient-to-br from-sky-400 to-indigo-500', 'clause_4'),
      node('node_8', 'container', 'node_1', 1, 'grid grid-cols-3 gap-4', 'clause_5'),
      node('node_9', 'container', 'node_8', 0, 'bg-white rounded-xl shadow-sm ring-1 ring-slate-100 p-5 flex flex-col gap-1', 'clause_6'),
      node('node_10', 'text', 'node_9', 0, 'text-xs font-medium uppercase tracking-wide text-slate-400', 'clause_6', 'Revenue'),
      node('node_11', 'heading', 'node_9', 1, 'text-2xl font-bold text-slate-900', 'clause_6', '$48.2k'),
      node('node_12', 'container', 'node_8', 1, 'bg-white rounded-xl shadow-sm ring-1 ring-slate-100 p-5 flex flex-col gap-1', 'clause_6'),
      node('node_13', 'text', 'node_12', 0, 'text-xs font-medium uppercase tracking-wide text-slate-400', 'clause_6', 'Active users'),
      node('node_14', 'heading', 'node_12', 1, 'text-2xl font-bold text-slate-900', 'clause_6', '2,318'),
      node('node_15', 'container', 'node_8', 2, 'bg-white rounded-xl shadow-sm ring-1 ring-slate-100 p-5 flex flex-col gap-1', 'clause_6'),
      node('node_16', 'text', 'node_15', 0, 'text-xs font-medium uppercase tracking-wide text-slate-400', 'clause_6', 'Churn'),
      node('node_17', 'heading', 'node_15', 1, 'text-2xl font-bold text-slate-900', 'clause_6', '$48.2k')
    ],
  },
};

export const SAMPLES: Sample[] = [login, pricing, dashboard];

export function emptyIR(): IR {
  return { nodes: [], canvas: { w: 1000, h: 700, background: '#ffffff' } };
}

export function emptyPrompt(): StructuredPrompt {
  return { clauses: [] };
}
