import { User, UserManager, WebStorageStateStore } from "oidc-client-ts";
import { create } from "zustand";

/**
 * OIDC login (Keycloak, code flow + PKCE). Configured via VITE_OIDC_AUTHORITY
 * (e.g. https://keycloak.example/realms/UNPES) and VITE_OIDC_CLIENT_ID.
 * With no authority configured, auth is DISABLED (local development): the
 * app runs anonymously, matching the API's no-issuer mode.
 */

const authority = import.meta.env.VITE_OIDC_AUTHORITY as string | undefined;
const clientId = (import.meta.env.VITE_OIDC_CLIENT_ID as string | undefined) ?? "cafi-rs-platform";

export const authEnabled = Boolean(authority);

const manager = authEnabled
  ? new UserManager({
      authority: authority!,
      client_id: clientId,
      redirect_uri: window.location.origin + window.location.pathname,
      post_logout_redirect_uri: window.location.origin + window.location.pathname,
      response_type: "code",
      scope: "openid profile",
      automaticSilentRenew: true,
      userStore: new WebStorageStateStore({ store: window.sessionStorage }),
    })
  : null;

interface AuthState {
  ready: boolean;
  user: User | null;
  login: () => void;
  logout: () => void;
}

export const useAuth = create<AuthState>((set) => ({
  ready: !authEnabled,
  user: null,
  login: () => void manager?.signinRedirect(),
  logout: () => void manager?.signoutRedirect(),
}));

export async function initAuth(): Promise<void> {
  if (!manager) return;
  manager.events.addUserLoaded((user) => useAuth.setState({ user }));
  manager.events.addUserUnloaded(() => useAuth.setState({ user: null }));
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.has("code") && params.has("state")) {
      const user = await manager.signinRedirectCallback();
      // Clean the OIDC params off the URL, keeping the hash route.
      window.history.replaceState({}, "", window.location.pathname + window.location.hash);
      useAuth.setState({ user, ready: true });
      return;
    }
    const user = await manager.getUser();
    useAuth.setState({ user: user && !user.expired ? user : null, ready: true });
  } catch {
    useAuth.setState({ user: null, ready: true });
  }
}

/** Bearer header for the API client; {} when auth is disabled. */
export function authHeaders(): Record<string, string> {
  const token = useAuth.getState().user?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}
