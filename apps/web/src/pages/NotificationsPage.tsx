import { useEffect, useState } from "react";
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
import { API_BASE_URL, api, type Paged } from "../lib/api";
import { getErrorMessage } from "../lib/errors";
import { useToast } from "../lib/toast";
import { getAuth, hasPermission } from "../lib/auth";
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
type NotificationSettings = {
  timezone: string;
  quietHoursEnabled: boolean;
  quietStartMinutes: number | null;
  quietEndMinutes: number | null;
  digestFrequency: "IMMEDIATE" | "DAILY" | "WEEKLY";
  digestHour: number;
  digestDayOfWeek: number;
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
  digests: Array<{ status: string; _count: { _all: number } }>;
  activeSuppressions: number;
  alerts: string[];
  recentFailures: Array<{ id: string }>;
};
type NotificationSuppression = {
  id: string;
  email: string;
  reason: string;
  count: number;
  lastEventAt: string;
};
type NotificationTemplate = {
  id: string;
  eventType: string;
  channel: "EMAIL";
  version: number;
  subjectTemplate: string;
  isActive: boolean;
  createdAt: string;
};

const STATUS_ICON: Record<string, React.ReactNode> = {
  SENT: <CheckCircle2 size={14} className="text-emerald-500" />,
  READ: <CheckCircle2 size={14} className="text-slate-400" />,
  QUEUED: <Clock size={14} className="text-amber-500" />,
  FAILED: <XCircle size={14} className="text-red-500" />,
};

const toTime = (minutes: number | null | undefined) => {
  if (minutes == null) return "";
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
};

const fromTime = (value: string) => {
  if (!value) return null;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
};

export function NotificationsPage() {
  const qc = useQueryClient();
  const { showToast } = useToast();
  const canManageNotifications = hasPermission(["notifications.manage"]);
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
  const [templateDraft, setTemplateDraft] = useState({
    eventType: "PAYSLIP_READY",
    subjectTemplate: "{{title}}",
    htmlTemplate: "<p>{{body}}</p>",
    textTemplate: "{{body}}",
  });

  useEffect(() => {
    const token = getAuth()?.accessToken;
    if (!token) return;
    const controller = new AbortController();
    void fetch(`${API_BASE_URL}/notifications/stream`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.body) return;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const messages = buffer.split("\n\n");
          buffer = messages.pop() ?? "";
          if (messages.some((message) => message.includes("event: notification"))) {
            qc.invalidateQueries({ queryKey: ["notifications"] });
          }
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) console.warn("Notification stream failed", error);
      });
    return () => controller.abort();
  }, [qc]);

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

  const settings = useQuery({
    queryKey: ["notifications", "settings"],
    queryFn: async () =>
      (await api.get<NotificationSettings>("/notifications/settings")).data,
  });

  const campaigns = useQuery({
    queryKey: ["notifications", "campaigns"],
    queryFn: async () =>
      (await api.get<NotificationCampaign[]>("/notifications/campaigns")).data,
    enabled: canManageNotifications,
    refetchInterval: 10_000,
  });

  const operations = useQuery({
    queryKey: ["notifications", "operations"],
    queryFn: async () =>
      (await api.get<NotificationOperations>("/notifications/operations")).data,
    enabled: canManageNotifications,
    refetchInterval: 15_000,
  });

  const suppressions = useQuery({
    queryKey: ["notifications", "suppressions"],
    queryFn: async () =>
      (await api.get<NotificationSuppression[]>("/notifications/suppressions"))
        .data,
    enabled: canManageNotifications,
  });

  const templates = useQuery({
    queryKey: ["notifications", "templates"],
    queryFn: async () =>
      (await api.get<NotificationTemplate[]>("/notifications/templates")).data,
    enabled: canManageNotifications,
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

  const updateSettings = useMutation({
    mutationFn: async (input: Partial<NotificationSettings>) =>
      api.put("/notifications/settings", input),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["notifications", "settings"] }),
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

  const unsuppress = useMutation({
    mutationFn: async (id: string) =>
      api.post(`/notifications/suppressions/${id}/unsuppress`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications", "suppressions"] });
      qc.invalidateQueries({ queryKey: ["notifications", "operations"] });
      showToast("Email address unsuppressed", "success");
    },
    onError: (e) => showToast(getErrorMessage(e), "error"),
  });

  const createTemplate = useMutation({
    mutationFn: async () =>
      api.post("/notifications/templates", {
        ...templateDraft,
        channel: "EMAIL",
        isActive: true,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications", "templates"] });
      showToast("Template version saved", "success");
    },
    onError: (e) => showToast(getErrorMessage(e), "error"),
  });

  const activateTemplate = useMutation({
    mutationFn: async (id: string) =>
      api.post(`/notifications/templates/${id}/activate`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications", "templates"] });
      showToast("Template activated", "success");
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
  const digestCount = (status: string) =>
    operations.data?.digests.find((item) => item.status === status)?._count
      ._all ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Notifications</h2>
        <p className="text-muted-foreground mt-2">
          {canManageNotifications
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

      <Card className="bg-white/50 backdrop-blur-xl">
        <CardHeader>
          <CardTitle>Timing</CardTitle>
          <CardDescription>
            Delay optional email during quiet hours or collect it into a digest.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <Label>Timezone</Label>
            <Input
              value={settings.data?.timezone ?? ""}
              disabled={settings.isLoading || updateSettings.isPending}
              onChange={(event) =>
                updateSettings.mutate({ timezone: event.target.value })
              }
              placeholder="Asia/Kolkata"
            />
          </div>
          <Label className="flex items-center gap-2 pt-6">
            <input
              type="checkbox"
              checked={settings.data?.quietHoursEnabled ?? false}
              disabled={settings.isLoading || updateSettings.isPending}
              onChange={(event) =>
                updateSettings.mutate({
                  quietHoursEnabled: event.target.checked,
                })
              }
            />
            Quiet hours
          </Label>
          <div className="space-y-1">
            <Label>Quiet start</Label>
            <Input
              type="time"
              value={toTime(settings.data?.quietStartMinutes)}
              disabled={settings.isLoading || updateSettings.isPending}
              onChange={(event) =>
                updateSettings.mutate({
                  quietStartMinutes: fromTime(event.target.value),
                })
              }
            />
          </div>
          <div className="space-y-1">
            <Label>Quiet end</Label>
            <Input
              type="time"
              value={toTime(settings.data?.quietEndMinutes)}
              disabled={settings.isLoading || updateSettings.isPending}
              onChange={(event) =>
                updateSettings.mutate({
                  quietEndMinutes: fromTime(event.target.value),
                })
              }
            />
          </div>
          <div className="space-y-1">
            <Label>Email digest</Label>
            <select
              className="h-10 w-full rounded-md border bg-white/70 px-2 text-sm"
              value={settings.data?.digestFrequency ?? "IMMEDIATE"}
              disabled={settings.isLoading || updateSettings.isPending}
              onChange={(event) =>
                updateSettings.mutate({
                  digestFrequency: event.target
                    .value as NotificationSettings["digestFrequency"],
                })
              }
            >
              <option value="IMMEDIATE">Immediate</option>
              <option value="DAILY">Daily</option>
              <option value="WEEKLY">Weekly</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label>Digest hour</Label>
            <Input
              type="number"
              min={0}
              max={23}
              value={settings.data?.digestHour ?? 9}
              disabled={settings.isLoading || updateSettings.isPending}
              onChange={(event) =>
                updateSettings.mutate({
                  digestHour: Number(event.target.value),
                })
              }
            />
          </div>
          <div className="space-y-1">
            <Label>Weekly day</Label>
            <select
              className="h-10 w-full rounded-md border bg-white/70 px-2 text-sm"
              value={settings.data?.digestDayOfWeek ?? 1}
              disabled={settings.isLoading || updateSettings.isPending}
              onChange={(event) =>
                updateSettings.mutate({
                  digestDayOfWeek: Number(event.target.value),
                })
              }
            >
              {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((day, index) => (
                <option key={day} value={index}>
                  {day}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      {canManageNotifications && (
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
              ["Failed digest", digestCount("FAILED")],
              ["Suppressed", operations.data?.activeSuppressions ?? 0],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-lg border bg-white/40 p-3">
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className="mt-1 text-2xl font-semibold">{value}</div>
              </div>
            ))}
            {!!operations.data?.alerts.length && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 lg:col-span-4">
                {operations.data.alerts.join(" · ")}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className={`grid gap-6 ${canManageNotifications ? "lg:grid-cols-5" : ""}`}>
        {canManageNotifications && (
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
          className={`${canManageNotifications ? "lg:col-span-3" : ""} bg-white/50 backdrop-blur-xl`}
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
              {canManageNotifications && (
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

      {canManageNotifications && (
        <Card className="bg-white/50 backdrop-blur-xl">
          <CardHeader>
            <CardTitle>Suppression list</CardTitle>
            <CardDescription>
              Addresses with bounces or complaints stop receiving optional
              email.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {suppressions.data?.map((item) => (
              <div
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-white/40 p-3"
              >
                <div>
                  <div className="font-medium">{item.email}</div>
                  <div className="text-xs text-muted-foreground">
                    {item.reason} · {item.count} event(s) ·{" "}
                    {fmtDate(item.lastEventAt)}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={unsuppress.isPending}
                  onClick={() => unsuppress.mutate(item.id)}
                >
                  Restore
                </Button>
              </div>
            ))}
            {!suppressions.isLoading && !suppressions.data?.length && (
              <div className="py-6 text-center text-muted-foreground">
                No active suppressions.
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {canManageNotifications && (
        <Card className="bg-white/50 backdrop-blur-xl">
          <CardHeader>
            <CardTitle>Email templates</CardTitle>
            <CardDescription>
              Save a new active version for an event type. Use variables like
              {" {{title}}"}, {"{{body}}"}, {"{{link}}"} and
              {" {{companyName}}"}.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>Event type</Label>
                <Input
                  value={templateDraft.eventType}
                  onChange={(event) =>
                    setTemplateDraft((draft) => ({
                      ...draft,
                      eventType: event.target.value.toUpperCase(),
                    }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>Subject</Label>
                <Input
                  value={templateDraft.subjectTemplate}
                  onChange={(event) =>
                    setTemplateDraft((draft) => ({
                      ...draft,
                      subjectTemplate: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>HTML body</Label>
                <textarea
                  className="min-h-28 w-full rounded-md border bg-white/70 p-2 text-sm"
                  value={templateDraft.htmlTemplate}
                  onChange={(event) =>
                    setTemplateDraft((draft) => ({
                      ...draft,
                      htmlTemplate: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>Text body</Label>
                <textarea
                  className="min-h-20 w-full rounded-md border bg-white/70 p-2 text-sm"
                  value={templateDraft.textTemplate}
                  onChange={(event) =>
                    setTemplateDraft((draft) => ({
                      ...draft,
                      textTemplate: event.target.value,
                    }))
                  }
                />
              </div>
              <Button
                disabled={createTemplate.isPending}
                onClick={() => createTemplate.mutate()}
              >
                Save active version
              </Button>
            </div>
            <div className="space-y-2">
              {templates.data?.map((template) => (
                <div
                  key={template.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-white/40 p-3"
                >
                  <div>
                    <div className="font-medium">
                      {template.eventType} v{template.version}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {template.subjectTemplate} · {fmtDate(template.createdAt)}
                    </div>
                  </div>
                  {template.isActive ? (
                    <Badge variant="outline">Active</Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={activateTemplate.isPending}
                      onClick={() => activateTemplate.mutate(template.id)}
                    >
                      Activate
                    </Button>
                  )}
                </div>
              ))}
              {!templates.isLoading && !templates.data?.length && (
                <div className="py-6 text-center text-muted-foreground">
                  No custom templates yet.
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {canManageNotifications && (
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
