import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { useState, useRef } from "react";
import { z } from "zod";
import {
  Plus,
  Briefcase,
  FileText,
  Upload,
  Download,
  ChevronRight,
  X,
} from "lucide-react";
import { api } from "../lib/api";
import { getErrorMessage } from "../lib/errors";
import { useToast } from "../lib/toast";
import { getAuth } from "../lib/auth";

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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { Badge } from "../components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";

const jobSchema = z.object({
  title: z.string().min(1, "Title is required"),
  department: z.string().min(1, "Department is required"),
  description: z.string().min(1, "Description is required"),
});

type JobFormData = z.infer<typeof jobSchema>;

type Job = {
  id: string;
  title: string;
  department: string;
  description: string;
  status: "OPEN" | "CLOSED";
  createdAt: string;
  _count?: { applications: number };
};

type Application = {
  id: string;
  candidateName: string;
  candidateEmail: string;
  status: string;
  aiScore: number | null;
  resumeUrl: string | null;
  resumeFilename: string | null;
  createdAt: string;
  job: { id: string; title: string; department: string };
};

export function HiringPage() {
  const qc = useQueryClient();
  const { showToast } = useToast();
  const auth = getAuth();
  const isAdmin = auth?.user.role === "ADMIN";

  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [applyJobId, setApplyJobId] = useState<string | null>(null);
  const resumeRef = useRef<HTMLInputElement>(null);

  const jobs = useQuery({
    queryKey: ["jobs"],
    queryFn: async () => (await api.get("/hiring/jobs")).data as Job[],
  });

  const applications = useQuery({
    queryKey: ["applications", selectedJobId],
    queryFn: async () => {
      const qs = selectedJobId ? `?jobId=${selectedJobId}` : "";
      return (await api.get(`/hiring/applications${qs}`)).data as Application[];
    },
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<JobFormData>({
    resolver: zodResolver(jobSchema),
  });

  const createJob = useMutation({
    mutationFn: async (body: JobFormData) => api.post("/hiring/jobs", body),
    onSuccess: () => {
      reset();
      qc.invalidateQueries({ queryKey: ["jobs"] });
      showToast("Job posting created!", "success");
    },
    onError: (e) => showToast(getErrorMessage(e), "error"),
  });

  const updateAppStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) =>
      api.patch(`/hiring/applications/${id}`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["applications"] });
      showToast("Status updated", "success");
    },
    onError: (e) => showToast(getErrorMessage(e), "error"),
  });

  const toggleJob = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) =>
      api.patch(`/hiring/jobs/${id}`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      showToast("Job status updated", "success");
    },
    onError: (e) => showToast(getErrorMessage(e), "error"),
  });

  // File upload for application with resume
  const submitApplication = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    if (!applyJobId) return;
    fd.set("jobId", applyJobId);

    try {
      await fetch("/api/v1/hiring/applications", {
        method: "POST",
        headers: { Authorization: `Bearer ${auth?.accessToken}` },
        body: fd,
      }).then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
      });
      showToast("Application submitted successfully!", "success");
      setShowApplyModal(false);
      qc.invalidateQueries({ queryKey: ["applications"] });
      qc.invalidateQueries({ queryKey: ["jobs"] });
    } catch (err: any) {
      showToast(err.message ?? "Failed to submit application", "error");
    }
  };

  const selectedJob = jobs.data?.find((j) => j.id === selectedJobId);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "HIRED":
        return (
          <Badge className="bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 border-emerald-500/20">
            HIRED
          </Badge>
        );
      case "REJECTED":
        return (
          <Badge className="bg-red-500/10 text-red-600 hover:bg-red-500/20 border-red-500/20">
            REJECTED
          </Badge>
        );
      case "INTERVIEW":
        return (
          <Badge className="bg-indigo-500/10 text-indigo-600 hover:bg-indigo-500/20 border-indigo-500/20">
            INTERVIEW
          </Badge>
        );
      default:
        return (
          <Badge className="bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 border-amber-500/20">
            PENDING
          </Badge>
        );
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">
          Recruitment & Hiring
        </h2>
        <p className="text-muted-foreground mt-2">
          Manage job postings and review candidate applications.
        </p>
      </div>

      <div
        className={`grid gap-6 ${isAdmin ? "lg:grid-cols-3" : "grid-cols-1"}`}
      >
        {/* Left Column */}
        <div className="space-y-6 lg:col-span-1">
          {isAdmin && (
            <Card className="bg-white/50 backdrop-blur-xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Briefcase size={20} className="text-indigo-500" />
                  Post New Job
                </CardTitle>
                <CardDescription>
                  Create a new opening on the job board.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form
                  onSubmit={handleSubmit((v) => createJob.mutate(v))}
                  className="space-y-4"
                >
                  <div className="space-y-2">
                    <Label>Job Title</Label>
                    <Input
                      placeholder="e.g. Senior Engineer"
                      {...register("title")}
                      className="bg-white/50"
                    />
                    {errors.title && (
                      <p className="text-red-500 text-xs">
                        {errors.title.message}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label>Department</Label>
                    <Input
                      placeholder="e.g. Engineering"
                      {...register("department")}
                      className="bg-white/50"
                    />
                    {errors.department && (
                      <p className="text-red-500 text-xs">
                        {errors.department.message}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2 pb-2">
                    <Label>Description</Label>
                    <textarea
                      rows={3}
                      placeholder="Role details and requirements..."
                      {...register("description")}
                      className="flex w-full rounded-md border border-input bg-white/50 px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-y"
                    />
                    {errors.description && (
                      <p className="text-red-500 text-xs">
                        {errors.description.message}
                      </p>
                    )}
                  </div>
                  <Button
                    type="submit"
                    className="w-full bg-indigo-500 hover:bg-indigo-600 text-white"
                    disabled={createJob.isPending}
                  >
                    <Plus size={16} className="mr-2" />
                    {createJob.isPending ? "Posting..." : "Post Job"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}

          <Card className="bg-white/50 backdrop-blur-xl overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between pb-4">
              <div className="space-y-1">
                <CardTitle>Open Positions</CardTitle>
              </div>
              <Badge
                variant="secondary"
                className="bg-indigo-50 text-indigo-600 font-medium border-0"
              >
                {jobs.data?.filter((j) => j.status === "OPEN").length ?? 0}{" "}
                active
              </Badge>
            </CardHeader>
            <div className="divide-y divide-border/50">
              {jobs.isLoading && (
                <div className="p-6 text-center text-muted-foreground">
                  Loading...
                </div>
              )}
              {jobs.data?.map((j) => (
                <div
                  key={j.id}
                  onClick={() =>
                    setSelectedJobId(j.id === selectedJobId ? null : j.id)
                  }
                  className={`p-5 cursor-pointer transition-colors ${selectedJobId === j.id ? "bg-indigo-50/50" : "hover:bg-slate-50/50"}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-[15px]">{j.title}</span>
                    <div className="flex items-center gap-2">
                      {j.status === "OPEN" ? (
                        <Badge className="bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 border-0 h-5 px-1.5 text-[10px]">
                          OPEN
                        </Badge>
                      ) : (
                        <Badge
                          variant="secondary"
                          className="h-5 px-1.5 text-[10px]"
                        >
                          CLOSED
                        </Badge>
                      )}
                      <ChevronRight
                        size={16}
                        className="text-muted-foreground"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    <span>{j.department}</span>
                    <span>·</span>
                    <span>{j._count?.applications ?? 0} applicants</span>
                  </div>

                  {selectedJobId === j.id && isAdmin && (
                    <div
                      className="flex items-center gap-2 mt-4 pt-4 border-t border-border/50"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button
                        size="sm"
                        variant="outline"
                        className={
                          j.status === "OPEN"
                            ? "text-red-500 hover:text-red-600 hover:bg-red-50"
                            : "text-emerald-500 hover:text-emerald-600 hover:bg-emerald-50"
                        }
                        onClick={() =>
                          toggleJob.mutate({
                            id: j.id,
                            status: j.status === "OPEN" ? "CLOSED" : "OPEN",
                          })
                        }
                      >
                        {j.status === "OPEN" ? "Close Job" : "Reopen Job"}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        className="bg-indigo-50 text-indigo-600 hover:bg-indigo-100"
                        onClick={() => {
                          setApplyJobId(j.id);
                          setShowApplyModal(true);
                        }}
                      >
                        Add Application
                      </Button>
                    </div>
                  )}
                </div>
              ))}
              {!jobs.isLoading && (jobs.data?.length ?? 0) === 0 && (
                <div className="p-8 text-center text-muted-foreground">
                  No jobs posted yet.
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* Right Column (Applications) */}
        <Card className="lg:col-span-2 bg-white/50 backdrop-blur-xl overflow-hidden h-fit">
          <CardHeader className="flex flex-row items-center justify-between pb-4">
            <div>
              <CardTitle>
                {selectedJob
                  ? `Applications — ${selectedJob.title}`
                  : "All Applications"}
              </CardTitle>
            </div>
            <div className="flex items-center gap-2">
              {selectedJobId && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedJobId(null)}
                >
                  Show All
                </Button>
              )}
              <Button
                size="sm"
                className="bg-indigo-500 hover:bg-indigo-600 text-white"
                onClick={() => {
                  setApplyJobId(selectedJobId ?? null);
                  setShowApplyModal(true);
                }}
              >
                <Plus size={14} className="mr-1.5" /> New Application
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-slate-50/50">
                <TableRow>
                  <TableHead className="pl-6">Candidate</TableHead>
                  <TableHead>Position</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>AI Match</TableHead>
                  <TableHead>Resume</TableHead>
                  {isAdmin && (
                    <TableHead className="text-right pr-6">Actions</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {applications.data?.map((a) => (
                  <TableRow key={a.id} className="hover:bg-slate-50/50">
                    <TableCell className="pl-6 py-4">
                      <div className="font-medium">{a.candidateName}</div>
                      <div className="text-xs text-muted-foreground">
                        {a.candidateEmail}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{a.job.title}</TableCell>
                    <TableCell>{getStatusBadge(a.status)}</TableCell>
                    <TableCell>
                      {a.aiScore != null ? (
                        <Badge
                          className={`
                          ${a.aiScore >= 80 ? "bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 border-emerald-500/20" : ""}
                          ${a.aiScore >= 50 && a.aiScore < 80 ? "bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 border-amber-500/20" : ""}
                          ${a.aiScore < 50 ? "bg-red-500/10 text-red-600 hover:bg-red-500/20 border-red-500/20" : ""}
                        `}
                        >
                          {a.aiScore >= 80 ? "⭐ " : ""}
                          {a.aiScore}%
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">
                          Pending...
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {a.resumeUrl ? (
                        <a
                          href={`/api/v1/hiring/uploads${a.resumeUrl.replace("/uploads", "")}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 text-sm text-indigo-500 hover:text-indigo-600 hover:underline"
                        >
                          <Download size={14} /> {a.resumeFilename ?? "Resume"}
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          No file
                        </span>
                      )}
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="text-right pr-6">
                        <select
                          value={a.status}
                          onChange={(e) =>
                            updateAppStatus.mutate({
                              id: a.id,
                              status: e.target.value,
                            })
                          }
                          className="h-8 w-[110px] rounded-md border border-input bg-transparent px-2 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                        >
                          <option value="PENDING">PENDING</option>
                          <option value="INTERVIEW">INTERVIEW</option>
                          <option value="HIRED">HIRED</option>
                          <option value="REJECTED">REJECTED</option>
                        </select>
                      </TableCell>
                    )}
                  </TableRow>
                ))}

                {applications.isLoading && (
                  <TableRow>
                    <TableCell
                      colSpan={isAdmin ? 6 : 5}
                      className="h-32 text-center text-muted-foreground"
                    >
                      Loading...
                    </TableCell>
                  </TableRow>
                )}

                {!applications.isLoading &&
                  (applications.data?.length ?? 0) === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={isAdmin ? 6 : 5}
                        className="h-32 text-center text-muted-foreground"
                      >
                        No applications yet.
                      </TableCell>
                    </TableRow>
                  )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Dialog open={showApplyModal} onOpenChange={setShowApplyModal}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2.5 bg-indigo-500/10 rounded-xl text-indigo-500">
                <FileText size={20} />
              </div>
              <div>
                <DialogTitle>Submit Application</DialogTitle>
              </div>
            </div>
          </DialogHeader>
          <form onSubmit={submitApplication} className="space-y-4 pt-2">
            {!applyJobId && (
              <div className="space-y-2">
                <Label>Select Job</Label>
                <select
                  name="jobId"
                  required
                  className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                >
                  <option value="">-- Choose a position --</option>
                  {jobs.data
                    ?.filter((j) => j.status === "OPEN")
                    .map((j) => (
                      <option key={j.id} value={j.id}>
                        {j.title} ({j.department})
                      </option>
                    ))}
                </select>
              </div>
            )}
            <div className="space-y-2">
              <Label>Candidate Name</Label>
              <Input name="candidateName" placeholder="Full name" required />
            </div>
            <div className="space-y-2">
              <Label>Candidate Email</Label>
              <Input
                name="candidateEmail"
                type="email"
                placeholder="name@example.com"
                required
              />
            </div>
            <div className="space-y-2 pb-4">
              <Label>Resume / Documents</Label>
              <div
                className="border-2 border-dashed border-indigo-200 hover:border-indigo-400 bg-indigo-50/30 rounded-xl p-8 text-center cursor-pointer transition-colors"
                onClick={() => resumeRef.current?.click()}
              >
                <Upload size={24} className="mx-auto mb-3 text-indigo-400" />
                <div className="text-sm font-medium text-slate-700">
                  Click to upload resume/documents
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  PDF, DOC, DOCX, JPG, PNG · Max 10MB
                </div>
                <div className="text-sm font-semibold text-indigo-600 mt-2 empty:hidden"></div>
                <input
                  ref={resumeRef}
                  name="resume"
                  type="file"
                  accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                  className="hidden"
                  onChange={(e) => {
                    const name = e.target.files?.[0]?.name;
                    if (name)
                      (
                        e.target.parentElement!.querySelector(
                          "div:last-of-type",
                        ) as any
                      ).textContent = `📎 ${name}`;
                  }}
                />
              </div>
            </div>
            <Button
              type="submit"
              className="w-full bg-indigo-500 hover:bg-indigo-600 text-white"
            >
              Submit Application
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
