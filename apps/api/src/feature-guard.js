// Schalter des Aktensystems zur Laufzeit (Regeln in features.js)
import { allSettings } from './settings.js';
import { HttpError } from './authz.js';
import { caseFeatures, featureForRoute, FEATURE_NAMES } from './features.js';

export const currentCaseFeatures = async () => caseFeatures(await allSettings());
export const disabledError = (feature) => new HttpError(403, `${FEATURE_NAMES[feature]} ausgeschaltet (Server-Management → Sicherheit & Einstellungen)`, 'disabled');

// Hängt die Prüfung hinter die übrigen preHandler der Route (erst anmelden, dann prüfen)
export function guardRoutes(instance) {
  instance.addHook('onRoute', (route) => {
    const feature = featureForRoute(route.url);
    if (!feature) return;
    const guard = async () => {
      if (!(await currentCaseFeatures())[feature]) throw disabledError(feature);
    };
    route.preHandler = [...[route.preHandler].flat().filter(Boolean), guard];
  });
}
