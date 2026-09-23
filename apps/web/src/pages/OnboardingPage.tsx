import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Sparkles, FileText, Users, BarChart3, Briefcase, CheckCircle2,
  ArrowRight, Loader2,
} from 'lucide-react';
import { api } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { useToast } from '../lib/toast';
import { getAuth } from '../lib/auth';

const SEEDING_STEPS = [
  'Creating 20 employees across 5 departments…',
  'Setting up salary structures & payroll…',
  'Generating 30 days of attendance records…',
  'Building 6 months of leave analytics…',
  'Adding job postings & candidate pipeline…',
  'Writing performance reviews…',
  'Upgrading workspace to Business Edition…',
  'Almost done — polishing the data…',
];

const SAMPLE_FEATURES = [
  { icon: Users, label: '20 Employees', desc: 'Engineering, HR, Sales, Marketing, Finance' },
  { icon: BarChart3, label: '6 Months Analytics', desc: 'Leave trends, hiring funnel, dept breakdown' },
  { icon: Briefcase, label: 'Hiring Pipeline', desc: '3 open jobs · 12 candidates in review' },
  { icon: FileText, label: 'Payroll Records', desc: '3 months of payslips, all marked Paid' },
];

export function OnboardingPage() {
  const nav = useNavigate();
  const auth = getAuth();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  const startWithSampleData = async () => {
    setLoading(true);
    setStepIndex(0);

    // Cycle through fake progress steps while the API runs
    const stepInterval = setInterval(() => {
      setStepIndex((prev) => (prev < SEEDING_STEPS.length - 1 ? prev + 1 : prev));
    }, 600);

    try {
      await api.post('/tenants/seed-demo');
      // Signal to Layout that demo banner should be shown
      sessionStorage.setItem('hrms_demo_mode', 'true');
      showToast('Your Business Edition workspace is ready! 🎉', 'success');
      nav('/');
    } catch (err: any) {
      // 409 = already seeded, still go to dashboard
      if (err?.response?.status === 409) {
        showToast('Workspace already has data — taking you there now!', 'success');
        nav('/');
      } else {
        showToast(getErrorMessage(err), 'error');
        setLoading(false);
      }
    } finally {
      clearInterval(stepInterval);
    }
  };

  const startFresh = () => {
    nav('/');
  };

  const firstName = auth?.user?.name?.split(' ')[0] ?? 'there';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 flex items-center justify-center p-4">
      {/* Background blobs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-3xl relative z-10">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 px-4 py-1.5 rounded-full text-sm font-medium mb-6">
            <CheckCircle2 size={14} />
            Workspace created successfully
          </div>
          <h1 className="text-4xl font-bold text-white mb-3">
            Welcome, {firstName}! 👋
          </h1>
          <p className="text-slate-400 text-lg max-w-lg mx-auto">
            Your HRMS portal is ready. How would you like to start?
          </p>
        </div>

        {/* Choice Cards */}
        {loading ? (
          /* Loading State */
          <div className="bg-white/5 border border-white/10 rounded-2xl p-10 text-center backdrop-blur-xl">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-indigo-500/20 rounded-2xl mb-6">
              <Loader2 size={32} className="text-indigo-400 animate-spin" />
            </div>
            <h2 className="text-xl font-bold text-white mb-2">Setting up your workspace…</h2>
            <p className="text-indigo-300 text-sm font-medium animate-pulse">
              {SEEDING_STEPS[stepIndex]}
            </p>
            <div className="mt-8 flex justify-center gap-1.5">
              {SEEDING_STEPS.map((_, i) => (
                <div
                  key={i}
                  className={`h-1.5 rounded-full transition-all duration-500 ${
                    i <= stepIndex ? 'bg-indigo-400 w-6' : 'bg-white/10 w-3'
                  }`}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-5">
            {/* Card 1: Sample Data (Recommended) */}
            <button
              onClick={startWithSampleData}
              className="group relative bg-white/5 hover:bg-indigo-500/10 border border-white/10 hover:border-indigo-500/40 rounded-2xl p-7 text-left transition-all duration-300 backdrop-blur-xl hover:shadow-lg hover:shadow-indigo-500/10 hover:-translate-y-0.5"
            >
              {/* Recommended badge */}
              <div className="absolute -top-3 left-5">
                <span className="bg-gradient-to-r from-indigo-500 to-purple-500 text-white text-xs font-bold px-3 py-1 rounded-full">
                  ✨ Recommended
                </span>
              </div>

              <div className="flex items-center gap-3 mb-5 mt-2">
                <div className="p-3 bg-indigo-500/20 rounded-xl group-hover:bg-indigo-500/30 transition-colors">
                  <Sparkles size={24} className="text-indigo-400" />
                </div>
                <div>
                  <h2 className="text-white font-bold text-lg leading-tight">Load sample data</h2>
                  <p className="text-slate-400 text-sm">See everything in action instantly</p>
                </div>
              </div>

              <ul className="space-y-3 mb-6">
                {SAMPLE_FEATURES.map(({ icon: Icon, label, desc }) => (
                  <li key={label} className="flex items-start gap-3">
                    <div className="p-1 bg-white/5 rounded-lg mt-0.5">
                      <Icon size={14} className="text-indigo-400" />
                    </div>
                    <div>
                      <span className="text-white text-sm font-medium">{label}</span>
                      <p className="text-slate-500 text-xs">{desc}</p>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="flex items-center gap-2 text-indigo-400 text-sm font-semibold group-hover:gap-3 transition-all">
                <span>Get started</span>
                <ArrowRight size={16} />
              </div>
            </button>

            {/* Card 2: Start Fresh */}
            <button
              onClick={startFresh}
              className="group bg-white/5 hover:bg-white/8 border border-white/10 hover:border-white/20 rounded-2xl p-7 text-left transition-all duration-300 backdrop-blur-xl hover:shadow-lg hover:-translate-y-0.5 flex flex-col"
            >
              <div className="flex items-center gap-3 mb-5">
                <div className="p-3 bg-white/5 rounded-xl group-hover:bg-white/10 transition-colors">
                  <FileText size={24} className="text-slate-400" />
                </div>
                <div>
                  <h2 className="text-white font-bold text-lg leading-tight">Start fresh</h2>
                  <p className="text-slate-400 text-sm">Empty workspace, your data only</p>
                </div>
              </div>

              <ul className="space-y-3 mb-6 flex-1">
                {[
                  'Clean slate — no sample data',
                  'Add your real employees and structure',
                  'Full control from day one',
                  'Import from CSV anytime',
                ].map((item) => (
                  <li key={item} className="flex items-center gap-2 text-slate-400 text-sm">
                    <CheckCircle2 size={13} className="text-slate-600 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>

              <div className="flex items-center gap-2 text-slate-400 text-sm font-semibold group-hover:gap-3 transition-all">
                <span>Take me to the dashboard</span>
                <ArrowRight size={16} />
              </div>
            </button>
          </div>
        )}

        {!loading && (
          <p className="text-center text-slate-600 text-xs mt-6">
            You can reset or clear sample data at any time from Settings.
          </p>
        )}
      </div>
    </div>
  );
}
