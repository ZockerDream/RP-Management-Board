// Darstellung „V2“ (Wunsch des Auftraggebers vom 2026-11-11): Hintergrund, Glas-Panels und eigenes Dashboard-Layout je
// Benutzer. Ohne Datenbank, damit die Regeln im Unit-Test laufen. Die Modul-IDs müssen zu MODULES in
// apps/web/public/js/pages/dashboard.js passen; unbekannte IDs fallen beim Lesen still weg, damit ein entferntes Modul
// kein gespeichertes Layout ungültig macht.
import { z } from 'zod';

export const UI_VERSIONS = ['v1', 'v2'];
export const BACKGROUNDS = ['dusk', 'night', 'forest', 'none', 'custom'];
export const DASHBOARD_MODULES = ['kpis', 'forecast', 'cashflow', 'categories', 'budgets', 'transactions', 'timer', 'accounts', 'goals', 'todos', 'fleet', 'upcoming', 'music'];
export const MODULE_SPANS = [4, 6, 8, 12];

export const UI_DEFAULTS = Object.freeze({ background: 'dusk', blur: 22, opacity: 52, dim: 20, lite: true, dashboard: null });

const moduleId = z.string().max(30);
const span = z.union(MODULE_SPANS.map((n) => z.literal(n)));

// Was der Browser schicken darf: immer das ganze Objekt, so bleibt ein PATCH ohne Zusammenführen eindeutig
export const uiPrefsSchema = z.object({
  background: z.enum(BACKGROUNDS),
  blur: z.number().int().min(0).max(40),
  opacity: z.number().int().min(20).max(90),
  dim: z.number().int().min(0).max(70),
  lite: z.boolean(),
  dashboard: z.object({
    order: z.array(moduleId).max(DASHBOARD_MODULES.length),
    hidden: z.array(moduleId).max(DASHBOARD_MODULES.length),
    spans: z.record(z.string().max(30), span),
  }).strict().nullable(),
}).strict();

const known = (id) => DASHBOARD_MODULES.includes(id);

function normalizeDashboard(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const order = [...new Set(Array.isArray(raw.order) ? raw.order.filter(known) : [])];
  const hidden = [...new Set(Array.isArray(raw.hidden) ? raw.hidden.filter((id) => known(id) && !order.includes(id)) : [])];
  const spans = {};
  if (raw.spans && typeof raw.spans === 'object') {
    for (const [id, value] of Object.entries(raw.spans)) if (known(id) && MODULE_SPANS.includes(value)) spans[id] = value;
  }
  return { order, hidden, spans };
}

// Gespeicherte Werte lesen: alles Ungültige fällt auf den Standard zurück
export function normalizeUiPrefs(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const int = (value, min, max, fallback) => (Number.isInteger(value) && value >= min && value <= max ? value : fallback);
  return {
    background: BACKGROUNDS.includes(src.background) ? src.background : UI_DEFAULTS.background,
    blur: int(src.blur, 0, 40, UI_DEFAULTS.blur),
    opacity: int(src.opacity, 20, 90, UI_DEFAULTS.opacity),
    dim: int(src.dim, 0, 70, UI_DEFAULTS.dim),
    lite: typeof src.lite === 'boolean' ? src.lite : UI_DEFAULTS.lite,
    dashboard: normalizeDashboard(src.dashboard),
  };
}
