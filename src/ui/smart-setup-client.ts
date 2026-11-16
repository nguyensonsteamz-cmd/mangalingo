/** UI-side factory of Lingolens Smart Setup: picks the platform's Google sign-in and wires the flow to the secure store through the router. */
import { send } from '@/shared/messages';
import { chromeLocal } from '@/storage/kv';
import { GoogleCloudClient, SmartSetupFlow, chromeIdentityProvider, type OAuthProvider } from '@/modules/smart-setup';
import { mobileOAuthProvider, openExternalMobile } from '@/mobile/setup-native';

export const platformOAuth = (): OAuthProvider => mobileOAuthProvider() ?? chromeIdentityProvider();

let flow: SmartSetupFlow | null = null;
/** One flow per page: it keeps the OAuth token in memory for the length of the setup, nothing is persisted. */
export function getSmartSetup(): SmartSetupFlow {
  flow ??= new SmartSetupFlow({
    client: new GoogleCloudClient(),
    oauth: platformOAuth(),
    kv: chromeLocal(),
    activate: async (key, credential) => void (await send({ type: 'usage:activate', key, credential })),
    deactivate: async () => void (await send({ type: 'usage:deactivate' })),
    keyHint: async () => (await send({ type: 'usage:snapshot' })).keyHint,
    validateSaved: () => send({ type: 'usage:validate-saved' }),
  });
  return flow;
}

/** Opens a Google Cloud Console page outside the app (system browser / a new tab). */
export function openConsole(url: string) {
  if (!openExternalMobile(url)) window.open(url, '_blank', 'noopener');
}
