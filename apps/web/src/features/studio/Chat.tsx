import { api } from "@meridian/api-client";
import {
  studioChatRoomResponseSchema,
  studioChatRoomSchema,
  type StudioChatRoom,
  type StudioMessage,
  type StudioRoomCreateInput,
  type StudioRoomUpdateInput,
} from "@meridian/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Hash,
  Lock,
  MessageSquare,
  Pencil,
  Plus,
  Send,
  Unlock,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Avatar } from "../../components/ui/Avatar";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/Card";
import { EmptyState } from "../../components/ui/EmptyState";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { Modal } from "../../components/ui/Modal";
import { Skeleton } from "../../components/ui/Skeleton";
import { Textarea } from "../../components/ui/Textarea";
import { queryKeys } from "../../lib/query";
import { cn, formatDateTime, relativeTime } from "../../lib/utils";
import { apiErrorMessage } from "../companies/lib";
import { StudioErrorCard, StudioSwitch } from "./shared";

const POLL_INTERVAL = 5_000;
const MESSAGE_LIMIT = 60;

/** Responses may be a bare room or a `{ room }` envelope; accept both. */
function unwrapRoom(result: unknown): StudioChatRoom | null {
  const enveloped = studioChatRoomResponseSchema.safeParse(result);
  if (enveloped.success) return enveloped.data.room;
  const bare = studioChatRoomSchema.safeParse(result);
  return bare.success ? bare.data : null;
}

interface RoomFormValues {
  name: string;
  description: string;
  isReadOnly: boolean;
}

function RoomFormModal({
  open,
  room,
  pending,
  onClose,
  onSubmit,
}: {
  open: boolean;
  room: StudioChatRoom | null;
  pending: boolean;
  onClose: () => void;
  onSubmit: (values: RoomFormValues) => void;
}) {
  const [name, setName] = useState(room?.name ?? "");
  const [description, setDescription] = useState(room?.description ?? "");
  const [isReadOnly, setIsReadOnly] = useState(room?.isReadOnly ?? false);
  const [nameError, setNameError] = useState<string | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError("A room name is required.");
      return;
    }
    setNameError(null);
    onSubmit({
      name: trimmed,
      description: description.trim(),
      isReadOnly,
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={room ? "Edit chat room" : "New chat room"}
      description={
        room
          ? "Rename the room, revise its description or change posting rules."
          : "Create a public website chat room. Members can post immediately."
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="studio-room-form"
            variant="primary"
            loading={pending}
          >
            {room ? "Save room" : "Create room"}
          </Button>
        </>
      }
    >
      <form id="studio-room-form" className="space-y-4" onSubmit={submit}>
        <Field
          label="Name"
          htmlFor="studio-room-name"
          required
          error={nameError}
        >
          <Input
            id="studio-room-name"
            data-autofocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={120}
            placeholder="Announcements"
          />
        </Field>
        <Field
          label="Description"
          htmlFor="studio-room-description"
          hint="Optional. Shown under the room name on the website."
        >
          <Textarea
            id="studio-room-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={500}
            rows={3}
            placeholder="Updates from the Meridian team."
          />
        </Field>
        <div className="flex items-center justify-between gap-4 rounded-input border border-border bg-surface-2/40 px-3 py-3">
          <div>
            <p className="text-sm text-fg">Read-only room</p>
            <p className="mt-0.5 text-xs text-muted">
              Members can follow the conversation but cannot post.
            </p>
          </div>
          <StudioSwitch
            checked={isReadOnly}
            onChange={setIsReadOnly}
            label="Read-only room"
          />
        </div>
      </form>
    </Modal>
  );
}

function MessagesSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading messages">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="flex gap-3">
          <Skeleton className="size-8 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

function MessageItem({
  message,
  onReply,
}: {
  message: StudioMessage;
  onReply: (message: StudioMessage) => void;
}) {
  return (
    <article className="group rounded-card border border-border bg-surface-2/30 p-3.5">
      <div className="flex items-start gap-3">
        <Avatar
          name={message.author?.name ?? "Website member"}
          src={message.author?.avatar}
          size="sm"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-fg">
              {message.author?.name ?? "Website member"}
            </span>
            {message.author?.role === "admin" ? (
              <Badge tone="violet">Website admin</Badge>
            ) : null}
            <span className="text-[11px] text-muted">
              {formatDateTime(message.createdAt)}
            </span>
            {message.edited ? (
              <span className="text-[11px] text-muted">· edited</span>
            ) : null}
          </div>
          <p className="mt-1.5 whitespace-pre-line break-words text-sm leading-relaxed text-fg/90">
            {message.content}
          </p>

          {message.reactions.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {message.reactions.map((reaction) => (
                <span
                  key={reaction.emoji}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-white/5 px-2 py-0.5 text-[11px] text-muted"
                >
                  {reaction.emoji}
                  <span className="num">{reaction.userIds.length}</span>
                </span>
              ))}
            </div>
          ) : null}

          <div className="mt-2 flex items-center gap-3 text-[11px] text-muted">
            <button
              type="button"
              className="font-medium text-muted underline-offset-4 hover:text-fg hover:underline"
              onClick={() => onReply(message)}
            >
              Reply
            </button>
            {message.replyCount > 0 ? (
              <span>
                {message.replyCount}{" "}
                {message.replyCount === 1 ? "reply" : "replies"}
              </span>
            ) : null}
          </div>

          {message.replies.length > 0 ? (
            <div className="mt-3 space-y-2 border-l border-border pl-3">
              {message.replies.map((reply) => (
                <div key={reply.id} className="flex items-start gap-2">
                  <Avatar
                    name={reply.author?.name ?? "Website member"}
                    src={reply.author?.avatar}
                    size="xs"
                  />
                  <div className="min-w-0">
                    <p className="text-xs text-fg">
                      <span className="font-medium">
                        {reply.author?.name ?? "Website member"}
                      </span>{" "}
                      <span className="text-muted">
                        {relativeTime(reply.createdAt)}
                      </span>
                    </p>
                    <p className="mt-0.5 whitespace-pre-line break-words text-xs leading-relaxed text-muted">
                      {reply.content}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export default function StudioChatPage() {
  const queryClient = useQueryClient();
  const [includeArchived, setIncludeArchived] = useState(false);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState<StudioChatRoom | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<StudioChatRoom | null>(
    null,
  );
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<StudioMessage | null>(null);

  const roomsQuery = useQuery({
    queryKey: queryKeys.studio.chatRooms(includeArchived),
    queryFn: () => api.studio.chatRooms({ includeArchived }),
    refetchInterval: POLL_INTERVAL,
  });

  const rooms: StudioChatRoom[] = roomsQuery.data?.items ?? [];

  const selectedRoom = rooms.find((room) => room.id === selectedRoomId) ?? null;

  const autoSelectedRoom = useRef(false);

  // Pick the first room once. Later selections (including the newly created
  // room) must not be overwritten by poll refreshes.
  useEffect(() => {
    if (autoSelectedRoom.current || !roomsQuery.data || rooms.length === 0) {
      return;
    }
    autoSelectedRoom.current = true;
    if (!selectedRoomId) {
      setSelectedRoomId(
        rooms.find((room) => !room.archived)?.id ?? rooms[0]?.id ?? null,
      );
    }
  }, [rooms, roomsQuery.data, selectedRoomId]);

  useEffect(() => {
    setDraft("");
    setReplyTo(null);
  }, [selectedRoomId]);

  const messagesKey = queryKeys.studio.messages(selectedRoomId ?? "", {
    limit: MESSAGE_LIMIT,
  });

  const messagesQuery = useQuery({
    queryKey: messagesKey,
    queryFn: () =>
      api.studio.messages(selectedRoomId ?? "", {
        limit: MESSAGE_LIMIT,
      }),
    enabled: Boolean(selectedRoomId),
    refetchInterval: POLL_INTERVAL,
  });

  const messages = [...(messagesQuery.data?.items ?? [])].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );

  const invalidateChat = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.studio.all });
  };

  const createRoom = useMutation({
    mutationFn: (input: StudioRoomCreateInput) => api.studio.createRoom(input),
    onSuccess: (result) => {
      toast.success("Chat room created");
      setCreateOpen(false);
      invalidateChat();
      const room = unwrapRoom(result);
      if (room) {
        setIncludeArchived(false);
        setSelectedRoomId(room.id);
      }
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const updateRoom = useMutation({
    mutationFn: ({ id, input }: { id: string; input: StudioRoomUpdateInput }) =>
      api.studio.updateRoom(id, input),
    onSuccess: () => {
      toast.success("Chat room updated");
      setEditingRoom(null);
      invalidateChat();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const archiveRoom = useMutation({
    mutationFn: (id: string) => api.studio.archiveRoom(id),
    onSuccess: (_result, id) => {
      toast.success("Chat room archived");
      setArchiveTarget(null);
      if (selectedRoomId === id) setSelectedRoomId(null);
      invalidateChat();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const sendMessage = useMutation({
    mutationFn: ({
      roomId,
      content,
      parentId,
    }: {
      roomId: string;
      content: string;
      parentId?: string;
    }) => api.studio.sendMessage(roomId, { content, parentId }),
    onSuccess: (_result, variables) => {
      setDraft("");
      setReplyTo(null);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.studio.messages(variables.roomId, {
          limit: MESSAGE_LIMIT,
        }),
      });
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || !selectedRoomId || sendMessage.isPending) return;
    sendMessage.mutate({
      roomId: selectedRoomId,
      content,
      parentId: replyTo?.id,
    });
  }

  const canPost = Boolean(selectedRoom) && !selectedRoom?.archived;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-light tracking-tight text-fg">
            Live chat
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
            Website chat rooms. Messages refresh every five seconds; posts are
            attributed to your CRM email.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-muted">
            <StudioSwitch
              checked={includeArchived}
              onChange={(value) => {
                setIncludeArchived(value);
                if (!value && selectedRoom?.archived) {
                  setSelectedRoomId(
                    rooms.find((room) => !room.archived)?.id ?? null,
                  );
                }
              }}
              label="Show archived chat rooms"
            />
            Show archived
          </label>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="size-4" aria-hidden="true" />
            New room
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <Card className="flex h-[560px] flex-col overflow-hidden">
          <CardHeader className="border-b border-border">
            <div>
              <CardTitle>Rooms</CardTitle>
              <CardDescription>Public website conversations.</CardDescription>
            </div>
            <span className="num text-xs text-muted">{rooms.length}</span>
          </CardHeader>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {roomsQuery.isPending ? (
              <div
                className="space-y-2 p-2"
                role="status"
                aria-label="Loading rooms"
              >
                {Array.from({ length: 5 }).map((_, index) => (
                  <Skeleton key={index} className="h-14" />
                ))}
              </div>
            ) : roomsQuery.isError ? (
              <div className="p-3">
                <p className="text-sm text-danger">Could not load rooms.</p>
                <p className="mt-1 text-xs text-muted">
                  {apiErrorMessage(roomsQuery.error)}
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  onClick={() => void roomsQuery.refetch()}
                >
                  Try again
                </Button>
              </div>
            ) : rooms.length === 0 ? (
              <div className="p-3">
                <EmptyState
                  icon={<MessageSquare />}
                  title="No chat rooms"
                  description="Create a room to open the first conversation."
                  className="px-4 py-8"
                />
              </div>
            ) : (
              <ul className="space-y-1">
                {rooms.map((room) => {
                  const active = room.id === selectedRoomId;
                  return (
                    <li key={room.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedRoomId(room.id)}
                        aria-current={active ? "true" : undefined}
                        className={cn(
                          "w-full rounded-input px-3 py-2.5 text-left transition-colors",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                          active
                            ? "bg-white/[0.06] text-fg"
                            : "text-muted hover:bg-white/[0.04] hover:text-fg",
                        )}
                      >
                        <span className="flex items-center gap-2">
                          <Hash
                            className={cn(
                              "size-3.5 shrink-0",
                              active ? "text-accent" : "text-muted",
                            )}
                            aria-hidden="true"
                          />
                          <span className="min-w-0 flex-1 truncate text-sm">
                            {room.name}
                          </span>
                          {room.isReadOnly ? (
                            <Lock
                              className="size-3 text-muted"
                              aria-label="Read-only"
                            />
                          ) : null}
                          {room.archived ? (
                            <Badge tone="warning">Archived</Badge>
                          ) : null}
                        </span>
                        <span className="mt-1 flex items-center justify-between gap-2 pl-5 text-[11px] text-muted">
                          <span className="truncate">
                            {room.lastMessageAt
                              ? relativeTime(room.lastMessageAt)
                              : "No messages yet"}
                          </span>
                          {typeof room.messageCount === "number" ? (
                            <span className="num shrink-0">
                              {room.messageCount}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Card>

        <Card className="flex h-[560px] flex-col overflow-hidden">
          {selectedRoom ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-sm font-medium text-fg">
                      #{selectedRoom.name}
                    </h3>
                    {selectedRoom.isReadOnly ? (
                      <Badge tone="neutral">
                        <Lock className="size-3" aria-hidden="true" />
                        Read-only
                      </Badge>
                    ) : (
                      <Badge tone="success">
                        <Unlock className="size-3" aria-hidden="true" />
                        Open
                      </Badge>
                    )}
                    {selectedRoom.archived ? (
                      <Badge tone="warning">Archived</Badge>
                    ) : null}
                  </div>
                  {selectedRoom.description ? (
                    <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted">
                      {selectedRoom.description}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditingRoom(selectedRoom)}
                  >
                    <Pencil className="size-3.5" aria-hidden="true" />
                    Edit
                  </Button>
                  {!selectedRoom.archived ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setArchiveTarget(selectedRoom)}
                    >
                      <Archive className="size-3.5" aria-hidden="true" />
                      Archive
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
                {messagesQuery.isPending ? (
                  <MessagesSkeleton />
                ) : messagesQuery.isError ? (
                  <StudioErrorCard
                    title="Could not load this room."
                    error={messagesQuery.error}
                    onRetry={() => void messagesQuery.refetch()}
                  />
                ) : messages.length === 0 ? (
                  <div className="flex h-full items-center justify-center">
                    <EmptyState
                      icon={<MessageSquare />}
                      title="No messages yet"
                      description="Start the conversation below."
                      className="border-0 bg-transparent py-8"
                    />
                  </div>
                ) : (
                  messages.map((message) => (
                    <MessageItem
                      key={message.id}
                      message={message}
                      onReply={setReplyTo}
                    />
                  ))
                )}
              </div>

              <form
                onSubmit={handleSend}
                className="border-t border-border p-3"
              >
                {replyTo ? (
                  <div className="mb-2 flex items-center justify-between gap-2 rounded-input border border-border bg-surface-2/50 px-3 py-1.5 text-xs text-muted">
                    <span className="truncate">
                      Replying to{" "}
                      <span className="text-fg">
                        {replyTo.author?.name ?? "Website member"}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="shrink-0 font-medium text-accent underline-offset-4 hover:underline"
                      onClick={() => setReplyTo(null)}
                    >
                      Cancel
                    </button>
                  </div>
                ) : null}
                <div className="flex items-end gap-2">
                  <Textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (
                        event.key === "Enter" &&
                        !event.shiftKey &&
                        !event.nativeEvent.isComposing
                      ) {
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                    rows={2}
                    maxLength={4000}
                    disabled={!canPost || sendMessage.isPending}
                    placeholder={
                      selectedRoom.archived
                        ? "Archived rooms cannot receive messages."
                        : selectedRoom.isReadOnly
                          ? "Read-only room — posting still available to CRM staff."
                          : `Message #${selectedRoom.name}`
                    }
                    aria-label="Message"
                    className="min-h-16 resize-none"
                  />
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={!canPost || !draft.trim()}
                    loading={sendMessage.isPending}
                    aria-label="Send message"
                  >
                    <Send className="size-4" aria-hidden="true" />
                  </Button>
                </div>
                <p className="mt-1.5 text-[10px] text-muted">
                  Enter sends · Shift + Enter adds a line · refreshes every 5s
                </p>
              </form>
            </>
          ) : (
            <div className="flex h-full items-center justify-center p-6">
              <EmptyState
                icon={<MessageSquare />}
                title={rooms.length === 0 ? "No chat rooms" : "Select a room"}
                description={
                  rooms.length === 0
                    ? "Create a room to start the first conversation."
                    : "Pick a room from the list to read and reply."
                }
                className="border-0 bg-transparent"
              />
            </div>
          )}
        </Card>
      </div>

      <RoomFormModal
        key={createOpen ? "create-room" : "create-room-closed"}
        open={createOpen}
        room={null}
        pending={createRoom.isPending}
        onClose={() => setCreateOpen(false)}
        onSubmit={(values) => createRoom.mutate(values)}
      />

      {editingRoom ? (
        <RoomFormModal
          key={`edit-${editingRoom.id}`}
          open
          room={editingRoom}
          pending={updateRoom.isPending}
          onClose={() => setEditingRoom(null)}
          onSubmit={(values) =>
            updateRoom.mutate({ id: editingRoom.id, input: values })
          }
        />
      ) : null}

      <Modal
        open={Boolean(archiveTarget)}
        onClose={() => setArchiveTarget(null)}
        title="Archive chat room"
        description={
          archiveTarget
            ? `Archive #${archiveTarget.name}? Members will no longer see it in the website room list.`
            : undefined
        }
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setArchiveTarget(null)}
              disabled={archiveRoom.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={archiveRoom.isPending}
              onClick={() => {
                if (archiveTarget) archiveRoom.mutate(archiveTarget.id);
              }}
            >
              <Archive className="size-4" aria-hidden="true" />
              Archive room
            </Button>
          </>
        }
      />
    </div>
  );
}
