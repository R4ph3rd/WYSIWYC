/**
 * Named icon set for `icon` nodes.
 *
 * An icon node whose `content` is one of these kebab-case names (e.g. "bell",
 * "calendar") renders a drawn Lucide glyph sized at 1em and painted in
 * currentColor — so the node's `text-*` size and colour utilities drive it,
 * exactly like text. Any other content (an emoji, a letter) still renders as
 * plain text, so existing and LLM-authored IR keeps working unchanged.
 */
import { createElement, type ReactNode } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  Calendar,
  Check,
  ChevronDown,
  ChevronsUpDown,
  CreditCard,
  Download,
  Fingerprint,
  HeartPulse,
  Inbox,
  LayoutDashboard,
  LifeBuoy,
  Mail,
  Plus,
  Receipt,
  Search,
  Server,
  Settings,
  ShieldCheck,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react';

export const ICONS: Record<string, LucideIcon> = {
  'arrow-right': ArrowRight,
  'arrow-up-right': ArrowUpRight,
  'bar-chart': BarChart3,
  bell: Bell,
  calendar: Calendar,
  check: Check,
  'chevron-down': ChevronDown,
  'chevrons-up-down': ChevronsUpDown,
  'credit-card': CreditCard,
  download: Download,
  fingerprint: Fingerprint,
  'heart-pulse': HeartPulse,
  inbox: Inbox,
  'layout-dashboard': LayoutDashboard,
  'life-buoy': LifeBuoy,
  mail: Mail,
  plus: Plus,
  receipt: Receipt,
  search: Search,
  server: Server,
  settings: Settings,
  'shield-check': ShieldCheck,
  'user-plus': UserPlus,
  users: Users,
};

/** A drawn glyph for a known icon name, or null to fall back to the text content. */
export function renderNamedIcon(content: string | undefined): ReactNode {
  const Icon = content ? ICONS[content.trim().toLowerCase()] : undefined;
  if (!Icon) return null;
  return createElement(Icon, {
    'aria-hidden': true,
    strokeWidth: 1.75,
    style: { width: '1em', height: '1em', display: 'block', flexShrink: 0 },
  });
}
