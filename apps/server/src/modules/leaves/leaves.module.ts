import { Module } from '@nestjs/common';
import { LeavesService } from './leaves.service';
import { LeavesController } from './leaves.controller';
import { IntegrationsModule } from '../integrations/integrations.module';
import { LeavesProcessor } from './leaves.processor';
import { LeavesScheduler } from './leaves.scheduler';
import { LeaveAccrualService } from './leave-accrual.service';
import { LeaveApprovalService } from './leave-approval.service';
import { LeaveCalendarService } from './leave-calendar.service';
import { LeaveLedgerService } from './leave-ledger.service';
import { LeavePayrollService } from './leave-payroll.service';
import { LeavePolicyService } from './leave-policy.service';
import { LeaveRequestService } from './leave-request.service';
import { LeaveTransactionService } from './leave-transaction.service';

@Module({
  imports: [IntegrationsModule],
  controllers: [LeavesController],
  providers: [
    LeavesService,
    LeaveAccrualService,
    LeaveApprovalService,
    LeaveCalendarService,
    LeaveLedgerService,
    LeavePayrollService,
    LeavePolicyService,
    LeaveRequestService,
    LeaveTransactionService,
    LeavesProcessor,
    LeavesScheduler,
  ],
  exports: [LeavesService],
})
export class LeavesModule {}
