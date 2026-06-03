import { createContext, useContext, useEffect, useState } from "react";
import { useGetMe, useLogin, useLogout, setAuthTokenGetter, getGetMeQueryKey } from "@workspace/api-client-react";
import type { User, LoginBody } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { clearPreviewCache } from "./preview-cache";
import { subscribeIfGranted } from "@/lib/push";

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (data: LoginBody) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("nch_token"));
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  useEffect(() => {
    setAuthTokenGetter(() => token);
    if (token) {
      localStorage.setItem("nch_token", token);
    } else {
      localStorage.removeItem("nch_token");
      // Drop any cached Drive preview blobs so a different user on the
      // same browser can't reopen the previous user's files from IDB.
      void clearPreviewCache();
    }
  }, [token]);

  const { data: user, isLoading: isUserLoading, isError } = useGetMe({
    query: {
      enabled: !!token,
      retry: false,
      queryKey: getGetMeQueryKey(),
    },
  });

  useEffect(() => {
    if (isError) {
      setToken(null);
    }
  }, [isError]);

  // Re-register push subscription whenever the authenticated user changes.
  // Uses subscribeIfGranted() which only proceeds when permission is already
  // "granted" — it never triggers the system permission dialog.  The iOS
  // first-run banner (NotificationBanner) calls setupPushNotifications()
  // from an explicit tap, giving users context before the dialog appears.
  useEffect(() => {
    if (user) {
      void subscribeIfGranted();
    }
  // user.role is the stable identity key for this app's auth model.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role ?? null]);

  const loginMutation = useLogin();
  const logoutMutation = useLogout();

  const login = async (data: LoginBody) => {
    // Wipe any leftover query data from a previous user before authenticating.
    // Safe to do here because we're on the /login page — no protected
    // components are mounted that could crash when their cache is yanked.
    queryClient.clear();
    const response = await loginMutation.mutateAsync({ data });
    setToken(response.token);
    setLocation("/");
  };

  const logout = async () => {
    try {
      await logoutMutation.mutateAsync();
    } catch {
      // Server logout is best-effort — log out client-side regardless.
    }
    // Surgical: remove ONLY the cached `getMe` user. We can't call
    // queryClient.clear() here because the protected page the user clicked
    // Log Out from is still mounted, and yanking all query data out from
    // under its still-subscribed components crashes the tree (no error
    // boundary => blank white page).
    //
    // Removing just the user is enough to fix the bounce-back bug: the
    // /login route renders `user ? <Redirect to="/"/> : <Login/>`, and
    // without this line the cached user keeps redirecting us right back
    // to the dashboard the moment we navigate away.
    //
    // The full cache wipe for cross-user privacy happens in `login()`
    // above, when no protected components are mounted to crash.
    queryClient.removeQueries({ queryKey: getGetMeQueryKey() });
    setToken(null);
    setLocation("/login");
    // Fire-and-forget: the IDB preview blobs get cleared by the token
    // effect too, but doing it here as well removes any race window.
    void clearPreviewCache();
  };

  const isLoading = isUserLoading && !!token;

  return (
    <AuthContext.Provider value={{ user: user || null, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
