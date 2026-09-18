import { useUser } from "@clerk/react";

/**
 * Whether the signed-in user is on the VITE_ADMIN_EMAILS allowlist. This only
 * decides what the UI offers; the API enforces the same list on every write.
 */
export function useIsAdmin(): boolean {
  const { isSignedIn, user } = useUser();
  const adminEmails = new Set(
    import.meta.env.VITE_ADMIN_EMAILS
      ?.split(",")
      .map((email: string) => email.trim().toLocaleLowerCase())
      .filter(Boolean),
  );
  return Boolean(
    isSignedIn &&
    adminEmails.size > 0 &&
    user?.emailAddresses.some(
      ({ emailAddress }) =>
        adminEmails.has(emailAddress.trim().toLocaleLowerCase()),
    ),
  );
}
