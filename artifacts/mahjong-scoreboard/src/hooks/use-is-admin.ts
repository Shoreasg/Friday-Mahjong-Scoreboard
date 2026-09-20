import { useUser } from "@clerk/react";
import { getGetCurrentUserQueryKey, useGetCurrentUser } from "@workspace/api-client-react";

/**
 * Admin status for the signed-in user, backed by GET /api/me. The API
 * enforces the same allowlist (ADMIN_EMAILS or the admins table) on every
 * write; this only decides what the UI offers, and already lands a beat
 * after load since it depends on Clerk's async useUser() first.
 */
export function useAdminStatus(): {
  isAdmin: boolean;
  isSuperAdmin: boolean;
  isLoading: boolean;
} {
  const { isLoaded, isSignedIn } = useUser();
  const { data, isLoading } = useGetCurrentUser({
    query: { queryKey: getGetCurrentUserQueryKey(), enabled: Boolean(isSignedIn) },
  });

  return {
    isAdmin: Boolean(isSignedIn && data?.isAdmin),
    isSuperAdmin: Boolean(isSignedIn && data?.isSuperAdmin),
    // Not loaded yet, or signed in and still waiting on /api/me.
    isLoading: !isLoaded || Boolean(isSignedIn && isLoading),
  };
}

export function useIsAdmin(): boolean {
  return useAdminStatus().isAdmin;
}

/**
 * Only ADMIN_EMAILS entries are super admins. Shares the same /api/me query
 * as useIsAdmin() (and useAdminStatus() generally), so checking this
 * alongside isAdmin never costs an extra request.
 */
export function useIsSuperAdmin(): boolean {
  return useAdminStatus().isSuperAdmin;
}
