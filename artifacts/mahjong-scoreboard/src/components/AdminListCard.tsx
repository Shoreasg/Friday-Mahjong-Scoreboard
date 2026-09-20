import { useState } from "react";
import { toast } from "sonner";
import {
  getListAdminsQueryKey,
  getListClerkUsersQueryKey,
  useGrantAdmin,
  useListAdmins,
  useListClerkUsers,
  useRevokeAdmin,
  type AdminEntry,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ShieldPlus, Trash2, UserPlus } from "lucide-react";
import { queryClient } from "@/lib/queryClient";
import { useIsSuperAdmin } from "@/hooks/use-is-admin";

function sortAdmins(admins: AdminEntry[]): AdminEntry[] {
  return [...admins].sort((a, b) => a.email.localeCompare(b.email));
}

export function AdminListCard() {
  const isSuperAdmin = useIsSuperAdmin();
  const { data: admins, isLoading } = useListAdmins();
  const { data: clerkUsers } = useListClerkUsers({
    query: { queryKey: getListClerkUsersQueryKey(), enabled: isSuperAdmin },
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");

  const grantedEmails = new Set((admins ?? []).map((admin) => admin.email));
  const candidates = (clerkUsers ?? []).filter(
    (user) => !grantedEmails.has(user.email.trim().toLowerCase()),
  );

  const grantMutation = useGrantAdmin({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAdminsQueryKey() });
        setPickerOpen(false);
        setQuery("");
        toast.success("Admin access granted");
      },
      onError: () => toast.error("Could not grant admin access"),
    },
  });

  const revokeMutation = useRevokeAdmin({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAdminsQueryKey() });
        toast.success("Admin access revoked");
      },
      onError: () => toast.error("Could not revoke admin access"),
    },
  });

  return (
    <Card className="bg-card">
      <CardContent className="p-6">
        <div className="mb-4 flex items-center gap-2">
          <ShieldPlus className="w-6 h-6 text-foreground" strokeWidth={3} />
          <div className="text-sm text-foreground uppercase tracking-widest font-black">
            Admins
          </div>
        </div>

        {isLoading ? (
          <p className="font-bold text-muted-foreground uppercase tracking-wide" data-testid="text-admins-loading">
            Loading admins...
          </p>
        ) : (
          <div className="space-y-4">
            <ul className="divide-y-2 divide-ink border-2 border-ink">
              {sortAdmins(admins ?? []).map((admin) => (
                <li
                  key={admin.email}
                  className="flex items-center justify-between gap-3 p-3"
                  data-testid={`row-admin-${admin.email}`}
                >
                  <div className="min-w-0">
                    <p className="truncate font-black text-foreground">{admin.email}</p>
                    {admin.source === "env" ? (
                      <Badge variant="outline" className="mt-1">
                        FROM ENV
                      </Badge>
                    ) : (
                      <p className="text-xs font-bold text-muted-foreground">
                        Granted by {admin.grantedBy}
                      </p>
                    )}
                  </div>
                  {isSuperAdmin && admin.source === "table" && (
                    <Button
                      size="icon"
                      variant="destructive"
                      className="h-9 w-9 shrink-0 border-2"
                      onClick={() => revokeMutation.mutate({ email: admin.email })}
                      disabled={revokeMutation.isPending}
                      aria-label={`Revoke admin access for ${admin.email}`}
                      data-testid={`button-revoke-${admin.email}`}
                    >
                      <Trash2 className="size-4" strokeWidth={3} />
                    </Button>
                  )}
                </li>
              ))}
            </ul>

            {isSuperAdmin && (
              <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                <PopoverTrigger asChild>
                  <Button size="sm" variant="outline" data-testid="button-grant-admin">
                    <UserPlus className="mr-2 size-4" strokeWidth={3} />
                    Grant Admin
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="p-0" align="start">
                  <Command>
                    <CommandInput
                      placeholder="Search signed-up users..."
                      value={query}
                      onValueChange={setQuery}
                    />
                    <CommandList>
                      <CommandEmpty>No matching users.</CommandEmpty>
                      <CommandGroup>
                        {candidates.map((user) => (
                          <CommandItem
                            key={user.id}
                            value={`${user.name ?? ""} ${user.email}`}
                            onSelect={() =>
                              grantMutation.mutate({ data: { email: user.email } })
                            }
                            data-testid={`option-grant-${user.email}`}
                          >
                            <div className="min-w-0">
                              <p className="truncate font-bold">{user.name ?? user.email}</p>
                              {user.name && (
                                <p className="truncate text-xs text-muted-foreground">
                                  {user.email}
                                </p>
                              )}
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
