import {
  Activity, AlertTriangle, Archive, ArrowRight, Award, BarChart3, Battery, Bell, BookOpen, Bookmark, Bot,
  Briefcase, Building2, Calculator, Calendar, Camera, Check, CheckCircle, ChevronDown, Circle, Clock, Cloud,
  Code, Coffee, Compass, Copy, CreditCard, Database, DollarSign, Download, ExternalLink, Eye, FileText, Filter,
  Flag, Folder, Gift, Globe, Headphones, Heart, HelpCircle, Home, Image, Inbox, Info, Key, Layers,
  LayoutDashboard, LayoutGrid, Lightbulb, LineChart, Link, List, Lock, LogIn, LogOut, Mail, Map, MapPin,
  Megaphone, Menu, MessageSquare, Mic, Minus, Moon, MoreHorizontal, Music, Package, Paperclip, Pause, Pencil,
  Phone, PieChart, Play, Plus, Printer, Receipt, RefreshCw, Rocket, Search, Send, Server, Settings, Shapes,
  Share2, Shield, ShoppingBag, ShoppingCart, SlidersHorizontal, Smile, Sparkles, Star, Store, Sun, Tag, Target,
  Terminal, ThumbsUp, Trash2, TrendingDown, TrendingUp, Truck, Unlock, Upload, User, UserPlus, Users, Video,
  Wallet, Wifi, X, Zap,
  type LucideIcon,
} from 'lucide-react';

/**
 * Canonical icon name (see ir/icons.ts) → lucide component. Curated (not the
 * whole lucide set) so the bundle stays small; names outside it resolve via the
 * synonym table in ir/icons.ts, and anything unknown falls back to `Shapes`.
 */
export const ICON_COMPONENTS: Record<string, LucideIcon> = {
  Activity, AlertTriangle, Archive, ArrowRight, Award, BarChart3, Battery, Bell, BookOpen, Bookmark, Bot,
  Briefcase, Building2, Calculator, Calendar, Camera, Check, CheckCircle, ChevronDown, Circle, Clock, Cloud,
  Code, Coffee, Compass, Copy, CreditCard, Database, DollarSign, Download, ExternalLink, Eye, FileText, Filter,
  Flag, Folder, Gift, Globe, Headphones, Heart, HelpCircle, Home, Image, Inbox, Info, Key, Layers,
  LayoutDashboard, LayoutGrid, Lightbulb, LineChart, Link, List, Lock, LogIn, LogOut, Mail, Map, MapPin,
  Megaphone, Menu, MessageSquare, Mic, Minus, Moon, MoreHorizontal, Music, Package, Paperclip, Pause, Pencil,
  Phone, PieChart, Play, Plus, Printer, Receipt, RefreshCw, Rocket, Search, Send, Server, Settings, Shapes,
  Share2, Shield, ShoppingBag, ShoppingCart, SlidersHorizontal, Smile, Sparkles, Star, Store, Sun, Tag, Target,
  Terminal, ThumbsUp, Trash2, TrendingDown, TrendingUp, Truck, Unlock, Upload, User, UserPlus, Users, Video,
  Wallet, Wifi, X, Zap,
};
