// Schalter des Aktensystems und der neuen Funktionen zur Laufzeit (Regeln in features.js)
import { allSettings } from './settings.js';
import { HttpError } from './authz.js';
import { caseFeatures, featureForRoute, FEATURE_NAMES, moduleFeatures, moduleForRoute, MODULE_SWITCHES } from './features.js';

export const currentCaseFeatures = async () => caseFeatures(await allSettings());
export const currentModules = async () => moduleFeatures(await allSettings());
export const moduleDisabledError = (key) => new HttpError(403, `${MODULE_SWITCHES[key].name} ausgeschaltet (Server-Management → Sicherheit & Einstellungen → Funktionen)`, 'disabled');
export const disabledError = (feature) => new HttpError(403, `${FEATURE_NAMES[feature]} ausgeschaltet (Server-Management → Sicherheit & Einstellungen)`, 'disabled');

// Hängt die Prüfung hinter die übrigen preHandler der Route (erst anmelden, dann prüfen)
export function guardRoutes(instance) {
  instance.addHook('onRoute', (route) => {
    const mod = moduleForRoute(route.url);
    if (mod) {
      const guardModule = async () => {
        if (!(await currentModules())[mod]) throw moduleDisabledError(mod);
      };
      // Auch Routen ohne Anmeldung (Spotify-Rückkehr, Musik-Stream) prüfen den Schalter
      route.preHandler = [...[route.preHandler].flat().filter(Boolean), guardModule];
      return;
    }
    const feature = featureForRoute(route.url);
    if (!feature) return;
    const guard = async () => {
      if (!(await currentCaseFeatures())[feature]) throw disabledError(feature);
    };
    route.preHandler = [...[route.preHandler].flat().filter(Boolean), guard];
  });
}
