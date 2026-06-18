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

function clause(
  id: string,
  category: PromptClause['category'],
  text: string,
  alternatives?: string[],
): PromptClause {
  return { id, category, text, ...(alternatives ? { alternatives } : {}) };
}

// --- Login screen ---------------------------------------------------------

const login: Sample = {
  id: 'login',
  title: 'Login screen',
  starterPrompt:
    'A centered login screen on a soft gradient. A white card with a heading "Welcome back", a subtitle, email and password fields, a primary blue "Sign in" button, and a small "Forgot password?" link.',
  prompt: {
    clauses: [
      clause('clause_1', 'layout', 'Center a card on a soft indigo gradient background', [
        'Center a card on a clean white background',
        'Center a card over a full-bleed photo backdrop',
        'Left-align the card beside a marketing panel',
      ]),
      clause('clause_2', 'component', 'A white rounded card with generous padding and a subtle shadow', [
        'A flat bordered card with no shadow',
        'A glassy translucent card with a blur backdrop',
        'A compact card with tight padding',
      ]),
      clause('clause_3', 'content', 'Heading "Welcome back" with a muted subtitle', [
        'Heading "Sign in" with no subtitle',
        'Heading "Hello again" with a friendly subtitle',
        'Heading "Log in to continue"',
      ]),
      clause('clause_4', 'component', 'Email and password input fields with labels', [
        'Email and password fields with placeholder-only labels',
        'A single email field for a magic link',
        'Username and password fields with labels',
      ]),
      clause('clause_5', 'style', 'A full-width primary blue "Sign in" button, rounded', [
        'A full-width emerald "Sign in" button',
        'A pill-shaped gradient "Sign in" button',
        'An outline "Sign in" button',
      ]),
      clause('clause_6', 'content', 'A small "Forgot password?" link below the button', [
        'A "Create an account" link below the button',
        'No helper link',
        'A "Need help signing in?" link',
      ]),
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
      clause('clause_1', 'layout', 'Center a single pricing card on a light neutral background', [
        'Show three pricing tiers side by side',
        'Left-align the card with feature copy beside it',
        'Center the card on a dark background',
      ]),
      clause('clause_2', 'component', 'An elevated white card with a colored top accent for the Pro plan', [
        'A flat bordered card with no accent',
        'A card with a full colored header band',
        'A glassy card with a gradient border',
      ]),
      clause('clause_3', 'content', 'A "Most popular" badge and the plan name "Pro"', [
        'A "Best value" badge and the plan name "Pro"',
        'No badge, just the plan name "Pro"',
        'A "Recommended" badge and the plan name "Team"',
      ]),
      clause('clause_4', 'style', 'Large price "$29" with a "/mo" suffix in muted text', [
        'Show the price as "$290/yr" billed annually',
        'A smaller, lighter price treatment',
        'Price "$29" with a struck-through "$49" original',
      ]),
      clause('clause_5', 'content', 'A checklist of four included features', [
        'A checklist of six included features',
        'A short two-line feature summary',
        'A checklist with some features greyed out',
      ]),
      clause('clause_6', 'style', 'A prominent emerald call-to-action button "Start free trial"', [
        'A prominent indigo "Start free trial" button',
        'An outline "Choose Pro" button',
        'A gradient "Get started" button',
      ]),
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
      clause('clause_1', 'layout', 'A white top bar spanning the width with items spaced apart', [
        'A centered top bar with a max width',
        'A translucent top bar that floats over content',
        'A two-row top bar with tabs below',
      ]),
      clause('clause_2', 'content', 'Product name "Northwind" on the left', [
        'A logo mark plus "Northwind" on the left',
        'Just a logo icon on the left',
        'Product name "Acme" on the left',
      ]),
      clause('clause_3', 'component', 'A search field in the center', [
        'A search field aligned to the right',
        'A command palette trigger instead of a search field',
        'No search field',
      ]),
      clause('clause_4', 'component', 'A notifications icon and a round avatar on the right', [
        'A notifications icon and a square avatar on the right',
        'Just a round avatar on the right',
        'Notifications, messages, and an avatar on the right',
      ]),
      clause('clause_5', 'layout', 'Below the bar, a row of three equal stat cards', [
        'Below the bar, a row of four equal stat cards',
        'A two-column stat layout',
        'A single wide summary card',
      ]),
      clause('clause_6', 'content', 'Each stat card shows a label and a large value', [
        'Each stat card shows a label, value, and trend',
        'Each stat card shows a value and a sparkline',
        'Each stat card shows just a large value',
      ]),
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
      node('node_17', 'heading', 'node_15', 1, 'text-2xl font-bold text-slate-900', 'clause_6', '1.4%'),
    ],
  },
};

// --- Analytics dashboard (dense) -----------------------------------------

const analytics: Sample = {
  id: 'analytics',
  title: 'Analytics dashboard',
  starterPrompt:
    'A full analytics dashboard: a fixed sidebar with nav and a user footer, a top bar with search and a primary action, a row of four stat cards with large values and colored deltas, and below, a revenue bar chart beside a recent-activity list.',
  prompt: {
    clauses: [
      clause('clause_1', 'layout', 'A fixed sidebar beside a fluid main column on a light gray canvas', [
        'A collapsible sidebar beside the main column',
        'A top navigation bar instead of a sidebar',
        'A right-hand sidebar beside the main column',
      ]),
      clause('clause_2', 'component', 'A white sidebar with a brand mark, navigation, and a user footer', [
        'A dark sidebar with a brand mark and navigation',
        'A slim icon-only sidebar',
        'A white sidebar with grouped nav sections',
      ]),
      clause('clause_3', 'content', 'Brand "Northwind" with a gradient logo mark', [
        'Brand "Northwind" with a solid logo mark',
        'Just a logo mark, no wordmark',
        'Brand "Acme Analytics" with a logo mark',
      ]),
      clause('clause_4', 'component', 'A vertical list of navigation links', [
        'Navigation links grouped under section headers',
        'Navigation links with icons and counts',
        'A compact icon-only navigation',
      ]),
      clause('clause_5', 'style', 'The current page link is highlighted in the primary indigo', [
        'The current link is highlighted with a left accent bar',
        'The current link is highlighted in a subtle gray',
        'The current link is bold with no background',
      ]),
      clause('clause_6', 'component', 'A user footer with avatar, name, and email', [
        'A user footer with avatar and name only',
        'A user footer with a sign-out button',
        'A user menu trigger in the footer',
      ]),
      clause('clause_7', 'style', 'The user avatar is round', [
        'The user avatar is a rounded square',
        'The user avatar is a plain square',
        'The avatar shows initials in a circle',
      ]),
      clause('clause_8', 'layout', 'A top bar: page title on the left, actions on the right', [
        'A top bar with breadcrumbs on the left',
        'A centered page title with actions below',
        'A top bar with tabs and actions',
      ]),
      clause('clause_9', 'content', 'Page title "Dashboard"', [
        'Page title "Overview"',
        'Page title "Home"',
        'A breadcrumb trail ending in "Dashboard"',
      ]),
      clause('clause_10', 'component', 'A search field in the top bar', [
        'A command palette trigger in the top bar',
        'A date-range picker in the top bar',
        'No search field in the top bar',
      ]),
      clause('clause_11', 'component', 'A notifications icon', [
        'A notifications icon with an unread badge',
        'Notifications and messages icons',
        'No notifications icon',
      ]),
      clause('clause_12', 'component', 'A primary "New report" button', [
        'A primary "Export" button',
        'A split "New report" button with a menu',
        'An icon-only add button',
      ]),
      clause('clause_13', 'layout', 'Below the bar, a row of four equal stat cards', [
        'A row of three equal stat cards',
        'A row of four cards with the first emphasized',
        'A two-by-two grid of stat cards',
      ]),
      clause('clause_14', 'component', 'Each stat card shows a label, a value, and a change', [
        'Each stat card shows a label, value, and a sparkline',
        'Each stat card shows a value and label only',
        'Each stat card adds an icon beside the label',
      ]),
      clause('clause_15', 'style', 'Stat values are large and bold', [
        'Stat values are medium-weight',
        'Stat values are extra-large and light',
        'Stat values use a monospace numeric font',
      ]),
      clause('clause_16', 'style', 'Positive changes are green, negative ones red', [
        'Changes use neutral gray with up/down arrows',
        'Positive changes are indigo, negative ones rose',
        'Changes are shown as small pills',
      ]),
      clause('clause_17', 'layout', 'A wide revenue chart beside a recent-activity list', [
        'A full-width revenue chart above the activity list',
        'Two equal columns: chart and activity',
        'A chart beside a list of top customers',
      ]),
      clause('clause_18', 'component', 'A card charting revenue over time as bars', [
        'A card charting revenue as a line',
        'A card with an area chart',
        'A card with stacked bars by segment',
      ]),
      clause('clause_19', 'style', 'Bars rise in the primary indigo, the latest tallest', [
        'Bars use a green-to-indigo gradient',
        'Bars are a flat neutral gray',
        'Only the latest bar is colored, the rest muted',
      ]),
      clause('clause_20', 'component', 'A recent-activity list with avatar rows', [
        'A recent-activity list with icon rows',
        'A timeline of recent activity',
        'A compact text-only activity list',
      ]),
      clause('clause_21', 'content', 'Three recent activity entries', [
        'Five recent activity entries',
        'A single highlighted recent entry',
        'Recent entries grouped by day',
      ]),
    ],
  },
  ir: {
    canvas: { w: 1200, h: 780, background: '#f1f5f9' },
    nodes: [
      node('node_1', 'frame', null, 0, 'min-h-full w-full flex bg-slate-100 text-slate-800', 'clause_1'),

      // Sidebar
      node('node_2', 'container', 'node_1', 0,
        'w-60 shrink-0 bg-white border-r border-slate-200 flex flex-col', 'clause_2'),
      node('node_3', 'container', 'node_2', 0, 'flex items-center gap-2.5 px-5 py-4', 'clause_3'),
      node('node_4', 'image', 'node_3', 0,
        'h-8 w-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 shadow-sm', 'clause_3'),
      node('node_5', 'heading', 'node_3', 1, 'text-base font-bold tracking-tight text-slate-900', 'clause_3', 'Northwind'),
      node('node_6', 'container', 'node_2', 1, 'flex flex-col gap-1 px-3 py-2', 'clause_4'),
      node('node_7', 'container', 'node_6', 0,
        'flex items-center gap-2.5 rounded-lg bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700', 'clause_5', '📊  Dashboard'),
      node('node_8', 'container', 'node_6', 1,
        'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-50', 'clause_4', '📈  Analytics'),
      node('node_9', 'container', 'node_6', 2,
        'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-50', 'clause_4', '👥  Customers'),
      node('node_10', 'container', 'node_6', 3,
        'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-50', 'clause_4', '⚙️  Settings'),
      node('node_11', 'container', 'node_2', 2, 'mt-auto flex items-center gap-3 border-t border-slate-100 px-5 py-4', 'clause_6'),
      node('node_12', 'image', 'node_11', 0, 'h-9 w-9 rounded-full bg-gradient-to-br from-sky-400 to-indigo-500', 'clause_7'),
      node('node_13', 'container', 'node_11', 1, 'flex flex-col leading-tight', 'clause_6'),
      node('node_14', 'text', 'node_13', 0, 'text-xs font-semibold text-slate-800', 'clause_6', 'Ada Lovelace'),
      node('node_15', 'text', 'node_13', 1, 'text-[11px] text-slate-400', 'clause_6', 'ada@northwind.io'),

      // Main column
      node('node_16', 'container', 'node_1', 1, 'flex-1 min-w-0 flex flex-col', 'clause_1'),
      node('node_17', 'container', 'node_16', 0,
        'flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3', 'clause_8'),
      node('node_18', 'heading', 'node_17', 0, 'text-lg font-semibold tracking-tight text-slate-900', 'clause_9', 'Dashboard'),
      node('node_19', 'container', 'node_17', 1, 'flex items-center gap-3', 'clause_8'),
      node('node_20', 'input', 'node_19', 0,
        'w-64 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-indigo-100', 'clause_10', 'Search…'),
      node('node_21', 'icon', 'node_19', 1, 'grid h-9 w-9 place-items-center rounded-lg bg-slate-100 text-slate-600', 'clause_11', '🔔'),
      node('node_22', 'button', 'node_19', 2,
        'rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 transition-colors', 'clause_12', 'New report'),

      // Scrollable content
      node('node_23', 'container', 'node_16', 1, 'flex-1 overflow-auto p-6 flex flex-col gap-6', 'clause_1'),

      // Stat cards row
      node('node_24', 'container', 'node_23', 0, 'grid grid-cols-4 gap-4', 'clause_13'),
      node('node_25', 'container', 'node_24', 0, 'bg-white rounded-xl ring-1 ring-slate-100 shadow-sm p-5 flex flex-col gap-1.5', 'clause_14'),
      node('node_26', 'text', 'node_25', 0, 'text-xs font-medium uppercase tracking-wide text-slate-400', 'clause_14', 'Revenue'),
      node('node_27', 'heading', 'node_25', 1, 'text-2xl font-bold tracking-tight text-slate-900', 'clause_15', '$48.2k'),
      node('node_28', 'text', 'node_25', 2, 'text-xs font-medium text-emerald-600', 'clause_16', '▲ 12.4% vs last month'),
      node('node_29', 'container', 'node_24', 1, 'bg-white rounded-xl ring-1 ring-slate-100 shadow-sm p-5 flex flex-col gap-1.5', 'clause_14'),
      node('node_30', 'text', 'node_29', 0, 'text-xs font-medium uppercase tracking-wide text-slate-400', 'clause_14', 'Active users'),
      node('node_31', 'heading', 'node_29', 1, 'text-2xl font-bold tracking-tight text-slate-900', 'clause_15', '2,318'),
      node('node_32', 'text', 'node_29', 2, 'text-xs font-medium text-emerald-600', 'clause_16', '▲ 4.1% vs last month'),
      node('node_33', 'container', 'node_24', 2, 'bg-white rounded-xl ring-1 ring-slate-100 shadow-sm p-5 flex flex-col gap-1.5', 'clause_14'),
      node('node_34', 'text', 'node_33', 0, 'text-xs font-medium uppercase tracking-wide text-slate-400', 'clause_14', 'Conversion'),
      node('node_35', 'heading', 'node_33', 1, 'text-2xl font-bold tracking-tight text-slate-900', 'clause_15', '3.6%'),
      node('node_36', 'text', 'node_33', 2, 'text-xs font-medium text-emerald-600', 'clause_16', '▲ 0.8% vs last month'),
      node('node_37', 'container', 'node_24', 3, 'bg-white rounded-xl ring-1 ring-slate-100 shadow-sm p-5 flex flex-col gap-1.5', 'clause_14'),
      node('node_38', 'text', 'node_37', 0, 'text-xs font-medium uppercase tracking-wide text-slate-400', 'clause_14', 'Churn'),
      node('node_39', 'heading', 'node_37', 1, 'text-2xl font-bold tracking-tight text-slate-900', 'clause_15', '1.4%'),
      node('node_40', 'text', 'node_37', 2, 'text-xs font-medium text-rose-600', 'clause_16', '▼ 0.3% vs last month'),

      // Lower row: chart + activity
      node('node_41', 'container', 'node_23', 1, 'grid grid-cols-3 gap-4', 'clause_17'),
      node('node_42', 'container', 'node_41', 0,
        'col-span-2 bg-white rounded-xl ring-1 ring-slate-100 shadow-sm p-5 flex flex-col gap-4', 'clause_18'),
      node('node_43', 'container', 'node_42', 0, 'flex items-center justify-between', 'clause_18'),
      node('node_44', 'heading', 'node_43', 0, 'text-sm font-semibold text-slate-900', 'clause_18', 'Revenue over time'),
      node('node_45', 'text', 'node_43', 1, 'text-xs text-slate-400', 'clause_18', 'Last 6 months'),
      node('node_46', 'container', 'node_42', 1, 'flex items-end gap-3 h-40', 'clause_19'),
      node('node_47', 'container', 'node_46', 0, 'flex-1 rounded-t-md bg-indigo-200 h-16', 'clause_19'),
      node('node_48', 'container', 'node_46', 1, 'flex-1 rounded-t-md bg-indigo-300 h-24', 'clause_19'),
      node('node_49', 'container', 'node_46', 2, 'flex-1 rounded-t-md bg-indigo-300 h-20', 'clause_19'),
      node('node_50', 'container', 'node_46', 3, 'flex-1 rounded-t-md bg-indigo-400 h-32', 'clause_19'),
      node('node_51', 'container', 'node_46', 4, 'flex-1 rounded-t-md bg-indigo-400 h-28', 'clause_19'),
      node('node_52', 'container', 'node_46', 5, 'flex-1 rounded-t-md bg-indigo-600 h-40', 'clause_19'),
      node('node_53', 'container', 'node_41', 1, 'bg-white rounded-xl ring-1 ring-slate-100 shadow-sm p-5 flex flex-col gap-3', 'clause_20'),
      node('node_54', 'heading', 'node_53', 0, 'text-sm font-semibold text-slate-900', 'clause_20', 'Recent activity'),
      node('node_55', 'container', 'node_53', 1, 'flex items-center gap-3', 'clause_21'),
      node('node_56', 'image', 'node_55', 0, 'h-7 w-7 rounded-full bg-slate-200', 'clause_21'),
      node('node_57', 'text', 'node_55', 1, 'text-sm text-slate-600', 'clause_21', 'Maya added a new customer'),
      node('node_58', 'container', 'node_53', 2, 'flex items-center gap-3', 'clause_21'),
      node('node_59', 'image', 'node_58', 0, 'h-7 w-7 rounded-full bg-slate-200', 'clause_21'),
      node('node_60', 'text', 'node_58', 1, 'text-sm text-slate-600', 'clause_21', 'Invoice #1043 was paid'),
      node('node_61', 'container', 'node_53', 3, 'flex items-center gap-3', 'clause_21'),
      node('node_62', 'image', 'node_61', 0, 'h-7 w-7 rounded-full bg-slate-200', 'clause_21'),
      node('node_63', 'text', 'node_61', 1, 'text-sm text-slate-600', 'clause_21', 'Server usage hit 80%'),
    ],
  },
};

export const SAMPLES: Sample[] = [login, pricing, dashboard, analytics];

export function emptyIR(): IR {
  return { nodes: [], canvas: { w: 1000, h: 700, background: '#ffffff' } };
}

export function emptyPrompt(): StructuredPrompt {
  return { clauses: [] };
}
