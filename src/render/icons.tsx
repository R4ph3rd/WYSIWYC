/**
 * Named icon set for `icon` nodes.
 *
 * An icon node's `content` names its glyph. A canonical kebab-case Lucide name
 * (e.g. "bell", "calendar", "bar-chart") renders that icon sized at 1em and
 * painted in currentColor — so the node's `text-*` size and colour utilities
 * drive it, exactly like text. Other words resolve through the icon vocabulary
 * in ir/icons.ts ("notifications" → bell, "Calendar" → calendar, unknown words
 * → a generic glyph), so a spec edit never leaves an empty icon slot. Emoji and
 * other glyph content still renders as plain text, so existing and
 * LLM-authored IR keeps working unchanged.
 */
import { createElement, type ReactNode } from 'react';
import {
  Activity, AlertTriangle, Archive, ArrowRight, ArrowUpRight, Award, BarChart3, Battery,
  Bell, BookOpen, Bookmark, Bot, Briefcase, Building2, Calculator, Calendar,
  Camera, Check, CheckCircle, ChevronDown, ChevronsUpDown, Circle, Clock, Cloud,
  Code, Coffee, Compass, Copy, CreditCard, Database, DollarSign, Download,
  ExternalLink, Eye, FileText, Filter, Fingerprint, Flag, Folder, Gift,
  Globe, Headphones, Heart, HeartPulse, HelpCircle, Home, Image, Inbox,
  Info, Key, Layers, LayoutDashboard, LayoutGrid, LifeBuoy, Lightbulb, LineChart,
  Link, List, Lock, LogIn, LogOut, Mail, Map, MapPin,
  Megaphone, Menu, MessageSquare, Mic, Minus, Moon, MoreHorizontal, Music,
  Package, Paperclip, Pause, Pencil, Phone, PieChart, Play, Plus,
  Printer, Receipt, RefreshCw, Rocket, Search, Send, Server, Settings,
  Shapes, Share2, Shield, ShieldCheck, ShoppingBag, ShoppingCart, SlidersHorizontal, Smile,
  Sparkles, Star, Store, Sun, Tag, Target, Terminal, ThumbsUp,
  Trash2, TrendingDown, TrendingUp, Truck, Unlock, Upload, User, UserPlus,
  Users, Video, Wallet, Wifi, Zap,
  type LucideIcon,
} from 'lucide-react';
import { isGlyph, resolveIconName, toIconKey, FALLBACK_ICON } from '@/ir/icons';

const COMPONENTS: LucideIcon[] = [
  Activity, AlertTriangle, Archive, ArrowRight, ArrowUpRight, Award, BarChart3, Battery,
  Bell, BookOpen, Bookmark, Bot, Briefcase, Building2, Calculator, Calendar,
  Camera, Check, CheckCircle, ChevronDown, ChevronsUpDown, Circle, Clock, Cloud,
  Code, Coffee, Compass, Copy, CreditCard, Database, DollarSign, Download,
  ExternalLink, Eye, FileText, Filter, Fingerprint, Flag, Folder, Gift,
  Globe, Headphones, Heart, HeartPulse, HelpCircle, Home, Image, Inbox,
  Info, Key, Layers, LayoutDashboard, LayoutGrid, LifeBuoy, Lightbulb, LineChart,
  Link, List, Lock, LogIn, LogOut, Mail, Map, MapPin,
  Megaphone, Menu, MessageSquare, Mic, Minus, Moon, MoreHorizontal, Music,
  Package, Paperclip, Pause, Pencil, Phone, PieChart, Play, Plus,
  Printer, Receipt, RefreshCw, Rocket, Search, Send, Server, Settings,
  Shapes, Share2, Shield, ShieldCheck, ShoppingBag, ShoppingCart, SlidersHorizontal, Smile,
  Sparkles, Star, Store, Sun, Tag, Target, Terminal, ThumbsUp,
  Trash2, TrendingDown, TrendingUp, Truck, Unlock, Upload, User, UserPlus,
  Users, Video, Wallet, Wifi, Zap,
];
const NAMES = [
  'Activity', 'AlertTriangle', 'Archive', 'ArrowRight', 'ArrowUpRight', 'Award', 'BarChart3', 'Battery', 'Bell', 'BookOpen', 'Bookmark', 'Bot', 'Briefcase', 'Building2', 'Calculator', 'Calendar', 'Camera', 'Check', 'CheckCircle', 'ChevronDown', 'ChevronsUpDown', 'Circle', 'Clock', 'Cloud', 'Code', 'Coffee', 'Compass', 'Copy', 'CreditCard', 'Database', 'DollarSign', 'Download', 'ExternalLink', 'Eye', 'FileText', 'Filter', 'Fingerprint', 'Flag', 'Folder', 'Gift', 'Globe', 'Headphones', 'Heart', 'HeartPulse', 'HelpCircle', 'Home', 'Image', 'Inbox', 'Info', 'Key', 'Layers', 'LayoutDashboard', 'LayoutGrid', 'LifeBuoy', 'Lightbulb', 'LineChart', 'Link', 'List', 'Lock', 'LogIn', 'LogOut', 'Mail', 'Map', 'MapPin', 'Megaphone', 'Menu', 'MessageSquare', 'Mic', 'Minus', 'Moon', 'MoreHorizontal', 'Music', 'Package', 'Paperclip', 'Pause', 'Pencil', 'Phone', 'PieChart', 'Play', 'Plus', 'Printer', 'Receipt', 'RefreshCw', 'Rocket', 'Search', 'Send', 'Server', 'Settings', 'Shapes', 'Share2', 'Shield', 'ShieldCheck', 'ShoppingBag', 'ShoppingCart', 'SlidersHorizontal', 'Smile', 'Sparkles', 'Star', 'Store', 'Sun', 'Tag', 'Target', 'Terminal', 'ThumbsUp', 'Trash2', 'TrendingDown', 'TrendingUp', 'Truck', 'Unlock', 'Upload', 'User', 'UserPlus', 'Users', 'Video', 'Wallet', 'Wifi', 'Zap',
];

/** Canonical kebab-case icon key → Lucide component. */
export const ICONS: Record<string, LucideIcon> = Object.fromEntries(
  NAMES.map((name, i) => [toIconKey(name), COMPONENTS[i]]),
);

/** The canonical key an icon node's content draws, or null to render the content as text. */
export function iconKeyFor(content: string | undefined): string | null {
  const c = content?.trim();
  if (!c) return null;
  const exact = c.toLowerCase();
  if (ICONS[exact]) return exact;
  if (isGlyph(c)) return resolveIconName(c); // known emoji resolve, other glyphs stay text
  const key = resolveIconName(c) ?? FALLBACK_ICON;
  return ICONS[key] ? key : FALLBACK_ICON;
}

/** A drawn glyph for icon content, or null to fall back to the text content. */
export function renderNamedIcon(content: string | undefined): ReactNode {
  const key = iconKeyFor(content);
  // Emoji authored in samples keep rendering as emoji (visual design unchanged).
  if (!key || isGlyph(content ?? '')) return null;
  const Icon = ICONS[key];
  if (!Icon) return null;
  const dataAttrs = { 'data-icon': key };
  return createElement(Icon, {
    ...dataAttrs,
    'aria-hidden': true,
    strokeWidth: 1.75,
    style: { width: '1em', height: '1em', display: 'block', flexShrink: 0 },
  });
}
