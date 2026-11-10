import { useQueryClient } from "@tanstack/react-query";
import { LogOut, ShieldCheck } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api, ApiError } from "@meridian/api-client";
import { Avatar } from "../../components/ui/Avatar";
import { Button } from "../../components/ui/Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/Card";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { useAuth } from "../../lib/auth";
import { queryKeys } from "../../lib/query";

function messageFor(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export function ProfileSection() {
  const { user, refreshMe, logout } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState(user?.name ?? "");
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? "");
  const [profileError, setProfileError] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    setName(user?.name ?? "");
    setAvatarUrl(user?.avatarUrl ?? "");
  }, [user]);

  async function handleProfileSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProfileError(null);
    const trimmedName = name.trim();
    if (trimmedName.length < 2 || trimmedName.length > 80) {
      setProfileError("Name must be between 2 and 80 characters.");
      return;
    }
    const trimmedAvatar = avatarUrl.trim();
    if (trimmedAvatar.length > 0) {
      try {
        new URL(trimmedAvatar);
      } catch {
        setProfileError("Avatar URL must be a complete https:// address.");
        return;
      }
    }

    setSavingProfile(true);
    try {
      await api.auth.updateProfile({
        name: trimmedName,
        avatarUrl: trimmedAvatar || null,
      });
      await refreshMe();
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth.me });
      await queryClient.invalidateQueries({ queryKey: queryKeys.workspace.members });
      await queryClient.invalidateQueries({ queryKey: ["workspace", "audit"] });
      toast.success("Profile updated");
    } catch (cause) {
      const message = messageFor(cause, "Could not update your profile.");
      setProfileError(message);
      toast.error(message);
    } finally {
      setSavingProfile(false);
    }
  }

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError(null);
    if (newPassword.length < 10) {
      setPasswordError("Password must be at least 10 characters.");
      return;
    }
    if (!/[a-zA-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      setPasswordError("Password must contain a letter and a number.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords do not match.");
      return;
    }

    setSavingPassword(true);
    try {
      await api.auth.changePassword({
        currentPassword,
        newPassword,
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success("Password updated");
    } catch (cause) {
      const message = messageFor(cause, "Could not change your password.");
      setPasswordError(message);
      toast.error(message);
    } finally {
      setSavingPassword(false);
    }
  }

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await logout();
      navigate("/login", { replace: true });
    } catch {
      toast.error("Sign out failed. Check your connection and try again.");
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Profile</CardTitle>
            <CardDescription className="mt-1">
              How you appear across the workspace.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={(event) => void handleProfileSubmit(event)}>
            <div className="flex items-center gap-3">
              <Avatar name={name || user?.name || "Unassigned"} src={avatarUrl || null} size="lg" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-fg">{name || "Your name"}</p>
                <p className="truncate text-xs text-muted">{user?.email ?? "—"}</p>
              </div>
            </div>

            <Field label="Name" htmlFor="profile-name" required>
              <Input
                id="profile-name"
                value={name}
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>

            <Field label="Avatar URL" htmlFor="profile-avatar" hint="Optional. Use a full URL.">
              <Input
                id="profile-avatar"
                type="url"
                value={avatarUrl}
                maxLength={500}
                placeholder="https://…"
                onChange={(event) => setAvatarUrl(event.target.value)}
              />
            </Field>

            <Field label="Email" htmlFor="profile-email" hint="Email cannot be changed here.">
              <Input id="profile-email" value={user?.email ?? ""} readOnly className="opacity-60" />
            </Field>

            {profileError ? (
              <p role="alert" className="text-sm leading-relaxed text-danger">
                {profileError}
              </p>
            ) : null}

            <Button type="submit" variant="primary" loading={savingProfile}>
              Save profile
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Password</CardTitle>
              <CardDescription className="mt-1">
                Changing your password signs out other refresh sessions.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={(event) => void handlePasswordSubmit(event)}>
              <Field label="Current password" htmlFor="password-current" required>
                <Input
                  id="password-current"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                />
              </Field>
              <Field label="New password" htmlFor="password-new" required hint="10+ characters with a letter and a number.">
                <Input
                  id="password-new"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
              </Field>
              <Field label="Confirm new password" htmlFor="password-confirm" required>
                <Input
                  id="password-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                />
              </Field>

              {passwordError ? (
                <p role="alert" className="text-sm leading-relaxed text-danger">
                  {passwordError}
                </p>
              ) : null}

              <Button type="submit" variant="secondary" loading={savingPassword}>
                <ShieldCheck className="size-4" aria-hidden="true" />
                Change password
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Session</CardTitle>
              <CardDescription className="mt-1">
                End this session and return to the sign-in screen.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <Button variant="danger" loading={signingOut} onClick={() => void handleSignOut()}>
              <LogOut className="size-4" aria-hidden="true" />
              Sign out
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
