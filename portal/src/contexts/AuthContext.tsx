import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface GitHubUser {
  login: string;
  id: number;
  avatar: string;
  name: string;
}

interface SessionData {
  user: GitHubUser;
  orgs: string[];
  createdAt: string;
}

interface AuthState {
  /** Logged-in user info, or null when not authenticated */
  user: GitHubUser | null;
  /** Auth is still initialising (checking stored session) */
  loading: boolean;
  /** User’s org memberships */
  orgs: string[];
  /** Redirect browser to GitHub OAuth */
  login: () => void;
  /** Destroy session on server + clear local state */
  logout: () => Promise<void>;
}

/* ------------------------------------------------------------------ */
/*  Context                                                            */
/* ------------------------------------------------------------------ */

const SESSION_KEY = "pocwu_session_token";

const AuthContext = createContext<AuthState | null>(null);

/* ------------------------------------------------------------------ */
/*  Provider                                                           */
/* ------------------------------------------------------------------ */

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [orgs, setOrgs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  /**
   * Call /api/auth/github/session with a Bearer token to verify it's still valid.
   */
  const verifySession = useCallback(async (token: string): Promise<boolean> => {
    try {
      const resp = await fetch("/api/auth/github/session", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) return false;
      const body = (await resp.json()) as {
        authenticated: boolean;
        session?: SessionData;
      };
      if (body.authenticated && body.session) {
        setUser(body.session.user);
        setOrgs(body.session.orgs);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  // ── Initialisation ──────────────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      // 1. Check for OAuth callback (?session=xxx) in URL
      const params = new URLSearchParams(window.location.search);
      const sessionToken = params.get("session");

      if (sessionToken) {
        // Store it, then remove the query param so it's not dangling
        localStorage.setItem(SESSION_KEY, sessionToken);
        window.history.replaceState({}, "", window.location.pathname);
      }

      // 2. Try to load existing session from localStorage
      const stored = localStorage.getItem(SESSION_KEY);
      if (stored) {
        const valid = await verifySession(stored);
        if (!valid) {
          // Stale / expired — clean up
          localStorage.removeItem(SESSION_KEY);
          setUser(null);
          setOrgs([]);
        }
      }

      setLoading(false);
    };

    init();
  }, [verifySession]);

  // ── Login ────────────────────────────────────────────────────────
  const login = useCallback(() => {
    // Redirect to the login endpoint; after OAuth GitHub will redirect
    // back with ?session=xxx which the init handler picks up.
    window.location.href = "/api/auth/github/login";
  }, []);

  // ── Logout ───────────────────────────────────────────────────────
  const logout = useCallback(async () => {
    const token = localStorage.getItem(SESSION_KEY);
    if (token) {
      try {
        await fetch("/api/auth/github/logout", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // best-effort
      }
      localStorage.removeItem(SESSION_KEY);
    }
    setUser(null);
    setOrgs([]);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, orgs, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
