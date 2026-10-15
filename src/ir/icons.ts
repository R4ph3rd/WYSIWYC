/**
 * Icon vocabulary: maps the words people use in a spec ("notification",
 * "calendar", "cog", "trash can") to a concrete lucide-react icon name that
 * the renderer can draw (see render/iconRegistry.tsx). Pure, no React.
 *
 * An icon node's `content` holds the icon name (e.g. "Bell"). Legacy content
 * (emoji glyphs, lower-case words, LLM-invented names like "CalendarCheck") is
 * resolved through the same table, so anything icon-ish renders a real icon.
 */

/** Canonical icon names the renderer can draw, each with its preferred prose word. */
export const ICON_WORDS: Record<string, string> = {
  Bell: 'notification', Calendar: 'calendar', Search: 'search', Settings: 'settings',
  User: 'user', Users: 'users', Home: 'home', Mail: 'mail', MessageSquare: 'message',
  Heart: 'heart', Star: 'star', ShoppingCart: 'cart', ShoppingBag: 'bag', Plus: 'plus',
  Minus: 'minus', X: 'close', Check: 'check', ChevronDown: 'chevron', ArrowRight: 'arrow',
  Menu: 'menu', MoreHorizontal: 'more', Filter: 'filter', Download: 'download',
  Upload: 'upload', Share2: 'share', Trash2: 'trash', Pencil: 'edit', Lock: 'lock',
  Unlock: 'unlock', Eye: 'eye', Info: 'info', HelpCircle: 'help', AlertTriangle: 'warning',
  CheckCircle: 'success', Clock: 'clock', MapPin: 'location', Phone: 'phone', Camera: 'camera',
  Image: 'image', FileText: 'document', Folder: 'folder', Link: 'link', Globe: 'globe',
  Sun: 'sun', Moon: 'moon', Zap: 'lightning', Bookmark: 'bookmark', Tag: 'tag', Gift: 'gift',
  CreditCard: 'card', DollarSign: 'dollar', Wallet: 'wallet', BarChart3: 'chart',
  LineChart: 'line chart', PieChart: 'pie chart', TrendingUp: 'trend', TrendingDown: 'decline',
  Activity: 'activity', LayoutDashboard: 'dashboard', LayoutGrid: 'grid', List: 'list',
  Sparkles: 'sparkle', Shield: 'shield', LogOut: 'logout', LogIn: 'login', Play: 'play',
  Pause: 'pause', Music: 'music', Video: 'video', Mic: 'microphone', Wifi: 'wifi',
  Battery: 'battery', Cloud: 'cloud', Send: 'send', Paperclip: 'attachment', Copy: 'copy',
  RefreshCw: 'refresh', Inbox: 'inbox', Archive: 'archive', Flag: 'flag', Award: 'award',
  Briefcase: 'briefcase', Package: 'package', Truck: 'truck', Smile: 'smile',
  ThumbsUp: 'like', Bot: 'bot', Code: 'code', Terminal: 'terminal', Database: 'database',
  Server: 'server', Layers: 'layers', Compass: 'compass', Headphones: 'headphones',
  Printer: 'printer', Key: 'key', Lightbulb: 'idea', Target: 'target', Rocket: 'rocket',
  Building2: 'building', Map: 'map', Coffee: 'coffee', BookOpen: 'book', Receipt: 'receipt',
  Megaphone: 'megaphone', Store: 'store', Calculator: 'calculator', SlidersHorizontal: 'sliders',
  UserPlus: 'invite', ExternalLink: 'external link', Circle: 'circle', Shapes: 'shapes',
};

/** Fallback when an icon noun is not in the vocabulary. */
export const FALLBACK_ICON = 'Shapes';

/** Synonyms / plurals / near-words → canonical icon name. */
const SYNONYMS: Record<string, string> = {
  notification: 'Bell', notifications: 'Bell', notify: 'Bell', bell: 'Bell', bells: 'Bell',
  alert: 'Bell', alerts: 'Bell', reminder: 'Bell', reminders: 'Bell', bellring: 'Bell',
  calendar: 'Calendar', calendars: 'Calendar', date: 'Calendar', dates: 'Calendar', schedule: 'Calendar',
  event: 'Calendar', events: 'Calendar', agenda: 'Calendar', calendardays: 'Calendar',
  search: 'Search', magnifier: 'Search', 'magnifying glass': 'Search', find: 'Search', lookup: 'Search',
  settings: 'Settings', setting: 'Settings', gear: 'Settings', cog: 'Settings', preferences: 'Settings', config: 'Settings',
  user: 'User', profile: 'User', account: 'User', person: 'User', avatar: 'User',
  users: 'Users', people: 'Users', team: 'Users', customers: 'Users', customer: 'Users', members: 'Users', group: 'Users', contacts: 'Users',
  home: 'Home', house: 'Home',
  mail: 'Mail', email: 'Mail', envelope: 'Mail', 'e-mail': 'Mail', newsletter: 'Mail',
  message: 'MessageSquare', messages: 'MessageSquare', chat: 'MessageSquare', comment: 'MessageSquare',
  comments: 'MessageSquare', conversation: 'MessageSquare', inbox: 'Inbox', speech: 'MessageSquare',
  heart: 'Heart', love: 'Heart', favorite: 'Heart', favourite: 'Heart', favorites: 'Heart', favourites: 'Heart',
  star: 'Star', stars: 'Star', rating: 'Star', ratings: 'Star',
  cart: 'ShoppingCart', basket: 'ShoppingCart', checkout: 'ShoppingCart', 'shopping cart': 'ShoppingCart',
  bag: 'ShoppingBag', shopping: 'ShoppingBag', 'shopping bag': 'ShoppingBag',
  plus: 'Plus', add: 'Plus', create: 'Plus',
  minus: 'Minus', subtract: 'Minus', remove: 'Minus',
  close: 'X', cross: 'X', x: 'X', dismiss: 'X', cancel: 'X',
  check: 'Check', checkmark: 'Check', tick: 'Check', done: 'Check',
  chevron: 'ChevronDown', caret: 'ChevronDown', dropdown: 'ChevronDown', expand: 'ChevronDown',
  arrow: 'ArrowRight', next: 'ArrowRight', forward: 'ArrowRight',
  menu: 'Menu', hamburger: 'Menu', burger: 'Menu', navigation: 'Menu', nav: 'Menu',
  more: 'MoreHorizontal', ellipsis: 'MoreHorizontal', overflow: 'MoreHorizontal', kebab: 'MoreHorizontal', options: 'MoreHorizontal',
  filter: 'Filter', filters: 'Filter', funnel: 'Filter',
  download: 'Download', export: 'Download', upload: 'Upload', import: 'Upload',
  share: 'Share2', sharing: 'Share2',
  trash: 'Trash2', delete: 'Trash2', bin: 'Trash2', 'trash can': 'Trash2', garbage: 'Trash2', rubbish: 'Trash2',
  edit: 'Pencil', pencil: 'Pencil', pen: 'Pencil', write: 'Pencil', compose: 'Pencil',
  lock: 'Lock', locked: 'Lock', security: 'Shield', password: 'Lock', private: 'Lock',
  unlock: 'Unlock', unlocked: 'Unlock',
  eye: 'Eye', view: 'Eye', visibility: 'Eye', preview: 'Eye', views: 'Eye',
  info: 'Info', information: 'Info', about: 'Info', details: 'Info',
  help: 'HelpCircle', question: 'HelpCircle', support: 'HelpCircle', faq: 'HelpCircle',
  warning: 'AlertTriangle', caution: 'AlertTriangle', error: 'AlertTriangle', danger: 'AlertTriangle',
  success: 'CheckCircle', confirmed: 'CheckCircle', verified: 'CheckCircle',
  clock: 'Clock', time: 'Clock', history: 'Clock', recent: 'Clock', timer: 'Clock', watch: 'Clock',
  location: 'MapPin', pin: 'MapPin', place: 'MapPin', address: 'MapPin', marker: 'MapPin',
  map: 'Map', maps: 'Map',
  phone: 'Phone', call: 'Phone', telephone: 'Phone', contact: 'Phone',
  camera: 'Camera', photo: 'Camera', photos: 'Image', picture: 'Image', image: 'Image', images: 'Image', gallery: 'Image',
  document: 'FileText', documents: 'FileText', file: 'FileText', files: 'FileText', report: 'FileText', reports: 'FileText', doc: 'FileText', page: 'FileText',
  folder: 'Folder', folders: 'Folder', directory: 'Folder', projects: 'Folder', project: 'Folder',
  link: 'Link', links: 'Link', url: 'Link', chain: 'Link',
  globe: 'Globe', world: 'Globe', web: 'Globe', website: 'Globe', language: 'Globe', internet: 'Globe',
  sun: 'Sun', 'light mode': 'Sun', moon: 'Moon', 'dark mode': 'Moon', night: 'Moon',
  lightning: 'Zap', bolt: 'Zap', zap: 'Zap', flash: 'Zap', power: 'Zap', energy: 'Zap', fast: 'Zap',
  bookmark: 'Bookmark', bookmarks: 'Bookmark', save: 'Bookmark', saved: 'Bookmark',
  tag: 'Tag', tags: 'Tag', label: 'Tag', labels: 'Tag', price: 'Tag',
  gift: 'Gift', present: 'Gift', reward: 'Gift', rewards: 'Gift',
  card: 'CreditCard', 'credit card': 'CreditCard', payment: 'CreditCard', payments: 'CreditCard', billing: 'CreditCard',
  dollar: 'DollarSign', money: 'DollarSign', revenue: 'DollarSign', currency: 'DollarSign', cash: 'DollarSign', sales: 'DollarSign',
  wallet: 'Wallet', balance: 'Wallet',
  chart: 'BarChart3', charts: 'BarChart3', 'bar chart': 'BarChart3', analytics: 'BarChart3', stats: 'BarChart3', statistics: 'BarChart3', graph: 'BarChart3', insights: 'BarChart3',
  'line chart': 'LineChart', 'pie chart': 'PieChart', pie: 'PieChart',
  trend: 'TrendingUp', trending: 'TrendingUp', growth: 'TrendingUp', increase: 'TrendingUp', up: 'TrendingUp',
  decline: 'TrendingDown', decrease: 'TrendingDown', down: 'TrendingDown', drop: 'TrendingDown',
  activity: 'Activity', pulse: 'Activity', health: 'Activity', heartbeat: 'Activity', monitor: 'Activity',
  dashboard: 'LayoutDashboard', overview: 'LayoutDashboard',
  grid: 'LayoutGrid', apps: 'LayoutGrid', tiles: 'LayoutGrid', list: 'List', lists: 'List',
  sparkle: 'Sparkles', sparkles: 'Sparkles', magic: 'Sparkles', ai: 'Sparkles', spark: 'Sparkles',
  shield: 'Shield', protection: 'Shield', secure: 'Shield', privacy: 'Shield',
  logout: 'LogOut', 'log out': 'LogOut', 'sign out': 'LogOut', signout: 'LogOut', exit: 'LogOut',
  login: 'LogIn', 'log in': 'LogIn', 'sign in': 'LogIn', signin: 'LogIn', enter: 'LogIn',
  play: 'Play', pause: 'Pause', music: 'Music', song: 'Music', audio: 'Music',
  video: 'Video', movie: 'Video', film: 'Video', microphone: 'Mic', mic: 'Mic', voice: 'Mic', record: 'Mic',
  wifi: 'Wifi', wireless: 'Wifi', signal: 'Wifi', battery: 'Battery', cloud: 'Cloud', sync: 'RefreshCw',
  send: 'Send', paper: 'Send', 'paper plane': 'Send', submit: 'Send',
  attachment: 'Paperclip', attach: 'Paperclip', paperclip: 'Paperclip', clip: 'Paperclip',
  copy: 'Copy', duplicate: 'Copy', clipboard: 'Copy',
  refresh: 'RefreshCw', reload: 'RefreshCw', retry: 'RefreshCw', update: 'RefreshCw',
  archive: 'Archive', box: 'Package', flag: 'Flag', award: 'Award', trophy: 'Award', badge: 'Award', achievement: 'Award',
  briefcase: 'Briefcase', work: 'Briefcase', job: 'Briefcase', jobs: 'Briefcase', business: 'Briefcase', portfolio: 'Briefcase',
  package: 'Package', packages: 'Package', product: 'Package', products: 'Package', order: 'Package', orders: 'Package', inventory: 'Package',
  truck: 'Truck', shipping: 'Truck', delivery: 'Truck',
  smile: 'Smile', emoji: 'Smile', happy: 'Smile', feedback: 'Smile',
  like: 'ThumbsUp', thumbs: 'ThumbsUp', 'thumbs up': 'ThumbsUp', upvote: 'ThumbsUp',
  bot: 'Bot', robot: 'Bot', assistant: 'Bot', code: 'Code', developer: 'Code', terminal: 'Terminal', console: 'Terminal',
  database: 'Database', storage: 'Database', data: 'Database', server: 'Server', servers: 'Server', hosting: 'Server',
  layers: 'Layers', layer: 'Layers', stack: 'Layers', compass: 'Compass', explore: 'Compass', discover: 'Compass',
  headphones: 'Headphones', headset: 'Headphones', printer: 'Printer', print: 'Printer',
  key: 'Key', keys: 'Key', api: 'Key', idea: 'Lightbulb', lightbulb: 'Lightbulb', bulb: 'Lightbulb', tip: 'Lightbulb', tips: 'Lightbulb',
  target: 'Target', goal: 'Target', goals: 'Target', rocket: 'Rocket', launch: 'Rocket', startup: 'Rocket',
  building: 'Building2', company: 'Building2', office: 'Building2', organization: 'Building2', organisation: 'Building2',
  coffee: 'Coffee', cafe: 'Coffee', book: 'BookOpen', books: 'BookOpen', docs: 'BookOpen', documentation: 'BookOpen', learn: 'BookOpen', read: 'BookOpen',
  receipt: 'Receipt', invoice: 'Receipt', invoices: 'Receipt', bill: 'Receipt',
  megaphone: 'Megaphone', announcement: 'Megaphone', announcements: 'Megaphone', marketing: 'Megaphone', campaign: 'Megaphone',
  store: 'Store', shop: 'Store', market: 'Store', calculator: 'Calculator', math: 'Calculator',
  sliders: 'SlidersHorizontal', controls: 'SlidersHorizontal', adjust: 'SlidersHorizontal', tune: 'SlidersHorizontal',
  invite: 'UserPlus', 'add user': 'UserPlus', signup: 'UserPlus', 'sign up': 'UserPlus', register: 'UserPlus',
  external: 'ExternalLink', 'external link': 'ExternalLink',
  circle: 'Circle', dot: 'Circle', shapes: 'Shapes', shape: 'Shapes', generic: 'Shapes',
};

/** Common emoji glyphs (as authored in samples / by models) → icon name. */
const EMOJI: Record<string, string> = {
  '🔔': 'Bell', '📅': 'Calendar', '📆': 'Calendar', '🔍': 'Search', '🔎': 'Search', '⚙️': 'Settings', '⚙': 'Settings',
  '👤': 'User', '👥': 'Users', '🏠': 'Home', '✉️': 'Mail', '✉': 'Mail', '📧': 'Mail', '💬': 'MessageSquare',
  '❤️': 'Heart', '❤': 'Heart', '⭐': 'Star', '🛒': 'ShoppingCart', '➕': 'Plus', '✓': 'Check', '✔️': 'Check',
  '📊': 'BarChart3', '📈': 'TrendingUp', '📉': 'TrendingDown', '🗑️': 'Trash2', '🗑': 'Trash2', '✏️': 'Pencil',
  '🔒': 'Lock', '👁️': 'Eye', 'ℹ️': 'Info', '❓': 'HelpCircle', '⚠️': 'AlertTriangle', '🕒': 'Clock', '⏰': 'Clock',
  '📍': 'MapPin', '📞': 'Phone', '📷': 'Camera', '🖼️': 'Image', '📄': 'FileText', '📁': 'Folder', '🔗': 'Link',
  '🌐': 'Globe', '☀️': 'Sun', '🌙': 'Moon', '⚡': 'Zap', '🔖': 'Bookmark', '🏷️': 'Tag', '🎁': 'Gift', '💳': 'CreditCard',
  '💲': 'DollarSign', '💰': 'DollarSign', '✨': 'Sparkles', '🛡️': 'Shield', '▶️': 'Play', '🎵': 'Music', '🎤': 'Mic',
  '☁️': 'Cloud', '📎': 'Paperclip', '📦': 'Package', '🚚': 'Truck', '😊': 'Smile', '👍': 'ThumbsUp', '🤖': 'Bot',
  '🔑': 'Key', '💡': 'Lightbulb', '🎯': 'Target', '🚀': 'Rocket', '☕': 'Coffee', '📖': 'BookOpen', '📚': 'BookOpen',
  '🧾': 'Receipt', '📣': 'Megaphone', '🏪': 'Store',
};

const CANONICAL_LOWER = new Map(Object.keys(ICON_WORDS).map((n) => [n.toLowerCase(), n]));

/** Split "CalendarCheck" / "calendar-check" / "lucide:calendar_check" into lower-case words. */
function wordsOf(s: string): string[] {
  return s
    .replace(/^lucide[:\-/]/i, '')
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** True when the string is a glyph (emoji / symbol) rather than a word or name. */
export function isGlyph(s: string): boolean {
  const t = s.trim();
  return t.length > 0 && !/[A-Za-z]/.test(t);
}

/**
 * Resolve icon-ish text to a canonical icon name, or null if it names nothing
 * known. Accepts canonical names ("Bell"), any casing ("bell"), synonyms
 * ("notifications", "cog"), compound model names ("CalendarCheck2"), and
 * common emoji ("🔔").
 */
export function resolveIconName(text: string | undefined | null): string | null {
  if (!text) return null;
  const t = text.trim();
  if (!t) return null;
  if (EMOJI[t]) return EMOJI[t];
  if (ICON_WORDS[t]) return t;
  const lower = t.toLowerCase().replace(/^lucide[:\-/]/, '');
  const canon = CANONICAL_LOWER.get(lower.replace(/[\s_-]+/g, ''));
  if (canon) return canon;
  const syn = SYNONYMS[lower] ?? SYNONYMS[lower.replace(/[_-]+/g, ' ')];
  if (syn) return syn;
  const words = wordsOf(t);
  // Multi-word phrases first ("credit card", "magnifying glass"), then each word.
  for (let i = 0; i < words.length - 1; i++) {
    const pair = SYNONYMS[`${words[i]} ${words[i + 1]}`];
    if (pair) return pair;
  }
  for (const w of words) {
    const hit = SYNONYMS[w] ?? CANONICAL_LOWER.get(w) ?? (w.endsWith('s') ? SYNONYMS[w.slice(0, -1)] : undefined);
    if (hit) return hit;
  }
  return null;
}

/** Resolve with the generic fallback, so an icon slot always draws something. */
export function iconNameOrFallback(text: string | undefined | null): string {
  return resolveIconName(text) ?? FALLBACK_ICON;
}

/** The prose word for an icon name ("Bell" → "notification"). */
export function iconWord(name: string): string {
  return ICON_WORDS[name] ?? (resolveIconName(name) ? ICON_WORDS[resolveIconName(name)!] : name.toLowerCase());
}

/** True when a word plausibly names an icon (drives the lexer's icon pins). */
export function isIconWord(word: string): boolean {
  return resolveIconName(word) !== null;
}

/** The choices offered by the icon widget (name + prose word). */
export const ICON_CHOICES: { name: string; word: string }[] = [
  'Bell', 'Calendar', 'Search', 'Settings', 'User', 'Users', 'Home', 'Mail', 'MessageSquare', 'Heart',
  'Star', 'ShoppingCart', 'Plus', 'Check', 'X', 'Menu', 'MoreHorizontal', 'Filter', 'Download', 'Upload',
  'Share2', 'Trash2', 'Pencil', 'Lock', 'Eye', 'Info', 'HelpCircle', 'AlertTriangle', 'Clock', 'MapPin',
  'Phone', 'Camera', 'Image', 'FileText', 'Folder', 'Link', 'Globe', 'Sun', 'Moon', 'Zap', 'Bookmark',
  'Tag', 'Gift', 'CreditCard', 'DollarSign', 'BarChart3', 'TrendingUp', 'Activity', 'LayoutDashboard', 'Sparkles',
  'Shield', 'LogOut', 'Send', 'RefreshCw', 'Inbox', 'Briefcase', 'Package', 'Lightbulb', 'Rocket', 'Building2',
].map((name) => ({ name, word: ICON_WORDS[name] }));
