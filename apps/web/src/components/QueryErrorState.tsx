import { AlertCircle, RefreshCw } from 'lucide-react';
import { getErrorMessage } from '../lib/errors';
import { Button } from './ui/button';
import { TableCell, TableRow } from './ui/table';
import { cn } from '../lib/utils';

/**
 * Shown in place of data that failed to load, so a failed request never reads as
 * "0 employees" or an empty table. Pair the query with `meta: { inlineError: true }`
 * so the global "server unreachable" toast does not repeat the same message.
 */
export function QueryErrorState({
  error,
  onRetry,
  title = 'Could not load this data',
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
  className?: string;
}) {
  return (
    <div role="alert" className={cn('flex flex-col items-center justify-center gap-3 rounded-xl border border-red-200 bg-red-50/60 p-6 text-center', className)}>
      <AlertCircle className="text-red-500" size={24} aria-hidden />
      <div>
        <div className="font-medium text-red-900">{title}</div>
        <div className="mt-1 text-sm text-red-700">{getErrorMessage(error)}</div>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw size={14} className="mr-2" aria-hidden /> Try again
        </Button>
      )}
    </div>
  );
}

/** QueryErrorState as a full-width table row, for lists rendered inside <TableBody>. */
export function QueryErrorRow({ colSpan, ...props }: { colSpan: number } & Parameters<typeof QueryErrorState>[0]) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={colSpan} className="p-4">
        <QueryErrorState {...props} />
      </TableCell>
    </TableRow>
  );
}
