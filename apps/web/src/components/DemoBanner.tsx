import { useState } from 'react';
import { Sparkles, X, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

export function DemoBanner() {
  const [visible, setVisible] = useState(
    () => sessionStorage.getItem('hrms_demo_mode') === 'true',
  );

  if (!visible) return null;

  const dismiss = () => {
    sessionStorage.removeItem('hrms_demo_mode');
    setVisible(false);
  };

  return (
    <div className="relative bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-600 text-white text-sm py-2.5 px-4 flex items-center justify-between gap-4 shadow-lg">
      {/* Shimmer effect */}
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-[shimmer_2.5s_infinite] bg-[length:200%_100%] pointer-events-none" />

      <div className="flex items-center gap-2.5 relative z-10">
        <Sparkles size={15} className="shrink-0 text-yellow-300" />
        <span className="font-medium">
          You're exploring a <span className="font-bold">Business Edition</span> sandbox with sample data.
          This is your own private workspace.
        </span>
      </div>

      <div className="flex items-center gap-3 shrink-0 relative z-10">
        <Link
          to="/billing"
          className="hidden sm:flex items-center gap-1.5 bg-white/20 hover:bg-white/30 transition-colors px-3 py-1 rounded-full text-xs font-semibold"
        >
          Upgrade to keep it
          <ArrowRight size={12} />
        </Link>
        <button
          onClick={dismiss}
          className="p-1 hover:bg-white/20 rounded-full transition-colors"
          aria-label="Dismiss banner"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
