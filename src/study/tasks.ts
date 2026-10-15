/**
 * The study's task bank and counterbalancing.
 *
 * Four matched "rebuild this screen" targets (public/tasks/task_N.svg). Each
 * has ~15 visible elements, one accent colour, one non-default layout feature
 * and specific copy, so they are comparable in difficulty. A participant does
 * two tasks per condition; which two, and in which order, comes from a
 * Williams-balanced 4×4 Latin square crossed with the condition order.
 */

export type Condition = 'wysiwyc' | 'baseline';
export type ConditionOrder = 'wysiwyc-first' | 'baseline-first';

export interface StudyTask {
  id: 'task_1' | 'task_2' | 'task_3' | 'task_4';
  title: string;
  /** One-line goal shown in the task header. */
  goal: string;
  /** Concrete acceptance criteria; the participant declares done when all hold. */
  criteria: string[];
  accent: string;
}

export const TASKS: StudyTask[] = [
  {
    id: 'task_1',
    title: 'Sign-in card',
    goal: 'Rebuild the “Northwind” sign-in card on an indigo-tinted page.',
    accent: '#4f46e5',
    criteria: [
      'Centered white card on a light indigo background, brand mark + “Northwind” at the top',
      '“Welcome back” heading with the one-line subtitle under it',
      'Labelled Email and Password fields; “Forgot?” link aligned right on the password label row',
      'Checked “Remember me” checkbox, full-width indigo “Sign in” button',
      '“or” divider, outlined “Continue with Google” button, footer “No account? Create one”',
    ],
  },
  {
    id: 'task_2',
    title: 'Revenue dashboard card',
    goal: 'Rebuild the dense “Monthly revenue” card with its weekly bar chart.',
    accent: '#059669',
    criteria: [
      'Card title “Monthly revenue” with a “Last 30 days” dropdown on the right',
      'Large “$48,290”, a green “▲ 12.4%” pill next to it and the comparison line below',
      'Seven-day bar chart (Mon–Sun), light green bars with the last bar solid emerald',
      'Three label/value rows: Orders 1,204 · Avg. order value $40.10 · Refund rate 1.8% (red)',
      '“View full report →” link in emerald at the bottom',
    ],
  },
  {
    id: 'task_3',
    title: 'Navigation & page header',
    goal: 'Rebuild the dark “Acme” top bar and the “Projects” page header with tabs.',
    accent: '#0284c7',
    criteria: [
      'Dark full-width top bar: logo + “Acme”, links Home · Products · Pricing · Docs with Pricing active (underlined)',
      'Search field, notification bell with a red dot, sky-blue “Upgrade” button on the right',
      '“Projects” title with “12 active projects across 3 teams” and a dark “+ New project” button',
      'Tabs All · Active · Archived with “All” selected in sky blue',
      'Two project rows (Website redesign, Mobile onboarding) each with an “Active” pill',
    ],
  },
  {
    id: 'task_4',
    title: 'Profile settings form',
    goal: 'Rebuild the “Profile settings” form card on a rose-tinted page.',
    accent: '#e11d48',
    criteria: [
      '“Profile settings” heading and the helper sentence under it',
      'Avatar with initials “JD” and an outlined “Change photo” button beside it',
      'Full name and Email inputs side by side (pre-filled), Bio textarea with a “0 / 160” counter',
      '“Email notifications” row with its description and a rose toggle switched on',
      'Footer with “Cancel” (outlined) and “Save changes” (rose) aligned right',
    ],
  },
];

export function taskById(id: string): StudyTask | undefined {
  return TASKS.find((t) => t.id === id);
}

/** Public URL of a task's target image (works under the relative Vite base). */
export function taskImage(id: string): string {
  return `${import.meta.env.BASE_URL}tasks/${id}.svg`;
}

/** Williams design for 4 treatments: every task is preceded by every other once. */
export const LATIN_SQUARE: StudyTask['id'][][] = [
  ['task_1', 'task_2', 'task_4', 'task_3'],
  ['task_2', 'task_3', 'task_1', 'task_4'],
  ['task_3', 'task_4', 'task_2', 'task_1'],
  ['task_4', 'task_1', 'task_3', 'task_2'],
];

export interface Assignment {
  conditionOrder: ConditionOrder;
  /** Latin-square row (0–3). */
  squareRow: number;
  /** The four blocks in run order. */
  blocks: { condition: Condition; taskId: StudyTask['id'] }[];
}

/** Participant number from an id like "P07" (null when it doesn't parse). */
export function participantNumber(id: string): number | null {
  const m = id.trim().match(/^P(\d{1,3})$/i);
  return m ? Number(m[1]) : null;
}

/**
 * Counterbalancing in cycles of 8 participants: odd numbers start with
 * WYSIWYC, even numbers with the baseline, and each Latin-square row is used
 * once with each order. Any N that is a multiple of 2 balances the condition
 * order and gives every task to each condition equally often; a multiple of 8
 * also balances task position fully.
 */
export function suggestAssignment(n: number): Assignment {
  const idx = (((n - 1) % 8) + 8) % 8;
  const conditionOrder: ConditionOrder = idx % 2 === 0 ? 'wysiwyc-first' : 'baseline-first';
  const squareRow = Math.floor(idx / 2);
  return buildAssignment(conditionOrder, squareRow);
}

export function buildAssignment(conditionOrder: ConditionOrder, squareRow: number): Assignment {
  const tasks = LATIN_SQUARE[squareRow];
  const [first, second]: Condition[] =
    conditionOrder === 'wysiwyc-first' ? ['wysiwyc', 'baseline'] : ['baseline', 'wysiwyc'];
  return {
    conditionOrder,
    squareRow,
    blocks: [
      { condition: first, taskId: tasks[0] },
      { condition: first, taskId: tasks[1] },
      { condition: second, taskId: tasks[2] },
      { condition: second, taskId: tasks[3] },
    ],
  };
}

export const CONDITION_LABEL: Record<Condition, string> = {
  wysiwyc: 'WYSIWYC',
  baseline: 'Chat-only',
};
