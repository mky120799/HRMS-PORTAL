import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';
import { cn } from './utils';

type ToastType = 'success' | 'error';

type ToastItem = {
  id: number;
  type: ToastType;
  message: string;
};

type ToastContextValue = {
  showToast: (message: string, type?: ToastType) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

// Errors stay longer: they usually tell the user what to fix.
const DURATION_MS: Record<ToastType, number> = { success: 3500, error: 7000 };
const MAX_VISIBLE = 4;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => setItems((prev) => prev.filter((item) => item.id !== id)), []);

  const showToast = useCallback((message: string, type: ToastType = 'success') => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setItems((prev) => [...prev, { id, type, message }].slice(-MAX_VISIBLE));
    setTimeout(() => dismiss(id), DURATION_MS[type]);
  }, [dismiss]);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* aria-live announces toasts to screen readers without moving focus. */}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-4 z-[100] flex flex-col items-end gap-2 sm:inset-x-auto sm:right-4 sm:w-96">
        {items.map((item) => (
          <div
            key={item.id}
            role={item.type === 'error' ? 'alert' : 'status'}
            className={cn(
              'pointer-events-auto flex w-full items-start gap-3 rounded-lg border bg-white p-4 text-sm shadow-lg animate-slide-in',
              item.type === 'error' ? 'border-red-200 text-red-900' : 'border-emerald-200 text-emerald-900',
            )}
          >
            {item.type === 'error' ? (
              <AlertCircle size={18} className="mt-0.5 shrink-0 text-red-500" aria-hidden />
            ) : (
              <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-500" aria-hidden />
            )}
            <span className="flex-1 break-words">{item.message}</span>
            <button type="button" onClick={() => dismiss(item.id)} className="shrink-0 rounded text-slate-400 hover:text-slate-700" aria-label="Dismiss notification">
              <X size={16} aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
