import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Send,
  Inbox,
  CheckCircle2,
  XCircle,
  Clock,
  Megaphone,
  Archive,
  CheckCheck,
  ExternalLink,
  RotateCcw,
} from "lucide-react";
import ReactQuill from "react-quill";
import "react-quill/dist/quill.snow.css";
import { api, type Paged } from "../lib/api";
import { getErrorMessage } from "../lib/errors";
import { useToast } from "../lib/toast";
import { getAuth } from "../lib/auth";
import { fmtDate } from "../lib/format";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";

type Notification = {
  id: string;
  channel: string;
  title: string;
  body: string;
  status: string;
  category: string;
  link?: string | null;
  readAt?: string | null;
  recipientEmail?: string | null;
  error?: string | null;
  createdAt: string;
};
type NotificationPreference = {
  eventType: string;
  channel: "IN_APP" | "EMAIL";
  enabled: boolean;
};
type NotificationCampaign = {
  id: string;
  subject: string;
  status: string;
  scheduledAt: string;
  totalRecipients: number;
  processedRecipients: number;
  failedRecipients: number;
};
type NotificationOperations = {
  deliveries: Array<{
    channel: string;
    status: string;
    _count: { _all: number };
  }>;
  outbox: Array<{ status: string; _count: { _all: number } }>;
  campaigns: Array<{ status: string; _count: { _all: number } }>;
  recentFailures: Array<{ id: string }>;
};

const STATUS_ICON: Record<string, React.ReactNode> = {
  SENT: <CheckCircle2 size={14} className="text-emerald-500" />,
  READ: <CheckCircle2 size={14} className="text-slate-400" />,
  QUEUED: <Clock size={14} className="text-amber-500" />,
  FAILED: <XCircle size={14} className="text-red-500" />,
};

export function NotificationsPage() {
  const qc = useQueryClient();
  const { showToast } = useToast();
  const isAdmin = getAuth()?.user.role === "ADMIN";
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [mode, setMode] = useState<"announce" | "direct">("announce");
  const [draft, setDraft] = useState({
    to: "",
    department: "",
    subject: "",
    body: "",
    scheduledAt: "",
  });

  const list = useQuery({
    queryKey: ["notifications", scope, onlyUnread],
    queryFn: async () =>
      (
        await api.get<Paged<Notification>>("/notifications", {
          params: {
            scope,
            pageSize: 50,
            unread: onlyUnread ? "true" : undefined,
          },
        })
      ).data,
    refetchInterval: 15_000,
  });

  const preferences = useQuery({
    queryKey: ["notifications", "preferences"],
    queryFn: async () =>
      (await api.get<NotificationPreference[]>("/notifications/preferences"))
        .data,
  });

  const campaigns = useQuery({
    queryKey: ["notifications", "campaigns"],
    queryFn: async () =>
      (await api.get<NotificationCampaign[]>("/notifications/campaigns")).data,
    enabled: isAdmin,
    refetchInterval: 10_000,
  });

  const operations = useQuery({
    queryKey: ["notifications", "operations"],
    queryFn: async () =>
      (await api.get<NotificationOperations>("/notifications/operations")).data,
    enabled: isAdmin,
    refetchInterval: 15_000,
  });

  const send = useMutation({
    mutationFn: async () =>
      mode === "announce"
        ? (
            await api.post("/notifications/announce", {
              subject: draft.subject,
              body: draft.body,
              department: draft.department || undefined,
              scheduledAt: draft.scheduledAt
                ? new Date(draft.scheduledAt).toISOString()
                : undefined,
            })
          ).data
        : (
            await api.post("/notifications/compose-email", {
              to: draft.to,
              subject: draft.subject,
              body: draft.body,
            })
          ).data,
    onSuccess: (d: any) => {
      setDraft({
        to: "",
        department: "",
        subject: "",
        body: "",
        scheduledAt: "",
      });
      qc.invalidateQueries({ queryKey: ["notifications"] });
      showToast(
        `${draft.scheduledAt ? "Scheduled" : "Queued"} for ${d.queued} recipient(s)`,
        "success",
      );
    },
    onError: (e) => showToast(getErrorMessage(e), "error"),
  });

  const markRead = useMutation({
    mutationFn: async (id: string) => api.put(`/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const markAllRead = useMutation({
    mutationFn: async () => api.put("/notifications/read-all"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const archive = useMutation({
    mutationFn: async (id: string) => api.put(`/notifications/${id}/archive`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const updatePreference = useMutation({
    mutationFn: async (input: {
      channel: "IN_APP" | "EMAIL";
      enabled: boolean;
    }) => api.put("/notifications/preferences", { eventType: "*", ...input }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["notifications", "preferences"] }),
    onError: (e) => showToast(getErrorMessage(e), "error"),
  });

  const cancelCampaign = useMutation({
    mutationFn: async (id: string) =>
      api.post(`/notifications/campaigns/${id}/cancel`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications", "campaigns"] });
      showToast("Campaign cancelled", "success");
    },
    onError: (e) => showToast(getErrorMessage(e), "error"),
  });

  const retryDelivery = useMutation({
    mutationFn: async (id: string) =>
      api.post(`/notifications/deliveries/${id}/retry`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      showToast("Email queued for retry", "success");
    },
    onError: (e) => showToast(getErrorMessage(e), "error"),
  });

  const channelEnabled = (channel: "IN_APP" | "EMAIL") =>
    preferences.data?.find(
      (preference) =>
        preference.eventType === "*" && preference.channel === channel,
    )?.enabled ?? true;

  const deliveryCount = (channel: string, status: string) =>
    operations.data?.deliveries.find(
      (item) => item.channel === channel && item.status === status,
    )?._count._all ?? 0;
  const outboxCount = (status: string) =>
    operations.data?.outbox.find((item) => item.status === status)?._count
      ._all ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Notifications</h2>
        <p className="text-muted-foreground mt-2">
          {isAdmin
            ? "Your inbox, company announcements and the email delivery log."
            : "Messages and updates sent to you."}
        </p>
      </div>

      <Card className="bg-white/50 backdrop-blur-xl">
        <CardHeader>
          <CardTitle>Delivery preferences</CardTitle>
          <CardDescription>
            Choose the default channels for optional notifications. Security and
            compliance messages may still be required.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-6">
          {(["IN_APP", "EMAIL"] as const).map((channel) => (
            <Label key={channel} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={channelEnabled(channel)}
                disabled={preferences.isLoading || updatePreference.isPending}
                onChange={(event) =>
                  updatePreference.mutate({
                    channel,
                    enabled: event.target.checked,
                  })
                }
              />
              {channel === "IN_APP"
                ? "In-app notifications"
                : "Email notifications"}
            </Label>
          ))}
        </CardContent>
      </Card>

      {isAdmin && (
        <Card className="bg-white/50 backdrop-blur-xl">
          <CardHeader>
            <CardTitle>Delivery health</CardTitle>
            <CardDescription>
              Current tenant delivery and durable outbox state.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Queued email", deliveryCount("EMAIL", "QUEUED")],
              ["Failed email", deliveryCount("EMAIL", "FAILED")],
              ["Pending outbox", outboxCount("PENDING")],
              ["Failed outbox", outboxCount("FAILED")],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-lg border bg-white/40 p-3">
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className="mt-1 text-2xl font-semibold">{value}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className={`grid gap-6 ${isAdmin ? "lg:grid-cols-5" : ""}`}>
        {isAdmin && (
          <Card className="lg:col-span-2 bg-white/50 backdrop-blur-xl h-fit">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Megaphone size={18} /> Compose
              </CardTitle>
              <CardDescription>
                Messages can only be sent to members of your workspace.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={mode === "announce" ? "default" : "outline"}
                  onClick={() => setMode("announce")}
                >
                  Announcement
                </Button>
                <Button
                  size="sm"
                  variant={mode === "direct" ? "default" : "outline"}
                  onClick={() => setMode("direct")}
                >
                  To one person
                </Button>
              </div>
              {mode === "direct" ? (
                <div className="space-y-1">
                  <Label>Recipient email</Label>
                  <Input
                    type="email"
                    value={draft.to}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, to: e.target.value }))
                    }
                  />
                </div>
              ) : (
                <>
                  <div className="space-y-1">
                    <Label>Department (leave empty for everyone)</Label>
                    <Input
                      value={draft.department}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, department: e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Schedule (optional)</Label>
                    <Input
                      type="datetime-local"
                      value={draft.scheduledAt}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          scheduledAt: e.target.value,
                        }))
                      }
                    />
                  </div>
                </>
              )}
              <div className="space-y-1">
                <Label>Subject</Label>
                <Input
                  value={draft.subject}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, subject: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>Message</Label>
                <ReactQuill
                  theme="snow"
                  value={draft.body}
                  onChange={(v) => setDraft((d) => ({ ...d, body: v }))}
                  className="bg-white"
                />
              </div>
              <Button
                className="w-full bg-indigo-500 hover:bg-indigo-600 text-white"
                disabled={
                  send.isPending ||
                  !draft.subject ||
                  !draft.body.replace(/<[^>]+>/g, "").trim() ||
                  (mode === "direct" && !draft.to)
                }
                onClick={() => send.mutate()}
              >
                <Send size={16} className="mr-2" />
                {mode === "announce" && draft.scheduledAt ? "Schedule" : "Send"}
              </Button>
            </CardContent>
          </Card>
        )}

        <Card
          className={`${isAdmin ? "lg:col-span-3" : ""} bg-white/50 backdrop-blur-xl`}
        >
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2">
              <Inbox size={18} /> {scope === "mine" ? "Inbox" : "Delivery log"}
            </CardTitle>
            <div className="flex flex-wrap justify-end gap-2">
              {scope === "mine" && (
                <>
                  <Button
                    size="sm"
                    variant={onlyUnread ? "default" : "outline"}
                    onClick={() => setOnlyUnread((value) => !value)}
                  >
                    Unread
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={markAllRead.isPending}
                    onClick={() => markAllRead.mutate()}
                  >
                    <CheckCheck size={15} /> Read all
                  </Button>
                </>
              )}
              {isAdmin && (
                <select
                  className="h-9 rounded-md border bg-white/70 px-2 text-sm"
                  value={scope}
                  onChange={(e) => setScope(e.target.value as "mine" | "all")}
                >
                  <option value="mine">My inbox</option>
                  <option value="all">All deliveries</option>
                </select>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {list.data?.items.map((n) => (
              <div
                key={n.id}
                className={`rounded-lg border p-3 bg-white/40 ${n.channel === "IN_APP" && !n.readAt && scope === "mine" ? "border-indigo-300" : ""}`}
                onClick={() =>
                  n.channel === "IN_APP" &&
                  !n.readAt &&
                  scope === "mine" &&
                  markRead.mutate(n.id)
                }
              >
                <div className="flex justify-between items-center gap-2">
                  <div className="font-medium truncate">{n.title}</div>
                  <div className="flex items-center gap-2 shrink-0">
                    {n.category !== "GENERAL" && (
                      <Badge variant="outline" className="text-[10px]">
                        {n.category}
                      </Badge>
                    )}
                    <Badge variant="outline" className="text-[10px]">
                      {n.channel === "IN_APP" ? "In-app" : "Email"}
                    </Badge>
                    {STATUS_ICON[n.status]}
                    {scope === "mine" && n.link && (
                      <Button
                        asChild
                        size="sm"
                        variant="ghost"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <Link to={n.link} aria-label={`Open ${n.title}`}>
                          <ExternalLink size={14} />
                        </Link>
                      </Button>
                    )}
                    {scope === "mine" && n.channel === "IN_APP" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Archive ${n.title}`}
                        disabled={archive.isPending}
                        onClick={(event) => {
                          event.stopPropagation();
                          archive.mutate(n.id);
                        }}
                      >
                        <Archive size={14} />
                      </Button>
                    )}
                    {scope === "all" &&
                      n.channel === "EMAIL" &&
                      n.status === "FAILED" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Retry ${n.title}`}
                          disabled={retryDelivery.isPending}
                          onClick={(event) => {
                            event.stopPropagation();
                            retryDelivery.mutate(n.id);
                          }}
                        >
                          <RotateCcw size={14} />
                        </Button>
                      )}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  {scope === "all" && n.recipientEmail
                    ? `To ${n.recipientEmail} · `
                    : ""}
                  {fmtDate(n.createdAt)}
                  {n.error ? ` · ${n.error}` : ""}
                </div>
              </div>
            ))}
            {!list.isLoading && !list.data?.items.length && (
              <div className="text-center text-muted-foreground py-8">
                Nothing here yet.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {isAdmin && (
        <Card className="bg-white/50 backdrop-blur-xl">
          <CardHeader>
            <CardTitle>Announcement campaigns</CardTitle>
            <CardDescription>
              Scheduled and recent audience deliveries. Recipient membership is
              fixed when the campaign is created.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {campaigns.data?.map((campaign) => (
              <div
                key={campaign.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-white/40 p-3"
              >
                <div>
                  <div className="font-medium">{campaign.subject}</div>
                  <div className="text-xs text-muted-foreground">
                    {fmtDate(campaign.scheduledAt)} ·{" "}
                    {campaign.processedRecipients}/{campaign.totalRecipients}{" "}
                    processed
                    {campaign.failedRecipients
                      ? ` · ${campaign.failedRecipients} failed`
                      : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{campaign.status}</Badge>
                  {campaign.status === "SCHEDULED" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={cancelCampaign.isPending}
                      onClick={() => cancelCampaign.mutate(campaign.id)}
                    >
                      Cancel
                    </Button>
                  )}
                </div>
              </div>
            ))}
            {!campaigns.isLoading && !campaigns.data?.length && (
              <div className="py-6 text-center text-muted-foreground">
                No announcement campaigns yet.
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
