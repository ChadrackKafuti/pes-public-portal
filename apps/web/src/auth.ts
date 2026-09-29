import { User, UserManager, WebStorageStateStore } from "oidc-client-ts";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { create } from "zustand";

/**
 * Sign-in, two providers (the API accepts both):
 *
 * - Keycloak OIDC (code flow + PKCE): VITE_OIDC_AUTHORITY
 *   (e.g. https://keycloak.example/realms/UNPES) + VITE_OIDC_CLIENT_ID.
 * - Supabase Auth (email + password, CAFI-managed users — the Ground
 *   Impact pattern): VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY.
 *
 * OIDC wins when both are configured. With neither, auth is DISABLED
 * (local development): the app runs anonymously, matching the API's
 * no-provider mode.
 */

const authority = import.meta.env.VITE_OIDC_AUTHORITY as string | undefined;
const clientId = (import.meta.env.VITE_OIDC_CLIENT_ID as string | undefined) ?? "cafi-rs-platform";
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const authMode: "oidc" | "supabase" | "none" = authority
  ? "oidc"
  : supabaseUrl && supabaseAnonKey
    ? "supabase"
    : "none";
export const authEnabled = authMode !== "none";

/** What the app needs from a signed-in user, whichever provider. */
export interface AuthUser {
  profile: { preferred_username?: string };
  access_token: string;
}

const manager =
  authMode === "oidc"
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

const supabase: SupabaseClient | null =
  authMode === "supabase" ? createClient(supabaseUrl!, supabaseAnonKey!) : null;

interface AuthState {
  ready: boolean;
  user: AuthUser | null;
  login: () => void;
  /** Supabase mode: returns an error message, or null on success. */
  signInWithPassword: (email: string, password: string) => Promise<string | null>;
  logout: () => void;
}

export const useAuth = create<AuthState>((set) => ({
  ready: !authEnabled,
  user: null,
  login: () => void manager?.signinRedirect(),
  signInWithPassword: async (email, password) => {
    if (!supabase) return "Supabase auth is not configured";
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? error.message : null;
  },
  logout: () => {
    void manager?.signoutRedirect();
    void supabase?.auth.signOut();
  },
}));

function fromSupabaseSession(session: { access_token: string; user: { email?: string } } | null): AuthUser | null {
  if (!session) return null;
  return {
    profile: { preferred_username: session.user.email },
    access_token: session.access_token,
  };
}

export async function initAuth(): Promise<void> {
  if (supabase) {
    supabase.auth.onAuthStateChange((_event, session) => {
      useAuth.setState({ user: fromSupabaseSession(session), ready: true });
    });
    try {
      const { data } = await supabase.auth.getSession();
      useAuth.setState({ user: fromSupabaseSession(data.session), ready: true });
    } catch {
      useAuth.setState({ user: null, ready: true });
    }
    return;
  }
  if (!manager) return;
  manager.events.addUserLoaded((user: User) => useAuth.setState({ user }));
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
