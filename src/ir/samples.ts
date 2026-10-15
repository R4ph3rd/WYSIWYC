import type { IR, IRNode, NodeStyle, PromptClause, StructuredPrompt } from './types';

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

/** Attach a structured style block (used for each sample's typeface on its root frame). */
function styled(n: IRNode, style: NodeStyle): IRNode {
  return { ...n, style };
}

function clause(
  id: string,
  category: PromptClause['category'],
  text: string,
  alternatives?: string[],
): PromptClause {
  return { id, category, text, ...(alternatives ? { alternatives } : {}) };
}

/**
 * Each sample owns a small design system: one typeface (loaded lazily from
 * Google Fonts via the root frame's style.fontFamily, with a system fallback so
 * it still renders offline), a palette, a radius scale and an elevation recipe.
 * Icon nodes name a drawn glyph (see render/icons.tsx), never an emoji.
 */
const SANS_FALLBACK = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

// --- Login screen ---------------------------------------------------------
// Medora — patient portal for a health-booking service (Doctolib register).
// Figtree · slate ink · clinical blue-600 primary · 8px controls / 16px card ·
// hairline border + long soft shadow.

const MEDORA = {
  label: 'text-[13px] font-medium text-slate-700',
  input:
    'h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 shadow-[0_1px_2px_rgba(15,23,42,0.05)] outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100',
  ghostButton:
    'inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-[0_1px_2px_rgba(15,23,42,0.05)] hover:bg-slate-50 transition-colors',
};

const login: Sample = {
  id: 'login',
  title: 'Login screen',
  starterPrompt:
    'A patient sign-in screen for a health-booking service, centred on a soft white-to-sky gradient. A white card with the "Medora" brand mark, the heading "Welcome back", a subtitle, labelled email and password fields with a "Forgot password?" link, a full-width blue "Sign in" button, passkey and email-link options, and a sign-up footer.',
  prompt: {
    clauses: [
      clause('clause_1', 'layout', 'Center the card on a soft gradient from white to sky', [
        'Center the card on a clean white background',
        'Center the card over a full-bleed clinic photo',
        'Left-align the card beside a reassurance panel',
      ]),
      clause('clause_2', 'component', 'A white card with a hairline border, a soft shadow and the "Medora" brand mark', [
        'A flat bordered card with no shadow',
        'A borderless card with a deeper shadow',
        'A compact card with tight padding',
      ]),
      clause('clause_3', 'content', 'Heading "Welcome back" with a short muted subtitle', [
        'Heading "Sign in" with no subtitle',
        'Heading "Hello again" with a friendly subtitle',
        'Heading "Log in to your patient account"',
      ]),
      clause('clause_4', 'component', '"Email address" and "Password" fields with labels above', [
        'Email and password fields with placeholder-only labels',
        'A single email field for a magic link',
        'Phone number and password fields with labels',
      ]),
      clause('clause_5', 'style', 'A full-width blue "Sign in" button with rounded corners', [
        'A full-width teal "Sign in" button',
        'A pill-shaped "Sign in" button',
        'An outline "Sign in" button',
      ]),
      clause('clause_6', 'content', 'A "Forgot password?" link beside the password label', [
        'A "Forgot password?" link below the button',
        'No helper link',
        'A "Need help signing in?" link',
      ]),
      clause('clause_7', 'component', 'Passkey and email-link sign-in buttons under an "or" divider', [
        'A single "Use a passkey" button',
        'No alternative sign-in',
        'Passkey, email link and SMS code buttons',
      ]),
      clause('clause_8', 'component', 'A "Keep me signed in" checkbox and a sign-up footer band', [
        'A "Keep me signed in" toggle',
        'No remember-me option',
        'A sign-up link only, no footer band',
      ]),
      clause('clause_9', 'content', 'A data-security reassurance line below the card', [
        'A support phone number below the card',
        'No line below the card',
        'Links to privacy policy and terms below the card',
      ]),
    ],
  },
  ir: {
    canvas: { w: 1000, h: 820, background: '#e0f2fe' },
    nodes: [
      styled(
        node('node_1', 'frame', null, 0,
          'min-h-[760px] w-full flex flex-col items-center justify-center gap-6 bg-gradient-to-b from-white to-sky-100 px-6 py-14 text-slate-900 antialiased', 'clause_1'),
        { fontFamily: `'Figtree', ${SANS_FALLBACK}` },
      ),
      node('node_2', 'container', 'node_1', 0,
        'w-full max-w-[400px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_24px_48px_-24px_rgba(15,23,42,0.18)]', 'clause_2'),
      node('node_40', 'container', 'node_2', 0, 'flex flex-col gap-6 px-8 pb-8 pt-7', 'clause_2'),

      // Brand mark
      node('node_11', 'container', 'node_40', 0, 'flex items-center gap-2', 'clause_2'),
      node('node_12', 'icon', 'node_11', 0,
        'grid h-8 w-8 place-items-center rounded-lg bg-blue-600 text-[17px] text-white shadow-[inset_0_-1px_0_rgba(15,23,42,0.2)]', 'clause_2', 'heart-pulse'),
      node('node_13', 'text', 'node_11', 1, 'text-[15px] font-semibold tracking-[-0.01em] text-slate-900', 'clause_2', 'Medora'),

      // Heading
      node('node_26', 'container', 'node_40', 1, 'flex flex-col gap-1.5', 'clause_3'),
      node('node_3', 'heading', 'node_26', 0, 'text-[26px] font-semibold leading-tight tracking-[-0.02em] text-slate-900', 'clause_3', 'Welcome back'),
      node('node_4', 'text', 'node_26', 1, 'text-sm leading-6 text-slate-600', 'clause_3',
        'Sign in to manage appointments, prescriptions and messages from your care team.'),

      // Fields
      node('node_27', 'container', 'node_40', 2, 'flex flex-col gap-4', 'clause_4'),
      node('node_28', 'container', 'node_27', 0, 'flex flex-col gap-1.5', 'clause_4'),
      node('node_5', 'text', 'node_28', 0, MEDORA.label, 'clause_4', 'Email address'),
      node('node_6', 'input', 'node_28', 1, MEDORA.input, 'clause_4', 'camille.martin@email.com'),
      node('node_29', 'container', 'node_27', 1, 'flex flex-col gap-1.5', 'clause_4'),
      node('node_37', 'container', 'node_29', 0, 'flex items-center justify-between', 'clause_4'),
      node('node_7', 'text', 'node_37', 0, MEDORA.label, 'clause_4', 'Password'),
      node('node_10', 'text', 'node_37', 1, 'text-[13px] font-medium text-blue-700 hover:text-blue-800 cursor-pointer', 'clause_6', 'Forgot password?'),
      node('node_8', 'input', 'node_29', 1, MEDORA.input, 'clause_4', 'Enter your password'),

      // Keep me signed in
      node('node_14', 'container', 'node_40', 3, 'flex items-center -mt-1', 'clause_8'),
      node('node_15', 'container', 'node_14', 0, 'flex items-center gap-2 text-[13px] text-slate-700', 'clause_8'),
      node('node_16', 'icon', 'node_15', 0,
        'grid h-4 w-4 place-items-center rounded-[4px] bg-blue-600 text-[11px] text-white shadow-[0_1px_1px_rgba(15,23,42,0.15)]', 'clause_8', 'check'),
      node('node_17', 'text', 'node_15', 1, '', 'clause_8', 'Keep me signed in on this device'),

      node('node_9', 'button', 'node_40', 4,
        'h-10 w-full rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(29,78,216,0.35),inset_0_1px_0_rgba(255,255,255,0.12)] hover:bg-blue-700 transition-colors', 'clause_5', 'Sign in'),

      // Divider
      node('node_18', 'container', 'node_40', 5, 'flex items-center gap-3 text-xs text-slate-500', 'clause_7'),
      node('node_19', 'container', 'node_18', 0, 'h-px flex-1 bg-slate-200', 'clause_7'),
      node('node_20', 'text', 'node_18', 1, '', 'clause_7', 'or'),
      node('node_21', 'container', 'node_18', 2, 'h-px flex-1 bg-slate-200', 'clause_7'),

      // Alternative sign-in
      node('node_22', 'container', 'node_40', 6, 'grid grid-cols-2 gap-3', 'clause_7'),
      node('node_23', 'button', 'node_22', 0, MEDORA.ghostButton, 'clause_7'),
      node('node_30', 'icon', 'node_23', 0, 'text-[16px] text-slate-500', 'clause_7', 'fingerprint'),
      node('node_31', 'text', 'node_23', 1, '', 'clause_7', 'Passkey'),
      node('node_24', 'button', 'node_22', 1, MEDORA.ghostButton, 'clause_7'),
      node('node_32', 'icon', 'node_24', 0, 'text-[16px] text-slate-500', 'clause_7', 'mail'),
      node('node_33', 'text', 'node_24', 1, '', 'clause_7', 'Email me a link'),

      // Footer band
      node('node_25', 'container', 'node_2', 1,
        'flex items-center justify-center gap-1.5 border-t border-slate-200 bg-slate-50 px-8 py-4 text-[13px]', 'clause_8'),
      node('node_38', 'text', 'node_25', 0, 'text-slate-600', 'clause_8', 'New to Medora?'),
      node('node_39', 'text', 'node_25', 1, 'font-medium text-blue-700 hover:text-blue-800 cursor-pointer', 'clause_8', 'Create an account'),

      // Reassurance
      node('node_34', 'container', 'node_1', 1, 'flex items-center gap-2 text-xs text-slate-600', 'clause_9'),
      node('node_35', 'icon', 'node_34', 0, 'text-[14px] text-sky-700', 'clause_9', 'shield-check'),
      node('node_36', 'text', 'node_34', 1, '', 'clause_9', 'Health data encrypted and hosted in certified data centres'),
    ],
  },
};

// --- Pricing card ---------------------------------------------------------
// Tally — invoicing & payments (Stripe register).
// Instrument Sans · navy ink #0a2540 on #f6f9fc · emerald action · 8px
// controls / 16px card · Stripe's long, cool two-layer elevation.

const TALLY = {
  ink: 'text-[#0a2540]',
  body: 'text-[#425466]',
  feature: 'flex items-start gap-3 text-sm leading-5 text-[#425466]',
  check: 'mt-px grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-emerald-50 text-[12px] text-emerald-600 ring-1 ring-emerald-200',
};

const pricingFeatures: Array<[string, string, string, string]> = [
  ['node_10', 'node_40', 'node_46', 'Unlimited invoices, quotes and payment links'],
  ['node_11', 'node_41', 'node_47', 'Revenue analytics with cohort reports'],
  ['node_12', 'node_42', 'node_48', 'Priority support, 4-hour response time'],
  ['node_13', 'node_43', 'node_49', 'Accounting sync with Xero and QuickBooks'],
  ['node_19', 'node_44', 'node_50', 'SAML single sign-on (SSO)'],
  ['node_20', 'node_45', 'node_51', 'Audit log and CSV exports'],
];

const pricing: Sample = {
  id: 'pricing',
  title: 'Pricing card',
  starterPrompt:
    'A pricing page for an invoicing product: a short heading above a single elevated card for the "Pro" plan with an emerald-to-teal accent, a "Most popular" badge, a monthly/annual toggle, the price $29 per seat/month, an emerald "Start 14-day free trial" button, and a checklist of six features.',
  prompt: {
    clauses: [
      clause('clause_1', 'layout', 'Center a single pricing card under a short page heading on a light neutral background', [
        'Show three pricing tiers side by side',
        'Left-align the card with feature copy beside it',
        'Center the card on a dark navy background',
      ]),
      clause('clause_2', 'component', 'An elevated white card with an emerald-to-teal gradient accent along its top', [
        'A flat bordered card with no accent',
        'A card with a full colored header band',
        'A card with a gradient border',
      ]),
      clause('clause_3', 'content', 'The plan name "Pro" with a "Most popular" badge and a one-line description', [
        'A "Best value" badge and the plan name "Pro"',
        'No badge, just the plan name "Pro"',
        'A "Recommended" badge and the plan name "Scale"',
      ]),
      clause('clause_4', 'style', 'Large price "$29" with a muted "per seat / month" suffix', [
        'Show the price as "$290/yr" billed annually',
        'A smaller, lighter price treatment',
        'Price "$29" with a struck-through "$36" original',
      ]),
      clause('clause_5', 'content', 'A checklist of six included features', [
        'A checklist of four included features',
        'A short two-line feature summary',
        'A checklist with some features greyed out',
      ]),
      clause('clause_6', 'style', 'A prominent emerald call-to-action button "Start 14-day free trial"', [
        'A prominent navy "Start 14-day free trial" button',
        'An outline "Choose Pro" button',
        'A "Talk to sales" secondary button beside it',
      ]),
      clause('clause_7', 'component', 'A monthly / annual billing toggle with a "save 20%" hint', [
        'No billing toggle',
        'A monthly / annual toggle without a hint',
        'A three-way monthly / quarterly / annual toggle',
      ]),
      clause('clause_8', 'content', 'A "No credit card required" note and a "Compare all plans" link', [
        'Just a "No credit card required" note',
        'A 30-day money-back guarantee note',
        'No footnote',
      ]),
    ],
  },
  ir: {
    canvas: { w: 1000, h: 900, background: '#f6f9fc' },
    nodes: [
      styled(
        node('node_1', 'frame', null, 0,
          `min-h-[820px] w-full flex flex-col items-center gap-9 bg-[#f6f9fc] px-6 py-12 ${TALLY.ink} antialiased`, 'clause_1'),
        { fontFamily: `'Instrument Sans', ${SANS_FALLBACK}` },
      ),

      // Page heading
      node('node_23', 'container', 'node_1', 0, 'flex max-w-xl flex-col items-center gap-2 text-center', 'clause_1'),
      node('node_24', 'heading', 'node_23', 0, `text-[30px] font-semibold leading-tight tracking-[-0.025em] ${TALLY.ink}`, 'clause_1',
        'Pricing that scales with your revenue'),
      node('node_25', 'text', 'node_23', 1, `text-[15px] leading-6 ${TALLY.body}`, 'clause_1',
        'Every plan includes 135+ currencies, automatic tax and two-day payouts.'),

      // Card
      node('node_2', 'container', 'node_1', 1,
        'w-full max-w-[400px] overflow-hidden rounded-2xl border border-[#e3e8ee] bg-white shadow-[0_30px_60px_-12px_rgba(50,50,93,0.18),0_18px_36px_-18px_rgba(0,0,0,0.22)]', 'clause_2'),
      node('node_3', 'container', 'node_2', 0, 'h-1 w-full bg-gradient-to-r from-emerald-400 to-teal-500', 'clause_2'),
      node('node_4', 'container', 'node_2', 1, 'flex flex-col gap-6 p-8', 'clause_2'),

      // Plan
      node('node_27', 'container', 'node_4', 0, 'flex flex-col gap-1.5', 'clause_3'),
      node('node_26', 'container', 'node_27', 0, 'flex items-center justify-between', 'clause_3'),
      node('node_6', 'heading', 'node_26', 0, `text-lg font-semibold tracking-[-0.01em] ${TALLY.ink}`, 'clause_3', 'Pro'),
      node('node_5', 'badge', 'node_26', 1,
        'rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200', 'clause_3', 'Most popular'),
      node('node_15', 'text', 'node_27', 1, `text-sm leading-6 ${TALLY.body}`, 'clause_3', 'For teams sending 200+ invoices a month.'),

      // Billing toggle
      node('node_16', 'container', 'node_4', 1,
        'grid grid-cols-2 gap-1 rounded-lg border border-[#e3e8ee] bg-[#f6f9fc] p-1 text-[13px]', 'clause_7'),
      node('node_17', 'text', 'node_16', 0, `rounded-md py-1.5 text-center ${TALLY.body} cursor-pointer`, 'clause_7', 'Monthly'),
      node('node_18', 'text', 'node_16', 1,
        `rounded-md bg-white py-1.5 text-center font-medium ${TALLY.ink} shadow-[0_1px_2px_rgba(10,37,64,0.08),0_0_0_1px_rgba(10,37,64,0.06)] cursor-pointer`, 'clause_7', 'Annual · save 20%'),

      // Price
      node('node_28', 'container', 'node_4', 2, 'flex flex-col gap-1.5', 'clause_4'),
      node('node_7', 'container', 'node_28', 0, 'flex items-baseline gap-2', 'clause_4'),
      node('node_8', 'heading', 'node_7', 0, `text-[44px] font-semibold leading-none tracking-[-0.03em] tabular-nums ${TALLY.ink}`, 'clause_4', '$29'),
      node('node_9', 'text', 'node_7', 1, `text-sm ${TALLY.body}`, 'clause_4', 'per seat / month'),
      node('node_29', 'text', 'node_28', 1, 'text-[13px] tabular-nums text-[#697386]', 'clause_4', 'Billed annually at $348 per seat'),

      // CTA
      node('node_30', 'container', 'node_4', 3, 'flex flex-col gap-2.5', 'clause_6'),
      node('node_14', 'button', 'node_30', 0,
        'h-11 w-full rounded-lg bg-emerald-600 px-4 text-[15px] font-semibold text-white shadow-[0_1px_2px_rgba(4,120,87,0.4),inset_0_1px_0_rgba(255,255,255,0.15)] hover:bg-emerald-700 transition-colors', 'clause_6', 'Start 14-day free trial'),
      node('node_21', 'text', 'node_30', 1, 'text-center text-xs text-[#697386]', 'clause_8', 'No credit card required · Cancel anytime'),

      // Features
      node('node_31', 'container', 'node_4', 4, 'h-px w-full bg-[#e3e8ee]', 'clause_5'),
      node('node_32', 'container', 'node_4', 5, 'flex flex-col gap-3', 'clause_5'),
      node('node_33', 'text', 'node_32', 0, `text-[13px] font-medium ${TALLY.ink}`, 'clause_5', 'Everything in Starter, plus:'),
      ...pricingFeatures.flatMap(([row, icon, label, text], i) => [
        node(row, 'container', 'node_32', i + 1, TALLY.feature, 'clause_5'),
        node(icon, 'icon', row, 0, TALLY.check, 'clause_5', 'check'),
        node(label, 'text', row, 1, '', 'clause_5', text),
      ]),

      node('node_22', 'container', 'node_4', 6,
        'flex items-center justify-center gap-1 text-[13px] font-medium text-emerald-700 hover:text-emerald-800 cursor-pointer', 'clause_8'),
      node('node_52', 'text', 'node_22', 0, '', 'clause_8', 'Compare all plans'),
      node('node_53', 'icon', 'node_22', 1, 'text-[14px]', 'clause_8', 'arrow-right'),
    ],
  },
};

// --- Dashboard header -----------------------------------------------------
// Northwind (night) — Linear/Vercel register: near-black zinc-950 ground,
// white/10 hairlines instead of cards, Inter with tight tracking, a single
// indigo accent reserved for data, green/red only for change.

const NIGHT = {
  hairline: 'border-white/10',
  tab: 'border-b-2 border-transparent -mb-px py-3 text-[13px] text-zinc-400 hover:text-zinc-200 cursor-pointer',
  statLabel: 'text-[13px] text-zinc-400',
  statValue: 'text-[28px] font-semibold leading-none tracking-[-0.025em] tabular-nums text-zinc-50',
  deltaRow: 'flex items-center gap-2 whitespace-nowrap text-xs',
  muted: 'text-zinc-500',
  bar: 'rounded-t-[3px]',
  month: 'text-center',
};

const dashboard: Sample = {
  id: 'dashboard',
  title: 'Dashboard header',
  starterPrompt:
    'A dark dashboard top bar with the product name "Northwind" on the left, a search field in the middle, and a "New" button, a notifications icon and a round avatar on the right. Underlined tabs below, then a "Last 30 days" date-range picker with a calendar icon, three stats in one divided panel with green/red changes, and a monthly revenue bar chart.',
  prompt: {
    clauses: [
      clause('clause_1', 'layout', 'A dark top bar spanning the width with items spaced apart', [
        'A centered top bar with a max width',
        'A light top bar with a hairline border',
        'A two-row top bar with tabs inside',
      ]),
      clause('clause_2', 'content', 'Product name "Northwind" beside a sky-to-indigo gradient logo mark', [
        'Product name "Northwind" beside a solid logo mark',
        'Just a logo mark on the left',
        'Product name "Acme" with a workspace switcher',
      ]),
      clause('clause_3', 'component', 'A search field with a ⌘K hint in the center', [
        'A search field aligned to the right',
        'A command palette button instead of a search field',
        'No search field',
      ]),
      clause('clause_4', 'component', 'A "New" button, a notifications icon and a round avatar on the right', [
        'A notifications icon and a square avatar on the right',
        'Just a round avatar on the right',
        'Notifications, messages, and an avatar on the right',
      ]),
      clause('clause_5', 'layout', 'Below the bar, three equal stats in one divided panel', [
        'Below the bar, four equal stat cards',
        'Three separate stat cards with gaps',
        'A single wide summary stat',
      ]),
      clause('clause_6', 'content', 'Each stat shows a label and a large value', [
        'Each stat shows a label, value, and sparkline',
        'Each stat shows just a large value',
        'Each stat adds an icon beside the label',
      ]),
      clause('clause_7', 'component', 'A row of underlined navigation tabs below the bar', [
        'Pill-shaped navigation tabs below the bar',
        'A breadcrumb trail instead of tabs',
        'No navigation tabs',
      ]),
      clause('clause_8', 'style', 'Each stat shows its change vs last period: green when up, red when down', [
        'Changes use neutral gray with up/down arrows',
        'Changes are shown as small tinted pills',
        'No change indicator',
      ]),
      clause('clause_9', 'component', 'A monthly revenue bar chart spanning the width below the stats', [
        'A line chart below the stats',
        'A recent-activity list below the stats',
        'No chart',
      ]),
      clause('clause_10', 'component', 'A "Last 30 days" date-range picker with a calendar icon', [
        'A segmented 7d / 30d / 90d period switch',
        'A date-range picker without an icon',
        'No date-range picker',
      ]),
    ],
  },
  ir: {
    canvas: { w: 1100, h: 820, background: '#09090b' },
    nodes: [
      styled(
        node('node_1', 'frame', null, 0, 'min-h-[720px] w-full flex flex-col bg-zinc-950 text-zinc-100 antialiased', 'clause_1'),
        { fontFamily: `'Inter', ${SANS_FALLBACK}` },
      ),

      // Top bar
      node('node_2', 'container', 'node_1', 0,
        `flex h-14 items-center justify-between gap-6 border-b ${NIGHT.hairline} bg-zinc-950 px-5`, 'clause_1'),
      node('node_18', 'container', 'node_2', 0, 'flex items-center gap-2', 'clause_2'),
      node('node_19', 'image', 'node_18', 0,
        'h-6 w-6 rounded-md bg-gradient-to-br from-sky-400 to-indigo-600 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)]', 'clause_2'),
      node('node_3', 'heading', 'node_18', 1, 'text-sm font-semibold tracking-[-0.01em] text-zinc-50', 'clause_2', 'Northwind'),
      node('node_39', 'icon', 'node_18', 2, 'text-[14px] text-zinc-500', 'clause_2', 'chevrons-up-down'),

      node('node_40', 'container', 'node_2', 1, 'relative w-full max-w-xs', 'clause_3'),
      node('node_41', 'icon', 'node_40', 0, 'pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[14px] text-zinc-500', 'clause_3', 'search'),
      node('node_4', 'input', 'node_40', 1,
        `h-8 w-full rounded-md border ${NIGHT.hairline} bg-white/[0.04] pl-8 pr-10 text-[13px] text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-white/20`, 'clause_3', 'Search customers, orders…'),
      node('node_42', 'text', 'node_40', 2,
        `pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border ${NIGHT.hairline} px-1 text-[10px] font-medium leading-4 text-zinc-500`, 'clause_3', '⌘K'),

      node('node_5', 'container', 'node_2', 2, 'flex items-center gap-1.5', 'clause_4'),
      node('node_20', 'button', 'node_5', 0,
        'mr-1.5 inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-zinc-50 px-3 text-[13px] font-medium text-zinc-950 hover:bg-white transition-colors', 'clause_4'),
      node('node_43', 'icon', 'node_20', 0, 'text-[14px]', 'clause_4', 'plus'),
      node('node_44', 'text', 'node_20', 1, '', 'clause_4', 'New'),
      node('node_45', 'container', 'node_5', 1, 'relative', 'clause_4'),
      node('node_6', 'icon', 'node_45', 0,
        'grid h-8 w-8 place-items-center rounded-md text-[16px] text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200', 'clause_4', 'bell'),
      node('node_46', 'badge', 'node_45', 1, 'absolute right-[7px] top-[7px] h-1.5 w-1.5 rounded-full bg-indigo-400 ring-2 ring-zinc-950', 'clause_4'),
      node('node_7', 'image', 'node_5', 2, 'ml-1 h-7 w-7 rounded-full bg-gradient-to-br from-amber-300 to-rose-500 ring-1 ring-white/15', 'clause_4'),

      // Tabs
      node('node_21', 'container', 'node_1', 1, `flex items-center gap-6 border-b ${NIGHT.hairline} px-5`, 'clause_7'),
      node('node_22', 'text', 'node_21', 0,
        '-mb-px border-b-2 border-zinc-100 py-3 text-[13px] font-medium text-zinc-50 cursor-pointer', 'clause_7', 'Overview'),
      node('node_23', 'text', 'node_21', 1, NIGHT.tab, 'clause_7', 'Reports'),
      node('node_24', 'text', 'node_21', 2, NIGHT.tab, 'clause_7', 'Customers'),
      node('node_47', 'text', 'node_21', 3, NIGHT.tab, 'clause_7', 'Settings'),

      // Content
      node('node_48', 'container', 'node_1', 2, 'flex flex-col gap-5 px-5 py-6', 'clause_5'),
      node('node_49', 'container', 'node_48', 0, 'flex items-end justify-between gap-4', 'clause_10'),
      node('node_50', 'container', 'node_49', 0, 'flex flex-col gap-1', 'clause_10'),
      node('node_51', 'heading', 'node_50', 0, 'text-base font-semibold tracking-[-0.01em] text-zinc-50', 'clause_10', 'Revenue performance'),
      node('node_52', 'text', 'node_50', 1, `text-[13px] ${NIGHT.muted}`, 'clause_10', 'Oct 1 – Oct 31, 2026 · compared with September'),
      node('node_53', 'container', 'node_49', 1,
        `inline-flex h-8 shrink-0 items-center gap-2 whitespace-nowrap rounded-md border ${NIGHT.hairline} bg-white/[0.03] px-2.5 text-[13px] text-zinc-200 hover:bg-white/[0.06] cursor-pointer`, 'clause_10'),
      node('node_54', 'icon', 'node_53', 0, 'text-[14px] text-zinc-400', 'clause_10', 'calendar'),
      node('node_55', 'text', 'node_53', 1, '', 'clause_10', 'Last 30 days'),
      node('node_56', 'icon', 'node_53', 2, 'text-[14px] text-zinc-500', 'clause_10', 'chevron-down'),

      // Stats panel
      node('node_8', 'container', 'node_48', 1,
        `grid grid-cols-3 divide-x divide-white/10 rounded-xl border ${NIGHT.hairline} bg-white/[0.02]`, 'clause_5'),
      node('node_9', 'container', 'node_8', 0, 'flex flex-col gap-3 p-5', 'clause_6'),
      node('node_10', 'text', 'node_9', 0, NIGHT.statLabel, 'clause_6', 'Revenue'),
      node('node_11', 'heading', 'node_9', 1, NIGHT.statValue, 'clause_6', '$48,210'),
      node('node_57', 'container', 'node_9', 2, NIGHT.deltaRow, 'clause_6'),
      node('node_25', 'text', 'node_57', 0, 'font-medium tabular-nums text-green-400', 'clause_8', '+12.4%'),
      node('node_58', 'text', 'node_57', 1, NIGHT.muted, 'clause_6', 'vs September'),
      node('node_12', 'container', 'node_8', 1, 'flex flex-col gap-3 p-5', 'clause_6'),
      node('node_13', 'text', 'node_12', 0, NIGHT.statLabel, 'clause_6', 'Active users'),
      node('node_14', 'heading', 'node_12', 1, NIGHT.statValue, 'clause_6', '2,318'),
      node('node_59', 'container', 'node_12', 2, NIGHT.deltaRow, 'clause_6'),
      node('node_26', 'text', 'node_59', 0, 'font-medium tabular-nums text-green-400', 'clause_8', '+3.2%'),
      node('node_60', 'text', 'node_59', 1, NIGHT.muted, 'clause_6', 'vs September'),
      node('node_15', 'container', 'node_8', 2, 'flex flex-col gap-3 p-5', 'clause_6'),
      node('node_16', 'text', 'node_15', 0, NIGHT.statLabel, 'clause_6', 'Orders'),
      node('node_17', 'heading', 'node_15', 1, NIGHT.statValue, 'clause_6', '342'),
      node('node_61', 'container', 'node_15', 2, NIGHT.deltaRow, 'clause_6'),
      node('node_27', 'text', 'node_61', 0, 'font-medium tabular-nums text-red-400', 'clause_8', '−3.1%'),
      node('node_62', 'text', 'node_61', 1, NIGHT.muted, 'clause_6', 'vs September'),

      // Revenue chart
      node('node_28', 'container', 'node_48', 2,
        `flex flex-col gap-5 rounded-xl border ${NIGHT.hairline} bg-white/[0.02] p-5`, 'clause_9'),
      node('node_29', 'container', 'node_28', 0, 'flex items-start justify-between', 'clause_9'),
      node('node_63', 'container', 'node_29', 0, 'flex flex-col gap-1.5', 'clause_9'),
      node('node_30', 'heading', 'node_63', 0, 'text-[13px] font-medium text-zinc-400', 'clause_9', 'Monthly revenue'),
      node('node_64', 'text', 'node_63', 1, 'text-xl font-semibold tracking-[-0.02em] tabular-nums text-zinc-50', 'clause_9', '$248.6k'),
      node('node_31', 'text', 'node_29', 1, `text-xs ${NIGHT.muted}`, 'clause_9', 'May – Oct 2026'),
      node('node_32', 'container', 'node_28', 1, `grid h-40 grid-cols-6 items-end gap-3 border-b ${NIGHT.hairline}`, 'clause_9'),
      node('node_33', 'container', 'node_32', 0, `${NIGHT.bar} h-16 bg-zinc-800`, 'clause_9'),
      node('node_34', 'container', 'node_32', 1, `${NIGHT.bar} h-24 bg-zinc-800`, 'clause_9'),
      node('node_35', 'container', 'node_32', 2, `${NIGHT.bar} h-20 bg-zinc-800`, 'clause_9'),
      node('node_36', 'container', 'node_32', 3, `${NIGHT.bar} h-32 bg-zinc-800`, 'clause_9'),
      node('node_37', 'container', 'node_32', 4, `${NIGHT.bar} h-28 bg-zinc-800`, 'clause_9'),
      node('node_38', 'container', 'node_32', 5, `${NIGHT.bar} h-40 bg-indigo-500`, 'clause_9'),
      node('node_65', 'container', 'node_28', 2, `-mt-3 grid grid-cols-6 gap-3 text-[11px] tabular-nums ${NIGHT.muted}`, 'clause_9'),
      ...['May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'].map((m, i) =>
        node(`node_${66 + i}`, 'text', 'node_65', i, i === 5 ? `${NIGHT.month} font-medium text-zinc-300` : NIGHT.month, 'clause_9', m),
      ),
    ],
  },
};

// --- Analytics dashboard (dense) -----------------------------------------
// Northwind (day) — crisp neutral SaaS register: zinc-50 canvas, white
// surfaces with zinc-200 hairlines and a 1px shadow, Onest, 6px controls /
// 12px cards, indigo-600 as the one brand accent (selection, primary, data).

const DAY = {
  card: 'rounded-xl border border-zinc-200 bg-white shadow-[0_1px_2px_rgba(24,24,27,0.04)]',
  navItem: 'flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 cursor-pointer',
  navIcon: 'text-[16px] text-zinc-400',
  control:
    'inline-flex h-8 shrink-0 items-center gap-2 whitespace-nowrap rounded-md border border-zinc-200 bg-white px-2.5 text-[13px] font-medium text-zinc-700 shadow-[0_1px_2px_rgba(24,24,27,0.04)] hover:bg-zinc-50 cursor-pointer',
  statLabel: 'truncate text-[13px] text-zinc-500',
  statValue: 'mt-1 text-2xl font-semibold tracking-[-0.02em] tabular-nums text-zinc-900',
  deltaRow: 'mt-1 flex items-center gap-1.5 whitespace-nowrap text-xs',
  deltaMuted: 'text-zinc-400',
  bar: 'rounded-t-[4px]',
  activityRow: 'flex items-start gap-3',
  activityText: 'text-[13px] leading-5 text-zinc-700',
  activityTime: 'text-xs tabular-nums text-zinc-400',
  avatar: 'grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-semibold',
};

const analytics: Sample = {
  id: 'analytics',
  title: 'Analytics dashboard',
  starterPrompt:
    'A full analytics dashboard: a white sidebar with a gradient brand mark, icon navigation and a user footer; a top bar with the page title, search, notifications and a primary "New report" button; a "Last 30 days" date-range picker with a calendar icon; four stat cards with large values and green/red changes; and below, a revenue bar chart beside a recent-activity list.',
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
      clause('clause_3', 'content', 'Brand "Northwind" with a sky-to-indigo gradient logo mark', [
        'Brand "Northwind" with a solid logo mark',
        'Just a logo mark, no wordmark',
        'Brand "Acme Analytics" with a logo mark',
      ]),
      clause('clause_4', 'component', 'A vertical list of navigation links with icons and an invoice count', [
        'Navigation links grouped under section headers',
        'Navigation links without icons',
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
      clause('clause_10', 'component', 'A search field with a ⌘K hint in the top bar', [
        'A command palette button in the top bar',
        'A search field without a shortcut hint',
        'No search field in the top bar',
      ]),
      clause('clause_11', 'component', 'A notifications icon with an unread dot', [
        'A notifications icon with an unread count',
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
      clause('clause_15', 'style', 'Stat values are large and semibold, with tabular figures', [
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
      clause('clause_20', 'component', 'A recent-activity list with avatar and event-icon rows', [
        'A recent-activity list with icon rows only',
        'A timeline of recent activity',
        'A compact text-only activity list',
      ]),
      clause('clause_21', 'content', 'Four recent activity entries with timestamps', [
        'Three recent activity entries',
        'A single highlighted recent entry',
        'Recent entries grouped by day',
      ]),
      clause('clause_22', 'component', 'A "Last 30 days" date-range picker with a calendar icon above the stats', [
        'A segmented 7d / 30d / 90d period switch',
        'A date-range picker in the top bar',
        'No date-range picker',
      ]),
    ],
  },
  ir: {
    canvas: { w: 1200, h: 780, background: '#fafafa' },
    nodes: [
      styled(
        node('node_1', 'frame', null, 0, 'min-h-[max(760px,calc(100vh-96px))] w-full flex bg-zinc-50 text-zinc-900 antialiased', 'clause_1'),
        { fontFamily: `'Onest', ${SANS_FALLBACK}` },
      ),

      // Sidebar
      node('node_2', 'container', 'node_1', 0, 'w-52 shrink-0 flex flex-col border-r border-zinc-200 bg-white', 'clause_2'),
      node('node_3', 'container', 'node_2', 0, 'flex h-14 items-center gap-2.5 px-4', 'clause_3'),
      node('node_4', 'image', 'node_3', 0,
        'h-7 w-7 rounded-lg bg-gradient-to-br from-sky-400 to-indigo-600 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),0_1px_2px_rgba(30,27,75,0.2)]', 'clause_3'),
      node('node_5', 'heading', 'node_3', 1, 'text-[15px] font-semibold tracking-[-0.01em] text-zinc-900', 'clause_3', 'Northwind'),

      node('node_6', 'container', 'node_2', 1, 'flex flex-col gap-0.5 px-2 pt-2', 'clause_4'),
      node('node_7', 'container', 'node_6', 0,
        'flex h-8 items-center gap-2.5 rounded-md bg-indigo-50 px-2.5 text-[13px] font-medium text-indigo-700 cursor-pointer', 'clause_5'),
      node('node_64', 'icon', 'node_7', 0, 'text-[16px] text-indigo-600', 'clause_5', 'layout-dashboard'),
      node('node_65', 'text', 'node_7', 1, '', 'clause_5', 'Dashboard'),
      node('node_8', 'container', 'node_6', 1, DAY.navItem, 'clause_4'),
      node('node_66', 'icon', 'node_8', 0, DAY.navIcon, 'clause_4', 'bar-chart'),
      node('node_67', 'text', 'node_8', 1, '', 'clause_4', 'Analytics'),
      node('node_9', 'container', 'node_6', 2, DAY.navItem, 'clause_4'),
      node('node_68', 'icon', 'node_9', 0, DAY.navIcon, 'clause_4', 'users'),
      node('node_69', 'text', 'node_9', 1, '', 'clause_4', 'Customers'),
      node('node_70', 'container', 'node_6', 3, DAY.navItem, 'clause_4'),
      node('node_71', 'icon', 'node_70', 0, DAY.navIcon, 'clause_4', 'receipt'),
      node('node_72', 'text', 'node_70', 1, '', 'clause_4', 'Invoices'),
      node('node_73', 'badge', 'node_70', 2,
        'ml-auto rounded bg-zinc-100 px-1.5 text-[11px] font-medium leading-5 tabular-nums text-zinc-600', 'clause_4', '12'),
      node('node_10', 'container', 'node_6', 4, DAY.navItem, 'clause_4'),
      node('node_74', 'icon', 'node_10', 0, DAY.navIcon, 'clause_4', 'settings'),
      node('node_75', 'text', 'node_10', 1, '', 'clause_4', 'Settings'),

      node('node_11', 'container', 'node_2', 2, 'mt-auto flex items-center gap-2.5 border-t border-zinc-200 p-3', 'clause_6'),
      node('node_12', 'image', 'node_11', 0, 'h-8 w-8 shrink-0 rounded-full bg-gradient-to-br from-amber-200 to-rose-400 ring-1 ring-black/5', 'clause_7'),
      node('node_13', 'container', 'node_11', 1, 'flex min-w-0 flex-1 flex-col leading-tight', 'clause_6'),
      node('node_14', 'text', 'node_13', 0, 'truncate text-[13px] font-medium text-zinc-900', 'clause_6', 'Ada Lovelace'),
      node('node_15', 'text', 'node_13', 1, 'truncate text-xs text-zinc-500', 'clause_6', 'ada@northwind.io'),
      node('node_76', 'icon', 'node_11', 2, 'text-[14px] text-zinc-400', 'clause_6', 'chevrons-up-down'),

      // Main column
      node('node_16', 'container', 'node_1', 1, 'flex-1 min-w-0 flex flex-col', 'clause_1'),
      node('node_17', 'container', 'node_16', 0,
        'flex h-14 items-center justify-between gap-4 border-b border-zinc-200 bg-white px-6', 'clause_8'),
      node('node_18', 'heading', 'node_17', 0, 'shrink-0 text-[15px] font-semibold tracking-[-0.01em] text-zinc-900', 'clause_9', 'Dashboard'),
      node('node_19', 'container', 'node_17', 1, 'flex min-w-0 flex-1 items-center justify-end gap-2', 'clause_8'),
      node('node_77', 'container', 'node_19', 0, 'relative min-w-0 w-52 shrink', 'clause_10'),
      node('node_78', 'icon', 'node_77', 0, 'pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[14px] text-zinc-400', 'clause_10', 'search'),
      node('node_20', 'input', 'node_77', 1,
        'h-8 w-full rounded-md border border-zinc-200 bg-zinc-50 pl-8 pr-9 text-[13px] text-zinc-900 placeholder:text-zinc-500 outline-none focus:border-zinc-300 focus:bg-white', 'clause_10', 'Search…'),
      node('node_79', 'text', 'node_77', 2,
        'pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-zinc-200 bg-white px-1 text-[10px] font-medium leading-4 text-zinc-500', 'clause_10', '⌘K'),
      node('node_80', 'container', 'node_19', 1, 'relative', 'clause_11'),
      node('node_21', 'icon', 'node_80', 0,
        'grid h-8 w-8 place-items-center rounded-md border border-zinc-200 bg-white text-[15px] text-zinc-600 shadow-[0_1px_2px_rgba(24,24,27,0.04)] hover:bg-zinc-50', 'clause_11', 'bell'),
      node('node_81', 'badge', 'node_80', 1, 'absolute right-[7px] top-[7px] h-1.5 w-1.5 rounded-full bg-red-500 ring-2 ring-white', 'clause_11'),
      node('node_22', 'button', 'node_19', 2,
        'inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-indigo-600 px-3 text-[13px] font-medium text-white shadow-[0_1px_2px_rgba(67,56,202,0.35),inset_0_1px_0_rgba(255,255,255,0.14)] hover:bg-indigo-700 transition-colors', 'clause_12'),
      node('node_82', 'icon', 'node_22', 0, 'text-[15px]', 'clause_12', 'plus'),
      node('node_83', 'text', 'node_22', 1, '', 'clause_12', 'New report'),

      // Scrollable content
      node('node_23', 'container', 'node_16', 1, 'flex-1 flex flex-col gap-4 p-6', 'clause_1'),

      // Period toolbar
      node('node_84', 'container', 'node_23', 0, 'flex items-center justify-between gap-4', 'clause_22'),
      node('node_85', 'text', 'node_84', 0, 'min-w-0 truncate text-[13px] text-zinc-500', 'clause_22', 'Oct 1 – Oct 31, 2026 · vs. previous period'),
      node('node_86', 'container', 'node_84', 1, 'flex items-center gap-2', 'clause_22'),
      node('node_87', 'container', 'node_86', 0, DAY.control, 'clause_22'),
      node('node_88', 'icon', 'node_87', 0, 'text-[14px] text-zinc-500', 'clause_22', 'calendar'),
      node('node_89', 'text', 'node_87', 1, '', 'clause_22', 'Last 30 days'),
      node('node_90', 'icon', 'node_87', 2, 'text-[14px] text-zinc-400', 'clause_22', 'chevron-down'),
      node('node_91', 'container', 'node_86', 1, DAY.control, 'clause_22'),
      node('node_92', 'icon', 'node_91', 0, 'text-[14px] text-zinc-500', 'clause_22', 'download'),
      node('node_93', 'text', 'node_91', 1, '', 'clause_22', 'Export'),

      // Stat cards row
      // One grid holds all four cards, so the row reflows 4 → 2×2 (never
      // 3 + 1) and a card moved in or out keeps every cell the same width.
      node('node_24', 'container', 'node_23', 1, 'grid grid-cols-2 gap-3 lg:grid-cols-4', 'clause_13'),
      node('node_25', 'container', 'node_24', 0, `${DAY.card} flex min-w-0 flex-col p-4`, 'clause_14'),
      node('node_26', 'text', 'node_25', 0, DAY.statLabel, 'clause_14', 'Revenue'),
      node('node_27', 'heading', 'node_25', 1, DAY.statValue, 'clause_15', '$48.2k'),
      node('node_94', 'container', 'node_25', 2, DAY.deltaRow, 'clause_14'),
      node('node_28', 'text', 'node_94', 0, 'font-medium tabular-nums text-green-600', 'clause_16', '+12.4%'),
      node('node_95', 'text', 'node_94', 1, DAY.deltaMuted, 'clause_14', 'vs Sep'),
      node('node_29', 'container', 'node_24', 1, `${DAY.card} flex min-w-0 flex-col p-4`, 'clause_14'),
      node('node_30', 'text', 'node_29', 0, DAY.statLabel, 'clause_14', 'Active users'),
      node('node_31', 'heading', 'node_29', 1, DAY.statValue, 'clause_15', '2,318'),
      node('node_96', 'container', 'node_29', 2, DAY.deltaRow, 'clause_14'),
      node('node_32', 'text', 'node_96', 0, 'font-medium tabular-nums text-green-600', 'clause_16', '+4.1%'),
      node('node_97', 'text', 'node_96', 1, DAY.deltaMuted, 'clause_14', 'vs Sep'),
      node('node_33', 'container', 'node_24', 2, `${DAY.card} flex min-w-0 flex-col p-4`, 'clause_14'),
      node('node_34', 'text', 'node_33', 0, DAY.statLabel, 'clause_14', 'Conversion'),
      node('node_35', 'heading', 'node_33', 1, DAY.statValue, 'clause_15', '3.6%'),
      node('node_98', 'container', 'node_33', 2, DAY.deltaRow, 'clause_14'),
      node('node_36', 'text', 'node_98', 0, 'font-medium tabular-nums text-green-600', 'clause_16', '+0.8 pt'),
      node('node_99', 'text', 'node_98', 1, DAY.deltaMuted, 'clause_14', 'vs Sep'),
      node('node_37', 'container', 'node_24', 3, `${DAY.card} flex min-w-0 flex-col p-4`, 'clause_14'),
      node('node_38', 'text', 'node_37', 0, DAY.statLabel, 'clause_14', 'Avg. order'),
      node('node_39', 'heading', 'node_37', 1, DAY.statValue, 'clause_15', '$86.40'),
      node('node_100', 'container', 'node_37', 2, DAY.deltaRow, 'clause_14'),
      node('node_40', 'text', 'node_100', 0, 'font-medium tabular-nums text-red-600', 'clause_16', '−2.1%'),
      node('node_101', 'text', 'node_100', 1, DAY.deltaMuted, 'clause_14', 'vs Sep'),

      // Lower row: chart + activity
      node('node_41', 'container', 'node_23', 2, 'flex flex-wrap gap-3', 'clause_17'),
      node('node_42', 'container', 'node_41', 0, `flex-[3_1_320px] ${DAY.card} flex flex-col gap-5 p-5`, 'clause_18'),
      node('node_43', 'container', 'node_42', 0, 'flex items-start justify-between', 'clause_18'),
      node('node_102', 'container', 'node_43', 0, 'flex flex-col gap-1', 'clause_18'),
      node('node_44', 'heading', 'node_102', 0, 'text-[13px] font-medium text-zinc-500', 'clause_18', 'Revenue over time'),
      node('node_103', 'container', 'node_102', 1, 'flex items-baseline gap-2', 'clause_18'),
      node('node_104', 'text', 'node_103', 0, 'text-xl font-semibold tracking-[-0.02em] tabular-nums text-zinc-900', 'clause_18', '$248.6k'),
      node('node_105', 'text', 'node_103', 1, 'text-xs font-medium tabular-nums text-green-600', 'clause_16', '+18.2%'),
      node('node_45', 'text', 'node_43', 1, 'whitespace-nowrap text-xs text-zinc-500', 'clause_18', 'Last 6 months'),
      node('node_46', 'container', 'node_42', 1, 'grid h-40 grid-cols-6 items-end gap-2.5 border-b border-zinc-200', 'clause_19'),
      node('node_47', 'container', 'node_46', 0, `${DAY.bar} h-16 bg-indigo-100`, 'clause_19'),
      node('node_48', 'container', 'node_46', 1, `${DAY.bar} h-24 bg-indigo-200`, 'clause_19'),
      node('node_49', 'container', 'node_46', 2, `${DAY.bar} h-20 bg-indigo-200`, 'clause_19'),
      node('node_50', 'container', 'node_46', 3, `${DAY.bar} h-32 bg-indigo-300`, 'clause_19'),
      node('node_51', 'container', 'node_46', 4, `${DAY.bar} h-28 bg-indigo-300`, 'clause_19'),
      node('node_52', 'container', 'node_46', 5, `${DAY.bar} h-40 bg-indigo-600`, 'clause_19'),
      node('node_106', 'container', 'node_42', 2, '-mt-3 grid grid-cols-6 gap-2.5 text-[11px] tabular-nums text-zinc-400', 'clause_18'),
      ...['May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'].map((m, i) =>
        node(`node_${107 + i}`, 'text', 'node_106', i, i === 5 ? 'text-center font-medium text-zinc-700' : 'text-center', 'clause_18', m),
      ),

      node('node_53', 'container', 'node_41', 1, `flex-[2_1_240px] ${DAY.card} flex flex-col gap-4 p-5`, 'clause_20'),
      node('node_113', 'container', 'node_53', 0, 'flex items-center justify-between', 'clause_20'),
      node('node_54', 'heading', 'node_113', 0, 'text-[13px] font-semibold text-zinc-900', 'clause_20', 'Recent activity'),
      node('node_114', 'text', 'node_113', 1, 'text-xs font-medium text-indigo-600 hover:text-indigo-700 cursor-pointer', 'clause_20', 'View all'),
      node('node_115', 'container', 'node_53', 1, 'flex flex-col gap-3.5', 'clause_21'),

      node('node_55', 'container', 'node_115', 0, DAY.activityRow, 'clause_21'),
      node('node_56', 'text', 'node_55', 0, `${DAY.avatar} bg-sky-100 text-sky-700`, 'clause_21', 'MC'),
      node('node_116', 'container', 'node_55', 1, 'flex min-w-0 flex-col', 'clause_21'),
      node('node_57', 'text', 'node_116', 0, DAY.activityText, 'clause_21', 'Maya Chen added Lumen Health'),
      node('node_117', 'text', 'node_116', 1, DAY.activityTime, 'clause_21', '2 min ago'),

      node('node_58', 'container', 'node_115', 1, DAY.activityRow, 'clause_21'),
      node('node_59', 'icon', 'node_58', 0, `${DAY.avatar} bg-green-50 text-[14px] text-green-700`, 'clause_21', 'receipt'),
      node('node_118', 'container', 'node_58', 1, 'flex min-w-0 flex-col', 'clause_21'),
      node('node_60', 'text', 'node_118', 0, DAY.activityText, 'clause_21', 'INV-1043 paid · $4,820.00'),
      node('node_119', 'text', 'node_118', 1, DAY.activityTime, 'clause_21', '38 min ago'),

      node('node_61', 'container', 'node_115', 2, DAY.activityRow, 'clause_21'),
      node('node_62', 'icon', 'node_61', 0, `${DAY.avatar} bg-amber-50 text-[14px] text-amber-700`, 'clause_21', 'server'),
      node('node_120', 'container', 'node_61', 1, 'flex min-w-0 flex-col', 'clause_21'),
      node('node_63', 'text', 'node_120', 0, DAY.activityText, 'clause_21', 'API usage at 80% of plan'),
      node('node_121', 'text', 'node_120', 1, DAY.activityTime, 'clause_21', '1 hr ago'),

      node('node_122', 'container', 'node_115', 3, DAY.activityRow, 'clause_21'),
      node('node_123', 'text', 'node_122', 0, `${DAY.avatar} bg-zinc-100 text-zinc-700`, 'clause_21', 'JO'),
      node('node_124', 'container', 'node_122', 1, 'flex min-w-0 flex-col', 'clause_21'),
      node('node_125', 'text', 'node_124', 0, DAY.activityText, 'clause_21', 'Jonas Ortiz exported Q3 report'),
      node('node_126', 'text', 'node_124', 1, DAY.activityTime, 'clause_21', '3 hr ago'),
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
