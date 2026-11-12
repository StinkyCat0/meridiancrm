import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, MailPlus, RefreshCw, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import {
  api,
  ApiError,
  type Invite,
  type Member,
  type Role,
} from "@meridian/api-client";
import { atLeast } from "@meridian/contracts";
import { Avatar } from "../../components/ui/Avatar";
import { Badge, type BadgeTone } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/Card";
import { Field } from "../../components/ui/Field";
import { IconButton } from "../../components/ui/IconButton";
import { Input } from "../../components/ui/Input";
import { Modal } from "../../components/ui/Modal";
import { Select } from "../../components/ui/Select";
import { Skeleton } from "../../components/ui/Skeleton";
import { Tooltip } from "../../components/ui/Tooltip";
import { useAuth } from "../../lib/auth";
import { queryKeys } from "../../lib/query";
import { formatDate, relativeTime } from "../../lib/utils";

type AssignableRole = "ADMIN" | "MEMBER";

const ROLE_TONE: Record<Role, BadgeTone> = {
  OWNER: "violet",
  ADMIN: "accent",
  MEMBER: "neutral",
};

function messageFor(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

function MembersSkeleton() {
  return (
    <div
      className="divide-y divide-border"
      role="status"
      aria-label="Loading members"
    >
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex items-center gap-3 p-4">
          <Skeleton className="size-9 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
          <Skeleton className="h-8 w-24" />
        </div>
      ))}
    </div>
  );
}

function InviteStatus({ invite }: { invite: Invite }) {
  const expired = new Date(invite.expiresAt).getTime() < Date.now();
  if (expired) return <Badge tone="danger">Expired</Badge>;
  return (
    <span className="text-xs text-muted" title={formatDate(invite.expiresAt)}>
      Expires {relativeTime(invite.expiresAt)}
    </span>
  );
}

export function TeamSection() {
  const { user, role, refreshMe } = useAuth();
  const queryClient = useQueryClient();
  const canManage = role ? atLeast(role, "ADMIN") : false;
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<AssignableRole>("MEMBER");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [removing, setRemoving] = useState<Member | null>(null);

  const membersQuery = useQuery({
    queryKey: queryKeys.workspace.members,
    queryFn: api.workspace.members,
  });
  const invitesQuery = useQuery({
    queryKey: queryKeys.workspace.invites,
    queryFn: api.workspace.invites,
    enabled: canManage,
  });

  const roleMutation = useMutation({
    mutationFn: ({
      id,
      role: nextRole,
    }: {
      id: string;
      role: AssignableRole;
    }) => api.workspace.updateMember(id, { role: nextRole }),
    onSuccess: async (member) => {
      toast.success("Role updated");
      await queryClient.invalidateQueries({
        queryKey: queryKeys.workspace.members,
      });
      void queryClient.invalidateQueries({ queryKey: ["workspace", "audit"] });
      if (member.user.id === user?.id) await refreshMe();
    },
    onError: (error) =>
      toast.error(messageFor(error, "Could not change the role.")),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => api.workspace.removeMember(id),
    onSuccess: () => {
      toast.success("Member removed");
      setRemoving(null);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.workspace.members,
      });
      void queryClient.invalidateQueries({ queryKey: ["workspace", "audit"] });
    },
    onError: (error) =>
      toast.error(messageFor(error, "Could not remove the member.")),
  });

  const inviteMutation = useMutation({
    mutationFn: (input: { email: string; role: AssignableRole }) =>
      api.workspace.createInvite(input),
    onSuccess: (result) => {
      setInviteUrl(result.inviteUrl);
      setEmail("");
      setCopied(false);
      setInviteError(null);
      toast.success("Invite link ready");
      void queryClient.invalidateQueries({
        queryKey: queryKeys.workspace.invites,
      });
      void queryClient.invalidateQueries({ queryKey: ["workspace", "audit"] });
    },
    onError: (error) => {
      const message = messageFor(error, "Could not create the invite.");
      setInviteError(message);
      toast.error(message);
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => api.workspace.revokeInvite(id),
    onSuccess: () => {
      toast.success("Invite revoked");
      void queryClient.invalidateQueries({
        queryKey: queryKeys.workspace.invites,
      });
      void queryClient.invalidateQueries({ queryKey: ["workspace", "audit"] });
    },
    onError: (error) =>
      toast.error(messageFor(error, "Could not revoke the invite.")),
  });

  function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setInviteError(null);
    const trimmed = email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) {
      setInviteError("Enter a valid email address.");
      return;
    }
    inviteMutation.mutate({ email: trimmed, role: inviteRole });
  }

  async function copyInviteUrl() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      toast.success("Invite link copied");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Copy failed. Select the link manually.");
    }
  }

  const pendingInvites = (invitesQuery.data ?? []).filter(
    (invite) => !invite.acceptedAt,
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Team</CardTitle>
            <CardDescription className="mt-1">
              {canManage
                ? "Manage roles, remove members, and invite teammates."
                : "Everyone with access to this workspace. Admins manage roles."}
            </CardDescription>
          </div>
          <Badge tone="neutral">
            {membersQuery.data?.length ?? 0}{" "}
            {membersQuery.data?.length === 1 ? "member" : "members"}
          </Badge>
        </CardHeader>
        <CardContent className="p-0">
          {membersQuery.isLoading ? <MembersSkeleton /> : null}

          {membersQuery.isError ? (
            <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
              <p className="text-sm font-medium text-fg">
                Could not load the team
              </p>
              <p className="mt-1.5 text-sm text-muted">
                {messageFor(
                  membersQuery.error,
                  "Check your connection and try again.",
                )}
              </p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-4"
                onClick={() => void membersQuery.refetch()}
              >
                <RefreshCw className="size-3.5" aria-hidden="true" />
                Try again
              </Button>
            </div>
          ) : null}

          {membersQuery.data ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead>
                  <tr className="border-y border-border text-[10px] uppercase tracking-[0.16em] text-muted">
                    <th scope="col" className="px-4 py-2.5 font-black">
                      Member
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-black">
                      Role
                    </th>
                    <th
                      scope="col"
                      className="hidden px-4 py-2.5 font-black md:table-cell"
                    >
                      Joined
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-right font-black"
                    >
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {membersQuery.data.map((member) => {
                    const self = member.user.id === user?.id;
                    return (
                      <tr key={member.id} className="align-middle">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <Avatar
                              name={member.user.name}
                              src={member.user.avatarUrl}
                              size="sm"
                            />
                            <div className="min-w-0">
                              <p className="flex items-center gap-1.5 truncate text-sm text-fg">
                                {member.user.name}
                                {self ? (
                                  <Badge tone="neutral">You</Badge>
                                ) : null}
                              </p>
                              <p className="truncate text-xs text-muted">
                                {member.user.email}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {member.role === "OWNER" || !canManage ? (
                            <Badge tone={ROLE_TONE[member.role]}>
                              {member.role}
                            </Badge>
                          ) : (
                            <Select
                              aria-label={`Role for ${member.user.name}`}
                              value={member.role}
                              disabled={roleMutation.isPending}
                              onChange={(event) =>
                                roleMutation.mutate({
                                  id: member.id,
                                  role:
                                    event.target.value === "ADMIN"
                                      ? "ADMIN"
                                      : "MEMBER",
                                })
                              }
                              className="w-32"
                            >
                              <option value="MEMBER">Member</option>
                              <option value="ADMIN">Admin</option>
                            </Select>
                          )}
                        </td>
                        <td className="hidden px-4 py-3 text-xs text-muted md:table-cell">
                          {formatDate(member.joinedAt)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {canManage &&
                          !self &&
                          (member.role !== "OWNER" || role === "OWNER") ? (
                            <Tooltip label="Remove member">
                              <IconButton
                                label={`Remove ${member.user.name}`}
                                variant="danger"
                                size="sm"
                                onClick={() => {
                                  removeMutation.reset();
                                  setRemoving(member);
                                }}
                              >
                                <Trash2 aria-hidden="true" />
                              </IconButton>
                            </Tooltip>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {canManage ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Invite teammate</CardTitle>
                <CardDescription className="mt-1">
                  Generate a single-use link valid for seven days.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={handleInvite}>
                <Field label="Email" htmlFor="invite-email" required>
                  <Input
                    id="invite-email"
                    type="email"
                    value={email}
                    placeholder="name@studio.com"
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </Field>
                <Field label="Role" htmlFor="invite-role">
                  <Select
                    id="invite-role"
                    value={inviteRole}
                    onChange={(event) =>
                      setInviteRole(
                        event.target.value === "ADMIN" ? "ADMIN" : "MEMBER",
                      )
                    }
                  >
                    <option value="MEMBER">Member</option>
                    <option value="ADMIN">Admin</option>
                  </Select>
                </Field>

                {inviteError ? (
                  <p
                    role="alert"
                    className="text-sm leading-relaxed text-danger"
                  >
                    {inviteError}
                  </p>
                ) : null}

                <Button
                  type="submit"
                  variant="primary"
                  loading={inviteMutation.isPending}
                >
                  <MailPlus className="size-4" aria-hidden="true" />
                  Create invite
                </Button>
              </form>

              {inviteUrl ? (
                <div className="mt-5 rounded-input border border-accent/25 bg-accent/5 p-3">
                  <p className="label-micro">Invite link</p>
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                    <Input
                      value={inviteUrl}
                      readOnly
                      aria-label="Invite link"
                      className="min-w-0 text-xs"
                    />
                    <Button
                      variant="secondary"
                      onClick={() => void copyInviteUrl()}
                    >
                      {copied ? (
                        <Check
                          className="size-4 text-success"
                          aria-hidden="true"
                        />
                      ) : (
                        <Copy className="size-4" aria-hidden="true" />
                      )}
                      {copied ? "Copied" : "Copy"}
                    </Button>
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-muted">
                    Share this link with the invitee. It expires in seven days.
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Pending invites</CardTitle>
                <CardDescription className="mt-1">
                  Unaccepted invites for this workspace.
                </CardDescription>
              </div>
              <Badge tone="neutral">{pendingInvites.length}</Badge>
            </CardHeader>
            <CardContent className="p-0">
              {invitesQuery.isLoading ? <MembersSkeleton /> : null}

              {invitesQuery.isError ? (
                <div className="px-4 py-6 text-center">
                  <p className="text-sm text-muted">
                    {messageFor(invitesQuery.error, "Could not load invites.")}
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-3"
                    onClick={() => void invitesQuery.refetch()}
                  >
                    <RefreshCw className="size-3.5" aria-hidden="true" />
                    Try again
                  </Button>
                </div>
              ) : null}

              {invitesQuery.isSuccess && pendingInvites.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-muted">
                  No pending invites.
                </p>
              ) : null}

              {pendingInvites.length > 0 ? (
                <ul className="divide-y divide-border border-t border-border">
                  {pendingInvites.map((invite) => (
                    <li
                      key={invite.id}
                      className="flex items-center justify-between gap-3 px-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm text-fg">
                          {invite.email}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <Badge tone={ROLE_TONE[invite.role]}>
                            {invite.role}
                          </Badge>
                          <InviteStatus invite={invite} />
                        </div>
                      </div>
                      <Tooltip label="Revoke invite">
                        <IconButton
                          label={`Revoke invite for ${invite.email}`}
                          variant="danger"
                          size="sm"
                          disabled={revokeMutation.isPending}
                          onClick={() => revokeMutation.mutate(invite.id)}
                        >
                          <Trash2 aria-hidden="true" />
                        </IconButton>
                      </Tooltip>
                    </li>
                  ))}
                </ul>
              ) : null}
            </CardContent>
          </Card>
        </div>
      ) : null}

      <Modal
        open={removing !== null}
        onClose={() => {
          if (!removeMutation.isPending) setRemoving(null);
        }}
        title="Remove member?"
        description={
          removing
            ? `${removing.user.name} will lose access to this workspace.`
            : undefined
        }
        size="sm"
        closeOnBackdrop={!removeMutation.isPending}
        footer={
          <>
            <Button
              variant="ghost"
              disabled={removeMutation.isPending}
              onClick={() => setRemoving(null)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={removeMutation.isPending}
              onClick={() => {
                if (removing) removeMutation.mutate(removing.id);
              }}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              Remove
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-muted">
          Their records stay in the workspace. They can be invited again later.
        </p>
        {removeMutation.isError ? (
          <p role="alert" className="mt-3 text-sm text-danger">
            {messageFor(removeMutation.error, "Could not remove the member.")}
          </p>
        ) : null}
      </Modal>
    </div>
  );
}
